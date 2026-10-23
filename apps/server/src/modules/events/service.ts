/**
 * Events module service: scheduled events of a Space (docs/design/discord-parity.md W12-E).
 * Create, list, edit, start / end / cancel, delete, Interested, and the leader job that
 * starts and ends them (jobs/events.ts).
 *
 * Permissions until they move to 64 bits (all 31 bits are in use): creating takes
 * MANAGE_CHANNELS (Discord's CREATE_EVENTS); editing, starting, ending, canceling and
 * deleting take the event's creator or MANAGE_SPACE (Discord's MANAGE_EVENTS). A voice
 * event's channel is a voice channel of the Space that the creator (or editor) can see. Any
 * member reads the events and marks themselves Interested; the creator starts interested.
 *
 * Wire: `SpaceEvent`. Room payloads (`space:event` → the Space room) are viewer-neutral
 * (`interested: false`); REST responses carry the caller's own `interested`.
 *
 * Lifecycle: scheduled → active (an organizer, from EVENT_START_EARLY_MS before the start
 * time; external events also at their start time, by the job) → completed (an organizer; the
 * job at the end time of an external event, and VOICE_EVENT_END_GRACE_MS past the end of a
 * voice event — VOICE_EVENT_MAX_OPEN_MS past its start without one); scheduled → canceled (an
 * organizer; the job VOICE_EVENT_STALE_MS past the start of a voice event nobody started).
 * Completed and canceled events leave the lists (the rows stay until deleted). Becoming
 * active sends `space:event-started` to every interested member but the organizer who
 * started it (their own rooms: the in-app reminder) and a web push to those not in do not
 * disturb. Deleting a voice channel closes its events (completed when live, else canceled).
 * Deleting an account takes back its interest (the counts follow).
 */
