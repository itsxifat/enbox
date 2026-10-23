/**
 * Space insights counters (docs/design/discord-parity.md W12-F): activity counted as it
 * happens, per UTC day, into space_stats_daily, space_channel_stats_daily and
 * space_active_daily.
 *
 * - Messages: `message.created` of Space channels and threads adds to this process's
 *   in-memory counters: messages per Space-day, per channel-day (a thread's messages count
 *   for its parent channel) and the active members per Space-day. Only members' messages
 *   count: not system, call or webhook posts. `flushInsightCounters` (every process, every
 *   15 s: jobs/insights.ts) writes them with upserts that add; a crash loses at most one
 *   interval, a failed flush keeps its counts for the next one.
 * - Joins and leaves: +1 on the day's row inside the membership transaction (every join
 *   counts, the creator's included; leaving, kicks and bans are leaves).
 * - Voice minutes: `sampleVoiceMinutes` (the leader, every minute) adds one minute per voice
 *   state to its Space's row and makes those users active today: accurate to the minute.
 *
 * Lock order (spaces → everything else, as everywhere): the flush and the voice sample lock
 * the Spaces they write `FOR KEY SHARE` before their first upsert, and upsert in key order. A
 * membership transaction holds its Space `FOR UPDATE` while it adds its join, so it never
 * waits on a row we inserted while we wait on its Space (which would deadlock).
 */
import { sql } from 'drizzle-orm';
import { db, type DbOrTx } from '../../db/index.js';
import type { ChatRow, MessageRow } from '../../db/schema.js';
import { logger } from '../../lib/logger.js';
import { domainEvents } from '../../services/events.js';
import { onSpaceMemberJoined, onSpaceMemberLeft } from '../../services/spaceMemberHooks.js';
import { num, rawRows, uniq, uuidArray } from '../../services/sql.js';

