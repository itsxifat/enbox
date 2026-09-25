/**
 * Read/delivered watermarks, unread counts and tick watermarks (docs "Watermarks",
 * "Unread and mentions").
 *
 * - Member marks (`last_read_seq`, `last_delivered_seq`) are monotonic (GREATEST) and clamped
 *   to the member's highest visible seq ≤ the requested seq, so withheld / expired /
 *   pre-join messages never count as read or delivered. Reading raises delivered too.
 * - Tick watermarks of viewer V = min over the OTHER active members (none → the chat's
 *   lastSeq, V's window end for former members); direct chats: read = 0 when either side
 *   has readReceipts off; channels: always 0/0 and never emitted.
 * - `chat:watermarks` goes only to active members whose value changed (see
 *   `Effects.watermarks(delta)` / `diffWatermarks`).
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DEFAULT_USER_SETTINGS, type ChatType } from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../db/index.js';
import { chatMembers, chats } from '../db/schema.js';
import { notFound } from '../lib/errors.js';
import { emitToUser } from '../realtime/emit.js';
import { isOnline } from '../realtime/presence.js';
import { getMembership, lockChat, maxVisibleSeq, memberVisibleSql, windowEnd, windowOf } from './chats.js';
import { Effects } from './effects.js';
import { num, pairKey, rawRows, uniq, uuidArray } from './sql.js';

export interface Marks {
  read: number;
  delivered: number;
}

export interface ViewerWatermarks {
  readWatermark: number;
  deliveredWatermark: number;
}

/**
 * What changed in one chat during a transaction, for `Effects.watermarks()`:
 * `members[i].prev` = the member's marks BEFORE the tx (null = they were not an active member
 * before, e.g. just joined — they get a chat:upsert instead). Members absent from the
 * post-commit active set (left/removed) are treated as removed. `prevLastSeq` = chats.last_seq
 * before the tx (it is the watermark of viewers without other members). `prevReadReceipts` =
 * a user's previous readReceipts setting (direct chats' read watermarks depend on it).
 */
export interface WatermarkDelta {
  chatId: string;
  prevLastSeq?: number;
  members: { userId: string; prev: Marks | null }[];
  prevReadReceipts?: { userId: string; value: boolean };
}

// ---------------------------------------------------------------------------
// Pure computation
// ---------------------------------------------------------------------------

/** The two smallest read/delivered marks of a chat's active members and who holds the smallest. */
export interface MarkAggregate {
  /** Active member count. */
  n: number;
  read: number[];
  readFirst: string | null;
  delivered: number[];
  deliveredFirst: string | null;
}