import { and, asc, count, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  MAX_SPACE_EVENTS,
  PERM,
  hasPerm,
  isDnd,
  rooms,
  type PushPayload,
  type SpaceEvent,
  type SpaceEventEntity,
  type SpaceEventStatus,
  type UserPublic,
  type createSpaceEventSchema,
  type updateSpaceEventSchema,
} from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import {
  chats,
  media,
  pushSubscriptions,
  spaceEventInterests,
  spaceEvents,
  spaceMembers,
  spaces,
  users,
} from '../../db/schema.js';
import { badRequest, conflict, forbidden, limitReached, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { storableDate } from '../../lib/validate.js';
import { emitToRooms, emitToUsers } from '../../realtime/emit.js';
import { transact, type Effects } from '../../services/effects.js';
import { registerAccountDeletionHook, registerChatDeletionHook } from '../../services/hooks.js';
import { requireBannerMedia, staticMediaUrl } from '../../services/media.js';
import {
  channelBits,
  loadChannelOverwrites,
  lockSpace,
  requireSpaceMember,
  requireSpacePermission,
  type SpaceAccess,
} from '../../services/spaceAccess.js';
import { audit } from '../../services/spaces.js';
import { rawRows, uniq, uuidArray } from '../../services/sql.js';
import { toUserPublics } from '../../services/users.js';
import { deliverPush, getPushSender, trackPush, type PushEntry } from '../push/sender.js';

export type CreateEventBody = z.output<typeof createSpaceEventSchema>;
export type UpdateEventBody = z.output<typeof updateSpaceEventSchema>;
export type SpaceEventRow = typeof spaceEvents.$inferSelect;

/** Organizers may start an event this long before its start time. */
export const EVENT_START_EARLY_MS = 15 * 60_000;
/** How far ahead an event may be scheduled. */
export const EVENT_MAX_AHEAD_MS = 365 * 24 * 3600_000;
/** The job completes a live voice event this long after its end time… */
export const VOICE_EVENT_END_GRACE_MS = 3600_000;
/** …or, without an end time, this long after its start. */
export const VOICE_EVENT_MAX_OPEN_MS = 24 * 3600_000;
/** The job cancels a voice event nobody started this long after its start time. */
export const VOICE_EVENT_STALE_MS = 2 * 3600_000;
/** The events job: events per transaction. */
export const EVENTS_JOB_BATCH = 200;
/** Creates, edits, status changes and deletes per user (abuse protection). */
export const EVENT_UPDATE_LIMIT = { limit: 60, windowMs: 10 * 60_000 } as const;
/** Interested toggles per user (each one reaches the whole Space room). */
export const EVENT_INTEREST_LIMIT = { limit: 120, windowMs: 10 * 60_000 } as const;
/** `GET …/interested` page size (and its maximum). */
export const INTERESTED_PAGE_LIMIT = 100;
/** The "Event starting" push outlives a phone that is off this long. */
const EVENT_PUSH_TTL_SEC = 3600;

const OPEN: SpaceEventStatus[] = ['scheduled', 'active'];
const isOpen = (s: SpaceEventStatus) => s === 'scheduled' || s === 'active';
const byIds = (ids: readonly string[]) => sql`${spaceEvents.id} = any(${uuidArray(ids)})`;
const iso = (d: Date | null) => d?.toISOString() ?? null;

// ---------------------------------------------------------------------------
// Wire
// ---------------------------------------------------------------------------

interface LoadedEvent {
  row: SpaceEventRow;
  image: { storageKey: string; thumbnailKey: string | null; animated: boolean } | null;
}

/** The wire form; the cover is always the still image (the poster of an animated upload). */
export function toSpaceEvent({ row, image }: LoadedEvent, interested: boolean): SpaceEvent {
  return {
    id: row.id,
    spaceId: row.spaceId,
    channelId: row.channelId,
    creatorId: row.creatorId,
    name: row.name,
    description: row.description,
    entityType: row.entityType,
    location: row.location,
    startAt: row.startAt.toISOString(),
    endAt: iso(row.endAt),
    status: row.status,
    imageUrl: image ? staticMediaUrl(image) : null,
    interestedCount: row.interestedCount,
    interested,
  };
}

/** Events with their cover image, by start time (one query). */
async function loadEvents(dbx: DbOrTx, where: SQL | undefined): Promise<LoadedEvent[]> {
  const rows = await dbx
    .select({
      row: spaceEvents,
      storageKey: media.storageKey,
      thumbnailKey: media.thumbnailKey,
      animated: media.animated,
    })
    .from(spaceEvents)
    .leftJoin(media, eq(media.id, spaceEvents.imageMediaId))
    .where(where)
    .orderBy(asc(spaceEvents.startAt), asc(spaceEvents.id));
  return rows.map((r) => ({
    row: r.row,
    image: r.storageKey
      ? { storageKey: r.storageKey, thumbnailKey: r.thumbnailKey, animated: r.animated ?? false }
      : null,
  }));
}

/** The events among `eventIds` that `userId` is interested in. */
async function myInterests(
  dbx: DbOrTx,
  userId: string,
  eventIds: readonly string[],
): Promise<Set<string>> {
  if (eventIds.length === 0) return new Set();
  const rows = await dbx
    .select({ eventId: spaceEventInterests.eventId })
    .from(spaceEventInterests)
    .where(
      and(
        eq(spaceEventInterests.userId, userId),
        sql`${spaceEventInterests.eventId} = any(${uuidArray(eventIds)})`,
      ),
    );
  return new Set(rows.map((r) => r.eventId));
}

/** One event as `userId` sees it (404 when gone). */
async function eventFor(dbx: DbOrTx, eventId: string, userId: string): Promise<SpaceEvent> {
  const [loaded] = await loadEvents(dbx, eq(spaceEvents.id, eventId));
  if (!loaded) throw notFound('Event');
  return toSpaceEvent(loaded, (await myInterests(dbx, userId, [eventId])).has(eventId));
}

/** The interested users of each event who are still members of its Space (one query). */
async function interestedMembers(
  dbx: DbOrTx,
  eventIds: readonly string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (eventIds.length === 0) return out;
  const rows = await dbx
    .select({ eventId: spaceEventInterests.eventId, userId: spaceEventInterests.userId })
    .from(spaceEventInterests)
    .innerJoin(spaceEvents, eq(spaceEvents.id, spaceEventInterests.eventId))
    .innerJoin(
      spaceMembers,
      and(
        eq(spaceMembers.spaceId, spaceEvents.spaceId),
        eq(spaceMembers.userId, spaceEventInterests.userId),
      ),
    )
    .where(sql`${spaceEventInterests.eventId} = any(${uuidArray(eventIds)})`);
  for (const r of rows) {
    const list = out.get(r.eventId) ?? [];
    list.push(r.userId);
    out.set(r.eventId, list);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

interface Reminder {
  event: SpaceEvent;
  userIds: string[];
}

/**
 * After commit: `space:event` (viewer-neutral) → each event's Space room, as of the end of
 * the transaction. With `started`, then `space:event-started` (`interested: true`, it only
 * goes to them) → the interested members of the events that are active, and their push —
 * except `startedBy`, the organizer who just started it.
 */
export function fxEventsChanged(
  fx: Effects,
  ids: readonly string[],
  opts: { started?: boolean; startedBy?: string } = {},
): void {
  if (ids.length === 0) return;
  let events: SpaceEvent[] = [];
  let reminders: Reminder[] = [];
  fx.add(
    () => {
      for (const event of events)
        emitToRooms([rooms.space(event.spaceId)], 'space:event', { spaceId: event.spaceId, event });
      for (const r of reminders)
        emitToUsers(r.userIds, 'space:event-started', { spaceId: r.event.spaceId, event: r.event });
      if (reminders.length) trackPush(pushEventsStarted(reminders));
    },
    async (dbx) => {
      const loaded = await loadEvents(dbx, byIds(uniq(ids)));
      events = loaded.map((l) => toSpaceEvent(l, false));
      if (!opts.started) return;
      const live = loaded.filter((l) => l.row.status === 'active');
      const audience = await interestedMembers(
        dbx,
        live.map((l) => l.row.id),
      );
      reminders = live
        .map((l) => ({
          event: toSpaceEvent(l, true),
          userIds: (audience.get(l.row.id) ?? []).filter((id) => id !== opts.startedBy),
        }))
        .filter((r) => r.userIds.length > 0);
    },
  );
}

/** "Event starting" web push to the interested members with a subscription, not in do not disturb. */
async function pushEventsStarted(reminders: Reminder[]): Promise<void> {
  if (!getPushSender()) return;
  const ids = uniq(reminders.flatMap((r) => r.userIds));
  const targets = await db
    .select({
      id: users.id,
      availability: users.availability,
      availabilityUntil: users.availabilityUntil,
    })
    .from(users)
    .where(
      and(
        sql`${users.id} = any(${uuidArray(ids)})`,
        isNull(users.deletedAt),
        sql`exists (select 1 from ${pushSubscriptions} where ${pushSubscriptions.userId} = ${users.id})`,
      ),
    );
  const now = Date.now();
  const wanted = new Set(targets.filter((u) => !isDnd(u, now)).map((u) => u.id));
  if (wanted.size === 0) return;
  const names = new Map(
    (
      await db
        .select({ id: spaces.id, name: spaces.name })
        .from(spaces)
        .where(inArray(spaces.id, uniq(reminders.map((r) => r.event.spaceId))))
    ).map((s) => [s.id, s.name]),
  );
  const entries: PushEntry[] = [];
  for (const { event, userIds } of reminders) {
    const payload: PushPayload = {
      type: 'message',
      title: `Event starting: ${event.name}`,
      body: names.get(event.spaceId) ?? '',
      tag: `event:${event.id}`,
      url: `/spaces/${event.spaceId}?event=${event.id}`,
    };
    for (const userId of userIds)
      if (wanted.has(userId))
        entries.push({ userId, payload, opts: { ttl: EVENT_PUSH_TTL_SEC, urgency: 'normal' } });
  }
  await deliverPush(entries);
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** What an event is (the editable columns). */
interface Draft {
  name: string;
  description: string | null;
  entityType: SpaceEventEntity;
  channelId: string | null;
  location: string | null;
  startAt: Date;
  endAt: Date | null;
  imageMediaId: string | null;
}

/** 400 with the field in zod-style details (forms show it at the field). */
function invalid(field: string, message: string) {
  return badRequest(`${field}: ${message}`, [{ code: 'custom', path: [field], message }]);
}

function assertStartWindow(startAt: Date, now: number): void {
  if (startAt.getTime() <= now) throw invalid('startAt', 'The start time must be in the future');
  if (startAt.getTime() > now + EVENT_MAX_AHEAD_MS)
    throw invalid('startAt', 'Events can be scheduled at most a year ahead');
}

/** Somewhere else: a location and an end time, no channel. Voice: a channel, no location. */
function assertShape(d: Draft): void {
  if (d.entityType === 'external') {
    if (!d.location) throw invalid('location', 'Events somewhere else need a location');
    if (d.channelId) throw invalid('channelId', 'Events somewhere else have no channel');
    if (!d.endAt) throw invalid('endAt', 'Events somewhere else need an end time');
  } else {
    if (!d.channelId) throw invalid('channelId', 'Pick a voice channel');
    if (d.location) throw invalid('location', 'Voice events have no location');
  }
  if (d.endAt && d.endAt.getTime() <= d.startAt.getTime())
    throw invalid('endAt', 'The end time must be after the start time');
}

/** 400 unless `channelId` is a voice channel of the Space that the member of `access` can see. */
async function assertVoiceChannel(
  tx: DbOrTx,
  access: SpaceAccess,
  userId: string,
  channelId: string,
): Promise<void> {
  const [chat] = await tx
    .select({ type: chats.type, spaceId: chats.spaceId })
    .from(chats)
    .where(eq(chats.id, channelId))
    .limit(1);
  if (!chat || chat.spaceId !== access.ctx.spaceId) throw invalid('channelId', 'Unknown channel');
  // Voice events happen in a voice channel or on a Stage.
  if (chat.type !== 'space_voice' && chat.type !== 'space_stage')
    throw invalid('channelId', 'Pick a voice channel');
  const overwrites = (await loadChannelOverwrites(tx, [channelId])).get(channelId) ?? [];
  const bits = channelBits(access.ctx, userId, access.me, 'space_voice', overwrites, access.base);
  if (!hasPerm(bits, PERM.VIEW_CHANNEL)) throw invalid('channelId', 'Unknown channel');
}

/** 403 unless I created the event or may manage the Space. */
function assertOrganizer(access: SpaceAccess, me: string, event: SpaceEventRow): void {
  if (event.creatorId !== me && !hasPerm(access.base, PERM.MANAGE_SPACE))
    throw forbidden(
      'Only the creator of the event and members who can manage the Space can change it',
    );
}

/** The event row, locked `FOR UPDATE` (404 unless it is an event of this Space). */
async function lockEvent(tx: DbOrTx, spaceId: string, eventId: string): Promise<SpaceEventRow> {
  const [row] = await tx
    .select()
    .from(spaceEvents)
    .where(and(eq(spaceEvents.id, eventId), eq(spaceEvents.spaceId, spaceId)))
    .for('update');
  if (!row) throw notFound('Event');
  return row;
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

/** `GET /spaces/:spaceId/events` (members): the scheduled and active events by start time. */
export async function listEvents(me: string, spaceId: string): Promise<SpaceEvent[]> {
  const access = await requireSpaceMember(db, spaceId, me);
  const all = await loadEvents(
    db,
    and(eq(spaceEvents.spaceId, spaceId), inArray(spaceEvents.status, OPEN)),
  );
  // Voice events in a channel I can't see stay hidden from me (as in Discord).
  const overwrites = await loadChannelOverwrites(
    db,
    uniq(all.map((l) => l.row.channelId).filter((id): id is string => !!id)),
  );
  const loaded = all.filter(
    (l) =>
      !l.row.channelId ||
      hasPerm(
        channelBits(access.ctx, me, access.me, 'space_voice', overwrites.get(l.row.channelId) ?? [], access.base),
        PERM.VIEW_CHANNEL,
      ),
  );
  const mine = await myInterests(
    db,
    me,
    loaded.map((l) => l.row.id),
  );
  return loaded.map((l) => toSpaceEvent(l, mine.has(l.row.id)));
}

/**
 * `GET /spaces/:spaceId/events/:eventId/interested?after=&limit=` (members): who is
 * interested and still a member, earliest first, as UserPublic for me. Keyset cursor
 * `after`: the last user of the previous page (no longer interested → empty page).
 */
export async function listInterested(
  me: string,
  spaceId: string,
  eventId: string,
  q: { after?: string; limit: number },
): Promise<UserPublic[]> {
  await requireSpaceMember(db, spaceId, me);
  const [event] = await db
    .select({ id: spaceEvents.id })
    .from(spaceEvents)
    .where(and(eq(spaceEvents.id, eventId), eq(spaceEvents.spaceId, spaceId)))
    .limit(1);
  if (!event) throw notFound('Event');
  const ofEvent = eq(spaceEventInterests.eventId, eventId);
  let cursor: { at: Date; userId: string } | null = null;
  if (q.after) {
    const [c] = await db
      .select({ at: spaceEventInterests.createdAt })
      .from(spaceEventInterests)
      .where(and(ofEvent, eq(spaceEventInterests.userId, q.after)))
      .limit(1);
    if (!c) return [];
    cursor = { at: c.at, userId: q.after };
  }
  const rows = await db
    .select({ userId: spaceEventInterests.userId })
    .from(spaceEventInterests)
    .innerJoin(
      spaceMembers,
      and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, spaceEventInterests.userId)),
    )
    .where(
      and(
        ofEvent,
        cursor
          ? sql`(${spaceEventInterests.createdAt}, ${spaceEventInterests.userId}) > (${cursor.at.toISOString()}::timestamptz, ${cursor.userId}::uuid)`
          : undefined,
      ),
    )
    .orderBy(asc(spaceEventInterests.createdAt), asc(spaceEventInterests.userId))
    .limit(q.limit);
  return toUserPublics(
    db,
    me,
    rows.map((r) => r.userId),
  );
}

// ---------------------------------------------------------------------------
// Create, edit, delete
// ---------------------------------------------------------------------------

/**
 * `POST /spaces/:spaceId/events` (MANAGE_CHANNELS) → SpaceEvent (201). The start is in the
 * future and at most a year ahead; at most MAX_SPACE_EVENTS scheduled or active per Space
 * (409 `limit_reached`, the Space row is locked so the cap holds); the cover is my own banner
 * upload. The creator is interested from the start. Audited; `space:event` → the Space room.
 */
export async function createEvent(
  me: string,
  spaceId: string,
  body: CreateEventBody,
): Promise<SpaceEvent> {
  assertUserLimit(me, 'spaceEventUpdate', EVENT_UPDATE_LIMIT);
  return transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(
      tx,
      spaceId,
      me,
      PERM.MANAGE_CHANNELS,
      'You do not have permission to create events in this Space',
    );
    const draft: Draft = {
      name: body.name,
      description: body.description || null,
      entityType: body.entityType,
      channelId: body.channelId ?? null,
      location: body.location || null,
      startAt: storableDate(body.startAt, 'startAt'),
      endAt: body.endAt ? storableDate(body.endAt, 'endAt') : null,
      imageMediaId: body.imageMediaId ?? null,
    };
    assertStartWindow(draft.startAt, Date.now());
    assertShape(draft);
    const [n] = await tx
      .select({ n: count() })
      .from(spaceEvents)
      .where(and(eq(spaceEvents.spaceId, spaceId), inArray(spaceEvents.status, OPEN)));
    if (Number(n?.n ?? 0) >= MAX_SPACE_EVENTS)
      throw limitReached(`A Space can have at most ${MAX_SPACE_EVENTS} upcoming events`);
    if (draft.channelId) await assertVoiceChannel(tx, access, me, draft.channelId);
    if (draft.imageMediaId) await requireBannerMedia(tx, draft.imageMediaId, me);
    const [row] = await tx
      .insert(spaceEvents)
      .values({ ...draft, spaceId, creatorId: me, interestedCount: 1 })
      .returning();
    await tx.insert(spaceEventInterests).values({ eventId: row!.id, userId: me });
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'event.create',
      targetId: row!.id,
      changes: { name: draft.name, entityType: draft.entityType, startAt: iso(draft.startAt) },
    });
    fxEventsChanged(fx, [row!.id]);
    return eventFor(tx, row!.id, me);
  });
}