/** `YYYY-MM-DD` of a moment in UTC (insights days are UTC days). */
export function utcDay(at: Date = new Date()): string {
  return at.toISOString().slice(0, 10);
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** A `date[]` bound as one text parameter (like `uuidArray`). */
function dateArray(days: readonly string[]) {
  for (const d of days) if (!DAY_RE.test(d)) throw new Error(`dateArray: invalid day ${d}`);
  return sql`${`{${days.join(',')}}`}::date[]`;
}

/** An `int[]` bound as one text parameter. */
function intArray(ns: readonly number[]) {
  for (const n of ns) if (!Number.isSafeInteger(n)) throw new Error(`intArray: invalid ${n}`);
  return sql`${`{${ns.join(',')}}`}::int[]`;
}

// ---------------------------------------------------------------------------
// Messages: in-memory counters, flushed by the 'insights-flush' job
// ---------------------------------------------------------------------------

interface Counters {
  /** `spaceId|day` → messages. */
  spaceDays: Map<string, number>;
  /** `channelId|day` → its Space and messages. */
  channelDays: Map<string, { spaceId: string; n: number }>;
  /** `spaceId|day|userId`: sent a message that day. */
  active: Set<string>;
}

const emptyCounters = (): Counters => ({
  spaceDays: new Map(),
  channelDays: new Map(),
  active: new Set(),
});

let pending = emptyCounters();
/** Failed flushes in a row: their counts are retried, up to MAX_RETRIES, then dropped. */
let failures = 0;
const MAX_RETRIES = 20;
let flushing: Promise<void> = Promise.resolve();

const sizeOf = (c: Counters) => c.spaceDays.size + c.channelDays.size + c.active.size;

function addTo(c: Counters, from: Counters): void {
  for (const [k, n] of from.spaceDays) c.spaceDays.set(k, (c.spaceDays.get(k) ?? 0) + n);
  for (const [k, v] of from.channelDays) {
    const cur = c.channelDays.get(k);
    if (cur) cur.n += v.n;
    else c.channelDays.set(k, { ...v });
  }
  for (const k of from.active) c.active.add(k);
}

/** Count one created message: members' messages in Space channels and threads only. */
export function countMessage(
  message: Pick<MessageRow, 'senderId' | 'type' | 'createdAt'>,
  chat: Pick<ChatRow, 'id' | 'spaceId' | 'parentId'>,
): void {
  const spaceId = chat.spaceId;
  if (!spaceId || !message.senderId || message.type === 'system' || message.type === 'call') return;
  const day = utcDay(message.createdAt);
  const spaceKey = `${spaceId}|${day}`;
  pending.spaceDays.set(spaceKey, (pending.spaceDays.get(spaceKey) ?? 0) + 1);
  const channelKey = `${chat.parentId ?? chat.id}|${day}`;
  const channel = pending.channelDays.get(channelKey);
  if (channel) channel.n += 1;
  else pending.channelDays.set(channelKey, { spaceId, n: 1 });
  pending.active.add(`${spaceKey}|${message.senderId}`);
}

domainEvents.on('message.created', ({ message, chat }) => countMessage(message, chat));

/**
 * Write this process's counters (one transaction; calls are serialized). Counts of Spaces,
 * channels or users deleted meanwhile are dropped; a failure puts the counts back for the
 * next flush (and rethrows, for the job's log).
 */
export function flushInsightCounters(): Promise<void> {
  const run = flushing.then(flushOnce);
  flushing = run.catch(() => undefined);
  return run;
}

async function flushOnce(): Promise<void> {
  const batch = pending;
  if (sizeOf(batch) === 0) return;
  pending = emptyCounters();
  try {
    await writeCounters(batch);
    failures = 0;
  } catch (err) {
    failures += 1;
    if (failures <= MAX_RETRIES) addTo(pending, batch);
    else logger.error({ dropped: sizeOf(batch) }, 'insights: counts dropped after failed flushes');
    throw err;
  }
}

async function writeCounters(c: Counters): Promise<void> {
  const spaceRows = [...c.spaceDays].map(([key, n]) => {
    const [spaceId, day] = key.split('|') as [string, string];
    return { spaceId, day, n };
  });
  const channelRows = [...c.channelDays].map(([key, v]) => {
    const [channelId, day] = key.split('|') as [string, string];
    return { spaceId: v.spaceId, channelId, day, n: v.n };
  });
  const activeRows = [...c.active].map((key) => {
    const [spaceId, day, userId] = key.split('|') as [string, string, string];
    return { spaceId, day, userId };
  });
  await db.transaction(async (tx) => {
    const spaces = await lockSpaces(tx, [
      ...spaceRows.map((r) => r.spaceId),
      ...channelRows.map((r) => r.spaceId),
      ...activeRows.map((r) => r.spaceId),
    ]);
    const channels = await existing(
      tx,
      'chats',
      channelRows.map((r) => r.channelId),
    );
    const users = await existing(
      tx,
      'users',
      activeRows.map((r) => r.userId),
    );
    const s = spaceRows.filter((r) => spaces.has(r.spaceId));
    if (s.length)
      await tx.execute(sql`
        insert into space_stats_daily (space_id, day, messages)
        select * from unnest(
          ${uuidArray(s.map((r) => r.spaceId))}, ${dateArray(s.map((r) => r.day))},
          ${intArray(s.map((r) => r.n))}
        ) order by 1, 2
        on conflict (space_id, day) do update
          set messages = space_stats_daily.messages + excluded.messages`);
    const ch = channelRows.filter((r) => spaces.has(r.spaceId) && channels.has(r.channelId));
    if (ch.length)
      await tx.execute(sql`
        insert into space_channel_stats_daily (space_id, channel_id, day, messages)
        select * from unnest(
          ${uuidArray(ch.map((r) => r.spaceId))}, ${uuidArray(ch.map((r) => r.channelId))},
          ${dateArray(ch.map((r) => r.day))}, ${intArray(ch.map((r) => r.n))}
        ) order by 2, 3
        on conflict (channel_id, day) do update
          set messages = space_channel_stats_daily.messages + excluded.messages`);
    const a = activeRows.filter((r) => spaces.has(r.spaceId) && users.has(r.userId));
    if (a.length)
      await tx.execute(sql`
        insert into space_active_daily (space_id, day, user_id)
        select * from unnest(
          ${uuidArray(a.map((r) => r.spaceId))}, ${dateArray(a.map((r) => r.day))},
          ${uuidArray(a.map((r) => r.userId))}
        ) order by 1, 2, 3
        on conflict do nothing`);
  });
}

/** Lock the Spaces that still exist `FOR KEY SHARE`, in id order; returns their ids. */
async function lockSpaces(tx: DbOrTx, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await rawRows<{ id: string }>(
    tx,
    sql`select id from spaces where id = any(${uuidArray(uniq(ids))}) order by id for key share`,
  );
  return new Set(rows.map((r) => r.id));
}

/** The ids that still exist (a row deleted after this check fails the flush: it is retried). */
async function existing(
  tx: DbOrTx,
  table: 'chats' | 'users',
  ids: readonly string[],
): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const list = uuidArray(uniq(ids));
  const rows = await rawRows<{ id: string }>(
    tx,
    table === 'chats'
      ? sql`select id from chats where id = any(${list})`
      : sql`select id from users where id = any(${list})`,
  );
  return new Set(rows.map((r) => r.id));
}