export function aggregateMarks(marks: { userId: string; read: number; delivered: number }[]): MarkAggregate {
  const byRead = [...marks].sort((a, b) => a.read - b.read || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  const byDel = [...marks].sort((a, b) => a.delivered - b.delivered || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
  return {
    n: marks.length,
    read: byRead.slice(0, 2).map((m) => m.read),
    readFirst: byRead[0]?.userId ?? null,
    delivered: byDel.slice(0, 2).map((m) => m.delivered),
    deliveredFirst: byDel[0]?.userId ?? null,
  };
}

/** min over the active members other than the viewer, from the two smallest values; null = no other member. */
function othersMin(values: number[], first: string | null, n: number, viewerId: string, viewerActive: boolean): number | null {
  const others = viewerActive ? n - 1 : n;
  if (others <= 0) return null;
  if (viewerActive && first === viewerId) return values[1] ?? null;
  return values[0] ?? null;
}

/**
 * Tick watermarks for one viewer (pure). `lastSeq` = the viewer's window end;
 * `readReceiptsOff` = direct chat where either side disabled read receipts.
 */
export function viewerWatermarks(
  agg: MarkAggregate | undefined,
  p: { chatType: ChatType; viewerId: string; viewerActive: boolean; lastSeq: number; readReceiptsOff: boolean },
): ViewerWatermarks {
  if (p.chatType === 'channel') return { readWatermark: 0, deliveredWatermark: 0 };
  const a = agg ?? { n: 0, read: [], readFirst: null, delivered: [], deliveredFirst: null };
  const r = othersMin(a.read, a.readFirst, a.n, p.viewerId, p.viewerActive) ?? p.lastSeq;
  const d = othersMin(a.delivered, a.deliveredFirst, a.n, p.viewerId, p.viewerActive) ?? p.lastSeq;
  return {
    readWatermark: p.readReceiptsOff ? 0 : Math.min(r, p.lastSeq),
    deliveredWatermark: Math.min(d, p.lastSeq),
  };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Per chat: the two smallest active marks (one aggregate query; channels are skipped by callers). */
export async function loadMarkAggregates(dbx: DbOrTx, chatIds: string[]): Promise<Map<string, MarkAggregate>> {
  const out = new Map<string, MarkAggregate>();
  if (chatIds.length === 0) return out;
  const rows = await rawRows<{ chat_id: string; n: number; r: number[]; r_uid: string; d: number[]; d_uid: string }>(
    dbx,
    sql`select chat_id, count(*)::int as n,
          (array_agg(last_read_seq order by last_read_seq, user_id))[1:2] as r,
          (array_agg(user_id order by last_read_seq, user_id))[1] as r_uid,
          (array_agg(last_delivered_seq order by last_delivered_seq, user_id))[1:2] as d,
          (array_agg(user_id order by last_delivered_seq, user_id))[1] as d_uid
        from chat_members where chat_id = any(${uuidArray(chatIds)}) and left_at is null
        group by chat_id`,
  );
  for (const r of rows) {
    out.set(r.chat_id, {
      n: num(r.n),
      read: (r.r ?? []).map(Number),
      readFirst: r.r_uid,
      delivered: (r.d ?? []).map(Number),
      deliveredFirst: r.d_uid,
    });
  }
  return out;
}

const RR_DEFAULT = DEFAULT_USER_SETTINGS.readReceipts;

interface MemberMarkRow {
  chatId: string;
  userId: string;
  read: number;
  delivered: number;
  readReceipts: boolean;
}

/** Active members' marks (+ readReceipts setting) of these chats. */
async function loadActiveMarks(dbx: DbOrTx, chatIds: string[]): Promise<Map<string, MemberMarkRow[]>> {
  const out = new Map<string, MemberMarkRow[]>();
  if (chatIds.length === 0) return out;
  const rows = await rawRows<{ chat_id: string; user_id: string; r: number; d: number; rr: boolean | null }>(
    dbx,
    sql`select cm.chat_id, cm.user_id, cm.last_read_seq as r, cm.last_delivered_seq as d,
          (u.settings->>'readReceipts')::boolean as rr
        from chat_members cm join users u on u.id = cm.user_id
        where cm.chat_id = any(${uuidArray(chatIds)}) and cm.left_at is null`,
  );
  for (const r of rows) {
    const list = out.get(r.chat_id) ?? [];
    list.push({ chatId: r.chat_id, userId: r.user_id, read: num(r.r), delivered: num(r.d), readReceipts: r.rr ?? RR_DEFAULT });
    out.set(r.chat_id, list);
  }
  return out;
}

/**
 * Tick watermarks of `forUserIds` (default: every active member) in one chat. Members with
 * former rows get their clamped former view; unknown users are absent.
 */
export async function computeWatermarks(dbx: DbOrTx, chatId: string, forUserIds?: string[]): Promise<Map<string, ViewerWatermarks>> {
  const out = new Map<string, ViewerWatermarks>();
  const [chat] = await dbx.select().from(chats).where(eq(chats.id, chatId)).limit(1);
  if (!chat) return out;
  const marks = (await loadActiveMarks(dbx, [chatId])).get(chatId) ?? [];
  const agg = aggregateMarks(marks);
  let viewers: { userId: string; active: boolean; leftSeq: number | null }[];
  if (forUserIds) {
    const rows = forUserIds.length
      ? await dbx
          .select({ userId: chatMembers.userId, leftAt: chatMembers.leftAt, leftSeq: chatMembers.leftSeq })
          .from(chatMembers)
          .where(and(eq(chatMembers.chatId, chatId), inArray(chatMembers.userId, forUserIds)))
      : [];
    viewers = rows.map((r) => ({ userId: r.userId, active: !r.leftAt, leftSeq: r.leftSeq == null ? null : Number(r.leftSeq) }));
  } else {
    viewers = marks.map((m) => ({ userId: m.userId, active: true, leftSeq: null }));
  }
  const rrOff = chat.type === 'direct' && marks.length === 2 && marks.some((m) => !m.readReceipts);
  for (const v of viewers) {
    out.set(
      v.userId,
      viewerWatermarks(agg, {
        chatType: chat.type,
        viewerId: v.userId,
        viewerActive: v.active,
        lastSeq: v.leftSeq ?? Number(chat.lastSeq),
        readReceiptsOff: rrOff,
      }),
    );
  }
  return out;
}

/**
 * Before/after diff of tick watermarks for the given deltas (merged per chat; the earliest
 * `prev` of a user wins). Returns, per chat, the `chat:watermarks` emissions for active
 * members whose value changed (newly active members are skipped). Channels never emit.
 */
export async function diffWatermarks(
  dbx: DbOrTx,
  deltas: WatermarkDelta[],
): Promise<Map<string, { userId: string; payload: { chatId: string } & ViewerWatermarks }[]>> {
  const out = new Map<string, { userId: string; payload: { chatId: string } & ViewerWatermarks }[]>();
  const merged = new Map<string, { prevLastSeq?: number; prev: Map<string, Marks | null>; prevRR: Map<string, boolean> }>();
  for (const d of deltas) {
    let m = merged.get(d.chatId);
    if (!m) merged.set(d.chatId, (m = { prev: new Map(), prevRR: new Map() }));
    if (m.prevLastSeq === undefined && d.prevLastSeq !== undefined) m.prevLastSeq = d.prevLastSeq;
    for (const x of d.members) if (!m.prev.has(x.userId)) m.prev.set(x.userId, x.prev);
    if (d.prevReadReceipts && !m.prevRR.has(d.prevReadReceipts.userId)) m.prevRR.set(d.prevReadReceipts.userId, d.prevReadReceipts.value);
  }
  const chatIds = [...merged.keys()];
  if (chatIds.length === 0) return out;
  const chatRows = await dbx
    .select({ id: chats.id, type: chats.type, lastSeq: chats.lastSeq })
    .from(chats)
    .where(inArray(chats.id, chatIds));
  const live = chatRows.filter((c) => c.type !== 'channel');
  const marksByChat = await loadActiveMarks(
    dbx,
    live.map((c) => c.id),
  );

  for (const chat of live) {
    const m = merged.get(chat.id)!;
    const after = marksByChat.get(chat.id) ?? [];
    const before: MemberMarkRow[] = after
      .filter((x) => !m.prev.has(x.userId))
      .map((x) => ({ ...x, readReceipts: m.prevRR.get(x.userId) ?? x.readReceipts }));
    const afterById = new Map(after.map((x) => [x.userId, x]));
    for (const [userId, prev] of m.prev) {
      if (!prev) continue; // was not active before the tx
      const cur = afterById.get(userId);
      before.push({ chatId: chat.id, userId, read: prev.read, delivered: prev.delivered, readReceipts: m.prevRR.get(userId) ?? cur?.readReceipts ?? RR_DEFAULT });
    }
    const activeBefore = new Set(before.map((b) => b.userId));
    const aggAfter = aggregateMarks(after);
    const aggBefore = aggregateMarks(before);
    const lastAfter = Number(chat.lastSeq);
    const lastBefore = m.prevLastSeq ?? lastAfter;
    const rrOffAfter = chat.type === 'direct' && after.length === 2 && after.some((x) => !x.readReceipts);
    const rrOffBefore = chat.type === 'direct' && before.length === 2 && before.some((x) => !x.readReceipts);
    const emissions: { userId: string; payload: { chatId: string } & ViewerWatermarks }[] = [];
    for (const x of after) {
      if (m.prev.has(x.userId) && m.prev.get(x.userId) === null) continue; // newly active: chat:upsert carries it
      if (!activeBefore.has(x.userId)) continue;
      const wb = viewerWatermarks(aggBefore, { chatType: chat.type, viewerId: x.userId, viewerActive: true, lastSeq: lastBefore, readReceiptsOff: rrOffBefore });
      const wa = viewerWatermarks(aggAfter, { chatType: chat.type, viewerId: x.userId, viewerActive: true, lastSeq: lastAfter, readReceiptsOff: rrOffAfter });
      if (wb.readWatermark !== wa.readWatermark || wb.deliveredWatermark !== wa.deliveredWatermark) {
        emissions.push({ userId: x.userId, payload: { chatId: chat.id, ...wa } });
      }
    }
    if (emissions.length) out.set(chat.id, emissions);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Unread counts & read state
// ---------------------------------------------------------------------------

export interface ChatUserPair {
  chatId: string;
  userId: string;
}

/**
 * `unreadCount` / `unreadMentionCount` for many (chat, member) pairs in one query: visible
 * messages with seq > last_read_seq, not sent by the member, not system. Keyed by
 * `pairKey(chatId, userId)`; pairs without unread messages are absent.
 */
export async function unreadCounts(dbx: DbOrTx, pairs: ChatUserPair[]): Promise<Map<string, { unread: number; mentions: number }>> {
  const out = new Map<string, { unread: number; mentions: number }>();
  if (pairs.length === 0) return out;
  const rows = await rawRows<{ chat_id: string; user_id: string; unread: number; mentions: number }>(
    dbx,
    sql`select p.c as chat_id, p.u as user_id, count(*)::int as unread,
          count(*) filter (where p.u = any(m.mentions))::int as mentions
        from unnest(${uuidArray(pairs.map((p) => p.chatId))}, ${uuidArray(pairs.map((p) => p.userId))}) as p(c, u)
        join chat_members cm on cm.chat_id = p.c and cm.user_id = p.u
        join messages m on m.chat_id = cm.chat_id and m.seq > cm.last_read_seq and ${memberVisibleSql('m', 'cm')}
          and m.sender_id is distinct from cm.user_id and m.type <> 'system'
        group by p.c, p.u`,
  );
  for (const r of rows) out.set(pairKey(r.chat_id, r.user_id), { unread: num(r.unread), mentions: num(r.mentions) });
  return out;
}

/** Payload of `chat:read` (minus chatId). */
export interface ReadState {
  lastReadSeq: number;
  unreadCount: number;
  unreadMentionCount: number;
  markedUnread: boolean;
}

/** Read state of many (chat, member) pairs (2 queries). Keyed by `pairKey(chatId, userId)`; non-members absent. */
export async function readStates(dbx: DbOrTx, pairs: ChatUserPair[]): Promise<Map<string, ReadState>> {
  const out = new Map<string, ReadState>();
  if (pairs.length === 0) return out;
  const wanted = new Set(pairs.map((p) => pairKey(p.chatId, p.userId)));
  const rows = await dbx
    .select()
    .from(chatMembers)
    .where(and(inArray(chatMembers.chatId, uniq(pairs.map((p) => p.chatId))), inArray(chatMembers.userId, uniq(pairs.map((p) => p.userId)))));
  const counts = await unreadCounts(dbx, pairs);
  for (const r of rows) {
    const key = pairKey(r.chatId, r.userId);
    if (!wanted.has(key)) continue;
    const c = counts.get(key);
    const lastRead = Number(r.lastReadSeq);
    out.set(key, {
      lastReadSeq: r.leftSeq != null ? Math.min(lastRead, Number(r.leftSeq)) : lastRead,
      unreadCount: c?.unread ?? 0,
      unreadMentionCount: c?.mentions ?? 0,
      markedUnread: r.markedUnread,
    });
  }
  return out;
}

export async function readState(dbx: DbOrTx, userId: string, chatId: string): Promise<ReadState | null> {
  return (await readStates(dbx, [{ chatId, userId }])).get(pairKey(chatId, userId)) ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Monotonic mark update for some members of a chat (caller holds the chat lock, except the
 * connect-time delivered advance). Only raises values; sets `*_at` when a value advanced;
 * optionally clears `marked_unread`. Returns each updated member's previous and new marks.
 */
export async function bumpMarks(
  tx: DbOrTx,
  chatId: string,
  userIds: string[],
  opts: { read?: number; delivered?: number; clearMarkedUnread?: boolean },
): Promise<{ userId: string; prev: Marks; next: Marks }[]> {
  if (userIds.length === 0) return [];
  const sets: ReturnType<typeof sql>[] = [];
  if (opts.read !== undefined) {
    sets.push(sql`last_read_seq = greatest(c.last_read_seq, ${opts.read}::bigint)`);
    sets.push(sql`last_read_at = case when ${opts.read}::bigint > c.last_read_seq then now() else c.last_read_at end`);
  }
  if (opts.delivered !== undefined) {
    sets.push(sql`last_delivered_seq = greatest(c.last_delivered_seq, ${opts.delivered}::bigint)`);
    sets.push(sql`last_delivered_at = case when ${opts.delivered}::bigint > c.last_delivered_seq then now() else c.last_delivered_at end`);
  }
  if (opts.clearMarkedUnread) sets.push(sql`marked_unread = false`);
  if (sets.length === 0) return [];
  const rows = await rawRows<{ user_id: string; pr: number; pd: number; nr: number; nd: number }>(
    tx,
    sql`update chat_members c set ${sql.join(sets, sql`, `)}
        from (select user_id, last_read_seq, last_delivered_seq from chat_members
              where chat_id = ${chatId} and user_id = any(${uuidArray(userIds)})) o
        where c.chat_id = ${chatId} and c.user_id = o.user_id
        returning c.user_id, o.last_read_seq as pr, o.last_delivered_seq as pd, c.last_read_seq as nr, c.last_delivered_seq as nd`,
  );
  return rows.map((r) => ({ userId: r.user_id, prev: { read: num(r.pr), delivered: num(r.pd) }, next: { read: num(r.nr), delivered: num(r.nd) } }));
}

export interface AdvanceResult {
  /** The member's read (or delivered) position after the call. */
  seq: number;
  advanced: boolean;
}

/**
 * `chat:read` / `POST /chats/:id/read` (identical semantics): lock the chat, clamp `seq` to
 * the member's highest visible seq ≤ seq, GREATEST read AND delivered, set last_read_at,
 * clear marked_unread. Registers: `chat:read` → user:<me>, `chat:watermarks` → members whose
 * ticks changed, domain `chat.read` (push dismiss when unread messages were cleared).
 * 404 when the user has no (visible) membership row. Former members may mark their window read.
 */
export async function advanceRead(tx: Tx, fx: Effects, input: { chatId: string; userId: string; seq: number }): Promise<AdvanceResult> {
  const { chatId, userId } = input;
  const chat = await lockChat(tx, chatId);
  const member = await getMembership(tx, chatId, userId);
  if (!member || member.hidden) throw notFound('Chat');
  const w = windowOf(member);
  const target = (await maxVisibleSeq(tx, chatId, w, Math.min(input.seq, windowEnd(chat, member)))) ?? 0;
  const prevRead = Number(member.lastReadSeq);
  let clearedUnread = member.markedUnread;
  if (!clearedUnread && target > prevRead) {
    const [row] = await rawRows<{ x: number }>(
      tx,
      sql`select 1 as x from chat_members cm join messages m on m.chat_id = cm.chat_id
          where cm.chat_id = ${chatId} and cm.user_id = ${userId}
            and m.seq > ${prevRead}::bigint and m.seq <= ${target}::bigint and ${memberVisibleSql('m', 'cm')}
            and m.sender_id is distinct from cm.user_id and m.type <> 'system'
          limit 1`,
    );
    clearedUnread = !!row;
  }
  const [bumped] = await bumpMarks(tx, chatId, [userId], { read: target, delivered: target, clearMarkedUnread: true });
  const next = bumped?.next.read ?? prevRead;
  const advanced = next > prevRead || (bumped?.next.delivered ?? 0) > (bumped?.prev.delivered ?? 0);
  fx.chatRead(userId, chatId);
  if (!member.leftAt && bumped && advanced) fx.watermarks({ chatId, members: [{ userId, prev: bumped.prev }] });
  fx.domain('chat.read', { userId, chatId, lastReadSeq: next, clearedUnread });
  return { seq: next, advanced: next > prevRead };
}

/** Advance one member's delivered mark (clamped like reads). Registers `chat:watermarks` for changed members. */
export async function advanceDelivered(tx: Tx, fx: Effects, input: { chatId: string; userId: string; seq: number }): Promise<AdvanceResult> {
  const { chatId, userId } = input;
  const chat = await lockChat(tx, chatId);
  const member = await getMembership(tx, chatId, userId);
  if (!member || member.leftAt) throw notFound('Chat');
  const target = (await maxVisibleSeq(tx, chatId, windowOf(member), Math.min(input.seq, windowEnd(chat, member)))) ?? 0;
  const [bumped] = await bumpMarks(tx, chatId, [userId], { delivered: target });
  const prev = Number(member.lastDeliveredSeq);
  const next = bumped?.next.delivered ?? prev;
  if (bumped && next > prev) fx.watermarks({ chatId, members: [{ userId, prev: bumped.prev }] });
  return { seq: next, advanced: next > prev };
}

/**
 * Server-driven delivered receipts (a) — inside the message's transaction: advance
 * `last_delivered_seq` to `seq` for the recipients with ≥ 1 connected socket. `recipientIds`
 * must be active members who can see the message (the sender and withheld recipients
 * excluded). Returns the previous marks for `Effects.watermarks`.
 */
export async function markDeliveredForOnlineRecipients(
  tx: DbOrTx,
  input: { chatId: string; seq: number; recipientIds: string[] },
): Promise<{ userId: string; prev: Marks }[]> {
  const online = input.recipientIds.filter((id) => isOnline(id));
  const rows = await bumpMarks(tx, input.chatId, online, { delivered: input.seq });
  return rows.map((r) => ({ userId: r.userId, prev: r.prev }));
}

/**
 * Server-driven delivered receipts (b) — on socket connect, before `ready` (registered as an
 * `onBeforeReady` hook by the chats module): ONE statement advances the user's
 * last_delivered_seq to the latest visible seq of every active non-channel chat (lateral
 * top-1 per chat on the (chat_id, seq) index), then `chat:watermarks` goes to the members
 * whose ticks changed. It writes only the connecting user's own member rows (locked in
 * chat_id order) and takes no chat locks: a concurrent send already sees the user online
 * and advances its own delivery, and GREATEST keeps the rows monotonic.
 */
export async function markDeliveredOnConnect(userId: string): Promise<void> {
  const fx = new Effects();
  await db.transaction(async (tx) => {
    const rows = await rawRows<{ chat_id: string; pr: number; pd: number }>(
      tx,
      sql`with target as (
            select cm.chat_id, cm.last_read_seq as pr, cm.last_delivered_seq as pd, v.seq
            from chat_members cm
            join chats c on c.id = cm.chat_id and c.type <> 'channel'
            cross join lateral (
              select m.seq from messages m
              where m.chat_id = cm.chat_id and m.seq > cm.last_delivered_seq and ${memberVisibleSql('m', 'cm')}
              order by m.seq desc limit 1
            ) v
            where cm.user_id = ${userId} and cm.left_at is null
            order by cm.chat_id
            for update of cm
          )
          update chat_members x set last_delivered_seq = t.seq, last_delivered_at = now()
          from target t
          where x.chat_id = t.chat_id and x.user_id = ${userId} and x.last_delivered_seq < t.seq
          returning x.chat_id, t.pr, t.pd`,
    );
    for (const r of rows) fx.watermarks({ chatId: r.chat_id, members: [{ userId, prev: { read: num(r.pr), delivered: num(r.pd) } }] });
    await fx.prepare(tx);
  });
  fx.flush();
}

/**
 * Register watermark recomputation for all of a user's direct chats after their
 * `readReceipts` setting changed (PATCH /me/settings): `chat:watermarks` → me and peers
 * whose read watermark changed.
 */
export async function readReceiptsChanged(dbx: DbOrTx, fx: Effects, userId: string, previousValue: boolean): Promise<void> {
  const rows = await dbx
    .select({ chatId: chatMembers.chatId })
    .from(chatMembers)
    .innerJoin(chats, eq(chats.id, chatMembers.chatId))
    .where(and(eq(chatMembers.userId, userId), sql`${chatMembers.leftAt} is null`, eq(chats.type, 'direct')));
  for (const r of rows) fx.watermarks({ chatId: r.chatId, members: [], prevReadReceipts: { userId, value: previousValue } });
}

// ---------------------------------------------------------------------------
// Standalone publishers (post-commit only; they use the global db)
// ---------------------------------------------------------------------------

/**
 * Emit `chat:watermarks` with the current values to the given users (default: every active
 * member). Prefer `Effects.watermarks(delta)`, which only emits to members whose value
 * changed. Never emits for channels.
 */
export async function publishWatermarks(chatId: string, userIds?: string[]): Promise<void> {
  const [chat] = await db.select({ type: chats.type }).from(chats).where(eq(chats.id, chatId)).limit(1);
  if (!chat || chat.type === 'channel') return;
  const map = await computeWatermarks(db, chatId, userIds);
  for (const [userId, w] of map) emitToUser(userId, 'chat:watermarks', { chatId, ...w });
}

/** Emit `chat:read` with the user's current read state to their own devices. */
export async function publishReadState(userId: string, chatId: string): Promise<void> {
  const s = await readState(db, userId, chatId);
  if (s) emitToUser(userId, 'chat:read', { chatId, ...s });
}