/**
 * `PATCH /spaces/:spaceId/events/:eventId` (the creator or MANAGE_SPACE) → SpaceEvent. Any
 * field of a scheduled or active event (409 once it is over); a live event keeps its start
 * time and its kind of place. A moved start must be in the future (≤ a year ahead). Switching
 * between voice and somewhere else drops what no longer applies (the channel or the
 * location). `status`: `active` starts a scheduled event (from EVENT_START_EARLY_MS before
 * its start; the interested get `space:event-started`), `completed` ends a live one,
 * `canceled` cancels a scheduled one (else 409). Audited; `space:event` → the Space room.
 */
export async function updateEvent(
  me: string,
  spaceId: string,
  eventId: string,
  body: UpdateEventBody,
): Promise<SpaceEvent> {
  assertUserLimit(me, 'spaceEventUpdate', EVENT_UPDATE_LIMIT);
  return transact(async (tx, fx) => {
    const access = await requireSpaceMember(tx, spaceId, me);
    const cur = await lockEvent(tx, spaceId, eventId);
    assertOrganizer(access, me, cur);
    if (!isOpen(cur.status)) throw conflict('This event is over');
    const now = Date.now();

    const entityType = body.entityType ?? cur.entityType;
    const switched = entityType !== cur.entityType;
    const next: Draft = {
      name: body.name ?? cur.name,
      description: body.description !== undefined ? body.description || null : cur.description,
      entityType,
      channelId:
        body.channelId !== undefined
          ? body.channelId
          : switched && entityType === 'external'
            ? null
            : cur.channelId,
      location:
        body.location !== undefined
          ? body.location || null
          : switched && entityType === 'voice'
            ? null
            : cur.location,
      startAt: body.startAt !== undefined ? storableDate(body.startAt, 'startAt') : cur.startAt,
      endAt:
        body.endAt !== undefined
          ? body.endAt
            ? storableDate(body.endAt, 'endAt')
            : null
          : cur.endAt,
      imageMediaId: body.imageMediaId !== undefined ? body.imageMediaId : cur.imageMediaId,
    };
    const startMoved = next.startAt.getTime() !== cur.startAt.getTime();
    if (cur.status === 'active' && startMoved)
      throw invalid('startAt', 'The start time of a live event cannot change');
    if (cur.status === 'active' && switched)
      throw invalid('entityType', 'A live event cannot move to another kind of place');
    if (startMoved) assertStartWindow(next.startAt, now);
    assertShape(next);
    if (next.channelId && (switched || next.channelId !== cur.channelId))
      await assertVoiceChannel(tx, access, me, next.channelId);
    if (next.imageMediaId && next.imageMediaId !== cur.imageMediaId)
      await requireBannerMedia(tx, next.imageMediaId, me);

    let status: SpaceEventStatus = cur.status;
    if (body.status && body.status !== cur.status) {
      if (body.status === 'active') {
        if (now < next.startAt.getTime() - EVENT_START_EARLY_MS)
          throw invalid('status', 'The event can start from 15 minutes before its start time');
      } else if (body.status === 'completed') {
        if (cur.status !== 'active') throw conflict('Only a live event can be ended');
      } else if (cur.status !== 'scheduled') {
        throw conflict('A live event can be ended, not canceled');
      }
      status = body.status;
    }

    const before: Record<string, unknown> = {
      name: cur.name,
      description: cur.description,
      entityType: cur.entityType,
      channelId: cur.channelId,
      location: cur.location,
      startAt: iso(cur.startAt),
      endAt: iso(cur.endAt),
      imageMediaId: cur.imageMediaId,
      status: cur.status,
    };
    const after: Record<string, unknown> = {
      ...next,
      startAt: iso(next.startAt),
      endAt: iso(next.endAt),
      status,
    };
    const changes: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(after)) if (before[k] !== v) changes[k] = [before[k], v];
    if (Object.keys(changes).length === 0) return eventFor(tx, eventId, me);

    await tx
      .update(spaceEvents)
      .set({ ...next, status, updatedAt: new Date() })
      .where(eq(spaceEvents.id, eventId));
    await audit(tx, { spaceId, actorId: me, action: 'event.update', targetId: eventId, changes });
    fxEventsChanged(fx, [eventId], {
      started: cur.status === 'scheduled' && status === 'active',
      startedBy: me,
    });
    return eventFor(tx, eventId, me);
  });
}