/** Drop the counters not flushed yet (tests). */
export function resetInsightCounters(): void {
  pending = emptyCounters();
  failures = 0;
}

// ---------------------------------------------------------------------------
// Joins and leaves: inside the membership transaction
// ---------------------------------------------------------------------------

onSpaceMemberJoined(async (tx, _fx, e) => {
  await tx.execute(sql`
    insert into space_stats_daily (space_id, day, joins) values (${e.spaceId}, ${utcDay(e.at)}::date, 1)
    on conflict (space_id, day) do update set joins = space_stats_daily.joins + 1`);
});

onSpaceMemberLeft(async (tx, _fx, e) => {
  await tx.execute(sql`
    insert into space_stats_daily (space_id, day, leaves) values (${e.spaceId}, ${utcDay(e.at)}::date, 1)
    on conflict (space_id, day) do update set leaves = space_stats_daily.leaves + 1`);
});

// ---------------------------------------------------------------------------
// Voice minutes: sampled by the leader every minute
// ---------------------------------------------------------------------------

/**
 * One sample: every voice state is a minute in its Space on `at`'s day, and its user is
 * active that day. Returns the minutes added.
 */
export async function sampleVoiceMinutes(at: Date = new Date()): Promise<number> {
  const day = utcDay(at);
  return db.transaction(async (tx) => {
    const counts = await rawRows<{ space_id: string; n: number }>(
      tx,
      sql`select space_id, count(*)::int as n from voice_states group by space_id`,
    );
    if (counts.length === 0) return 0;
    const spaces = await lockSpaces(
      tx,
      counts.map((r) => r.space_id),
    );
    const kept = counts.filter((r) => spaces.has(r.space_id));
    if (kept.length === 0) return 0;
    await tx.execute(sql`
      insert into space_stats_daily (space_id, day, voice_minutes)
      select * from unnest(
        ${uuidArray(kept.map((r) => r.space_id))}, ${dateArray(kept.map(() => day))},
        ${intArray(kept.map((r) => num(r.n)))}
      ) order by 1
      on conflict (space_id, day) do update
        set voice_minutes = space_stats_daily.voice_minutes + excluded.voice_minutes`);
    await tx.execute(sql`
      insert into space_active_daily (space_id, day, user_id)
      select space_id, ${day}::date, user_id from voice_states
      where space_id = any(${uuidArray(kept.map((r) => r.space_id))})
      order by space_id, user_id
      on conflict do nothing`);
    return kept.reduce((sum, r) => sum + num(r.n), 0);
  });
}