/**
 * `DELETE /spaces/:spaceId/events/:eventId` (the creator or MANAGE_SPACE) → 204: the event
 * and its interest rows. Audited; `space:event-deleted` → the Space room.
 */
export async function deleteEvent(me: string, spaceId: string, eventId: string): Promise<void> {
  assertUserLimit(me, 'spaceEventUpdate', EVENT_UPDATE_LIMIT);
  await transact(async (tx, fx) => {
    const access = await requireSpaceMember(tx, spaceId, me);
    const cur = await lockEvent(tx, spaceId, eventId);
    assertOrganizer(access, me, cur);
    await tx.delete(spaceEvents).where(eq(spaceEvents.id, eventId));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'event.delete',
      targetId: eventId,
      changes: { name: cur.name },
    });
    fx.add(() => emitToRooms([rooms.space(spaceId)], 'space:event-deleted', { spaceId, eventId }));
  });
}

// ---------------------------------------------------------------------------
// Interested
// ---------------------------------------------------------------------------

/**
 * `PUT` / `DELETE /spaces/:spaceId/events/:eventId/interested` (members) → SpaceEvent with
 * my `interested`. Idempotent; a change moves `interested_count` in the same transaction
 * (the event row is locked, so concurrent toggles count right) and sends `space:event` with
 * the new count. Marking a finished event is 409; unmarking always works.
 */
export async function setInterested(
  me: string,
  spaceId: string,
  eventId: string,
  on: boolean,
): Promise<SpaceEvent> {
  assertUserLimit(me, 'spaceEventInterest', EVENT_INTEREST_LIMIT);
  return transact(async (tx, fx) => {
    await requireSpaceMember(tx, spaceId, me);
    const cur = await lockEvent(tx, spaceId, eventId);
    const mine = and(eq(spaceEventInterests.eventId, eventId), eq(spaceEventInterests.userId, me));
    if (on) {
      if (!isOpen(cur.status)) throw conflict('This event is over');
      const [added] = await tx
        .insert(spaceEventInterests)
        .values({ eventId, userId: me })
        .onConflictDoNothing()
        .returning({ eventId: spaceEventInterests.eventId });
      if (added) {
        await tx
          .update(spaceEvents)
          .set({ interestedCount: sql`${spaceEvents.interestedCount} + 1` })
          .where(eq(spaceEvents.id, eventId));
        fxEventsChanged(fx, [eventId]);
      }
    } else {
      const [gone] = await tx
        .delete(spaceEventInterests)
        .where(mine)
        .returning({ eventId: spaceEventInterests.eventId });
      if (gone) await uncount(tx, fx, [eventId]);
    }
    return eventFor(tx, eventId, me);
  });
}

/** `interested_count - 1` on each event (one interest row of each is gone); `space:event` for the open ones. */
async function uncount(tx: DbOrTx, fx: Effects, eventIds: readonly string[]): Promise<void> {
  if (eventIds.length === 0) return;
  const rows = await tx
    .update(spaceEvents)
    .set({ interestedCount: sql`greatest(${spaceEvents.interestedCount} - 1, 0)` })
    .where(byIds(eventIds))
    .returning({ id: spaceEvents.id, status: spaceEvents.status });
  fxEventsChanged(
    fx,
    rows.filter((r) => isOpen(r.status)).map((r) => r.id),
  );
}

// ---------------------------------------------------------------------------
// The events job (leader, every minute: jobs/events.ts)
// ---------------------------------------------------------------------------

/**
 * Move every due event in `where` to `to`: batches of `batch` rows taken `FOR UPDATE SKIP
 * LOCKED` (an event mid-edit is simply taken next time), the partial index
 * `space_events_open_idx` bounding the scan. Returns how many moved.
 */
async function sweep(where: SQL, to: SpaceEventStatus, now: Date, batch: number): Promise<number> {
  let total = 0;
  for (;;) {
    const n = await transact(async (tx, fx) => {
      const due = await rawRows<{ id: string }>(
        tx,
        sql`select id from space_events
            where ${where}
            order by start_at
            limit ${batch}
            for update skip locked`,
      );
      if (due.length === 0) return 0;
      const ids = due.map((r) => r.id);
      await tx.update(spaceEvents).set({ status: to, updatedAt: now }).where(byIds(ids));
      fxEventsChanged(fx, ids, { started: to === 'active' });
      return ids.length;
    });
    total += n;
    if (n < batch) return total;
  }
}

/**
 * One run of the events job at `now`:
 * 1. external events whose start time came start (the interested get `space:event-started`);
 * 2. external events whose end time came complete (one that was never started too);
 * 3. live voice events complete VOICE_EVENT_END_GRACE_MS past their end time
 *    (VOICE_EVENT_MAX_OPEN_MS past their start without one) — organizers start voice events;
 * 4. voice events nobody started are canceled VOICE_EVENT_STALE_MS past their start time.
 */
export async function runEventsJob(
  opts: { now?: Date; batch?: number } = {},
): Promise<{ started: number; completed: number; canceled: number }> {
  const now = opts.now ?? new Date();
  const batch = opts.batch ?? EVENTS_JOB_BATCH;
  const at = (ms = 0) => sql`${new Date(now.getTime() - ms).toISOString()}::timestamptz`;
  const started = await sweep(
    sql`status = 'scheduled' and entity_type = 'external' and start_at <= ${at()} and end_at > ${at()}`,
    'active',
    now,
    batch,
  );
  const ended = await sweep(
    sql`status in ('scheduled', 'active') and entity_type = 'external' and start_at <= ${at()} and end_at <= ${at()}`,
    'completed',
    now,
    batch,
  );
  const closed = await sweep(
    sql`status = 'active' and entity_type = 'voice' and start_at <= ${at()}
        and (end_at < ${at(VOICE_EVENT_END_GRACE_MS)} or (end_at is null and start_at < ${at(VOICE_EVENT_MAX_OPEN_MS)}))`,
    'completed',
    now,
    batch,
  );
  const canceled = await sweep(
    sql`status = 'scheduled' and entity_type = 'voice' and start_at < ${at(VOICE_EVENT_STALE_MS)}`,
    'canceled',
    now,
    batch,
  );
  return { started, completed: ended + closed, canceled };
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

// A voice channel is deleted: its events close (a live one completes, the others cancel).
registerChatDeletionHook('events', async (tx, fx, chatIds) => {
  const closed = await tx
    .update(spaceEvents)
    .set({
      status: sql`case when ${spaceEvents.status} = 'active' then 'completed' else 'canceled' end`,
      updatedAt: new Date(),
    })
    .where(
      and(
        sql`${spaceEvents.channelId} = any(${uuidArray(chatIds)})`,
        inArray(spaceEvents.status, OPEN),
      ),
    )
    .returning({ id: spaceEvents.id });
  fxEventsChanged(
    fx,
    closed.map((r) => r.id),
  );
});

// An account is deleted (the user row stays, scrubbed): its interest goes and the counts follow.
registerAccountDeletionHook('events', async (tx, fx, userId) => {
  const gone = await tx
    .delete(spaceEventInterests)
    .where(eq(spaceEventInterests.userId, userId))
    .returning({ eventId: spaceEventInterests.eventId });
  await uncount(
    tx,
    fx,
    gone.map((g) => g.eventId),
  );
});
