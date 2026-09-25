/**
 * Status updates (stories): audience snapshot, feed, views/reactions, deletion and expiry
 * (docs/ARCHITECTURE.md "Status updates"). Visibility of one status for view/reaction/
 * status replies is the shared `requireVisibleStatus` (services/statuses.ts).
 *
 * - Audience (resolved at post time, stored on the row): `contacts` = my contacts;
 *   `contacts_except` = contacts − statusExcludeUserIds; `only_share_with` =
 *   statusOnlyShareWithUserIds ∩ contacts; always minus blocks (either way) and deleted users.
 * - Viewers with `readReceipts` off: their view is recorded (`viewed: true` for them) but
 *   they are excluded from `viewCount`/viewers and trigger no `status:viewed` (evaluated
 *   with their current setting).
 */
import { and, asc, desc, eq, gt, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  DEFAULT_USER_SETTINGS,
  STATUS_BACKGROUND_COLORS,
  STATUS_TTL_MS,
  resolveUserSettings,
  type Status,
  type StatusFeed,
  type StatusFeedItem,
  type StatusViewer,
  type UserPublic,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { blocks, contacts, statusViews, statuses, users, type StatusRow } from '../../db/schema.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { emitToUser } from '../../realtime/emit.js';
import { transact, type Effects } from '../../services/effects.js';
import { loadMediaMap, requireOwnedMedia, toMediaAttachment } from '../../services/media.js';
import { pairKey, rawRows, uniq, uuidArray } from '../../services/sql.js';
import { requireVisibleStatus } from '../../services/statuses.js';
import { blockedEitherWayIds, getUserRow, requireUser, settingsOf, toUserPublic, toUserPublicMap, toUserPublicsForPairs } from '../../services/users.js';

/** Viewers whose (current) read-receipt setting lets the author see their view. */
const receiptsOnSql = (settingsCol: unknown) =>
  sql`coalesce((${settingsCol}->>'readReceipts')::boolean, ${DEFAULT_USER_SETTINGS.readReceipts})`;

// ---------------------------------------------------------------------------
// Audience
// ---------------------------------------------------------------------------

/** The audience snapshot of a new status by `authorId` (see module doc). */
export async function resolveStatusAudience(dbx: DbOrTx, authorId: string): Promise<string[]> {
  const author = await requireUser(dbx, authorId);
  const s = settingsOf(author);
  const rows = await dbx
    .select({ id: contacts.contactId })
    .from(contacts)
    .innerJoin(users, eq(users.id, contacts.contactId))
    .where(and(eq(contacts.ownerId, authorId), isNull(users.deletedAt)))
    .orderBy(asc(contacts.contactId));
  let ids = rows.map((r) => r.id).filter((id) => id !== authorId);
  if (s.statusPrivacy === 'contacts_except') {
    const excluded = new Set(s.statusExcludeUserIds.map((id) => id.toLowerCase()));
    ids = ids.filter((id) => !excluded.has(id));
  } else if (s.statusPrivacy === 'only_share_with') {
    const only = new Set(s.statusOnlyShareWithUserIds.map((id) => id.toLowerCase()));
    ids = ids.filter((id) => only.has(id));
  }
  const blocked = await blockedEitherWayIds(dbx, authorId, ids);
  return ids.filter((id) => !blocked.has(id));
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/** `viewCount` per status: views by non-deleted viewers with read receipts on. */
async function viewCounts(dbx: DbOrTx, statusIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (statusIds.length === 0) return out;
  const rows = await rawRows<{ status_id: string; n: number }>(
    dbx,
    sql`select sv.status_id, count(*)::int as n
        from status_views sv join users u on u.id = sv.viewer_id
        where sv.status_id = any(${uuidArray(statusIds)}) and u.deleted_at is null and ${receiptsOnSql(sql.raw('u.settings'))}
        group by sv.status_id`,
  );
  for (const r of rows) out.set(r.status_id, Number(r.n));
  return out;
}

/** Viewer-specific `Status` models (input order; a fixed number of queries). */
export async function toStatuses(dbx: DbOrTx, viewerId: string, rows: StatusRow[]): Promise<Status[]> {
  if (rows.length === 0) return [];
  const mediaMap = await loadMediaMap(
    dbx,
    rows.map((r) => r.mediaId),
  );
  const own = rows.filter((r) => r.userId === viewerId).map((r) => r.id);
  const others = rows.filter((r) => r.userId !== viewerId).map((r) => r.id);
  const counts = await viewCounts(dbx, own);
  const viewed = new Set<string>();
  if (others.length) {
    const views = await dbx
      .select({ statusId: statusViews.statusId })
      .from(statusViews)
      .where(and(eq(statusViews.viewerId, viewerId), inArray(statusViews.statusId, others)));
    for (const v of views) viewed.add(v.statusId);
  }
  return rows.map((r) => {
    const mine = r.userId === viewerId;
    const m = r.mediaId ? mediaMap.get(r.mediaId) : undefined;
    return {
      id: r.id,
      userId: r.userId,
      type: r.type,
      text: r.text,
      backgroundColor: r.backgroundColor,
      font: r.font,
      media: m ? toMediaAttachment(m) : null,
      createdAt: r.createdAt.toISOString(),
      expiresAt: r.expiresAt.toISOString(),
      viewed: mine || viewed.has(r.id),
      viewCount: mine ? (counts.get(r.id) ?? 0) : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * `GET /status/feed`: my live statuses (oldest first) and other users' live statuses whose
 * audience includes me (author not deleted, no block either way now), grouped per author
 * (statuses oldest first); unviewed groups first, then by lastUpdatedAt desc.
 */
export async function loadStatusFeed(dbx: DbOrTx, me: string): Promise<StatusFeed> {
  const now = new Date();
  const mineRows = await dbx
    .select()
    .from(statuses)
    .where(and(eq(statuses.userId, me), gt(statuses.expiresAt, now)))
    .orderBy(asc(statuses.createdAt), asc(statuses.id));
  const otherRows = (
    await dbx
      .select({ status: statuses })
      .from(statuses)
      .innerJoin(users, eq(users.id, statuses.userId))
      .where(
        and(
          sql`${statuses.audience} @> ${uuidArray([me])}`,
          gt(statuses.expiresAt, now),
          ne(statuses.userId, me),
          isNull(users.deletedAt),
          sql`not exists (select 1 from ${blocks} b where (b.blocker_id = ${me} and b.blocked_id = ${statuses.userId})
                or (b.blocker_id = ${statuses.userId} and b.blocked_id = ${me}))`,
        ),
      )
      .orderBy(asc(statuses.createdAt), asc(statuses.id))
  ).map((r) => r.status);

  const all = await toStatuses(dbx, me, [...mineRows, ...otherRows]);
  const mine = all.slice(0, mineRows.length);
  const byAuthor = new Map<string, Status[]>();
  for (const s of all.slice(mineRows.length)) {
    const list = byAuthor.get(s.userId) ?? [];
    list.push(s);
    byAuthor.set(s.userId, list);
  }
  const authors = await toUserPublicMap(dbx, me, byAuthor.keys());
  const updates: StatusFeedItem[] = [];
  for (const [userId, list] of byAuthor) {
    const user = authors.get(userId);
    if (!user) continue;
    updates.push({ user, statuses: list, allViewed: list.every((s) => s.viewed), lastUpdatedAt: list[list.length - 1]!.createdAt });
  }
  updates.sort((a, b) => Number(a.allViewed) - Number(b.allViewed) || b.lastUpdatedAt.localeCompare(a.lastUpdatedAt));
  return { mine, updates };
}

/** `GET /status/:id/viewers` (author only): non-deleted viewers with read receipts on, most recent first. */
export async function loadStatusViewers(dbx: DbOrTx, me: string, statusId: string): Promise<StatusViewer[]> {
  const status = await requireVisibleStatus(dbx, me, statusId);
  if (status.userId !== me) throw forbidden('Only the author can see who viewed a status');
  const rows = await dbx
    .select({ viewerId: statusViews.viewerId, viewedAt: statusViews.viewedAt, reaction: statusViews.reaction, settings: users.settings })
    .from(statusViews)
    .innerJoin(users, eq(users.id, statusViews.viewerId))
    .where(and(eq(statusViews.statusId, statusId), isNull(users.deletedAt)))
    .orderBy(desc(statusViews.viewedAt), asc(statusViews.viewerId));
  const visible = rows.filter((r) => resolveUserSettings(r.settings).readReceipts);
  const pubs = await toUserPublicMap(
    dbx,
    me,
    visible.map((r) => r.viewerId),
  );
  return visible.flatMap((r) => {
    const user = pubs.get(r.viewerId);
    return user ? [{ user, viewedAt: r.viewedAt.toISOString(), reaction: r.reaction }] : [];
  });
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export type CreateStatusInput =
  | { type: 'text'; text: string; backgroundColor?: string; font?: number }
  | { type: 'image' | 'video'; mediaId: string; text?: string };

/**
 * `POST /status`: media must be my upload of the matching kind; the audience is snapshotted.
 * Events: `status:new` → each audience member (their view of me), then → me.
 */
export async function createStatus(me: string, input: CreateStatusInput): Promise<Status> {
  return transact(async (tx, fx) => {
    let mediaId: string | null = null;
    if (input.type !== 'text') {
      await requireOwnedMedia(tx, input.mediaId, me, { kinds: [input.type] });
      mediaId = input.mediaId;
    }
    const audience = await resolveStatusAudience(tx, me);
    const now = new Date();
    const isText = input.type === 'text';
    const [row] = await tx
      .insert(statuses)
      .values({
        userId: me,
        type: input.type,
        text: input.text ? input.text : null,
        backgroundColor: isText ? (input.backgroundColor ?? STATUS_BACKGROUND_COLORS[0]) : null,
        font: isText ? (input.font ?? 0) : null,
        mediaId,
        audience,
        createdAt: now,
        expiresAt: new Date(now.getTime() + STATUS_TTL_MS),
      })
      .returning();
    const [own] = await toStatuses(tx, me, [row!]);
    const forAudience: Status = { ...own!, viewed: false, viewCount: null };
    let pubs = new Map<string, UserPublic>();
    fx.add(
      () => {
        for (const viewerId of audience) {
          const user = pubs.get(pairKey(viewerId, me));
          if (user) emitToUser(viewerId, 'status:new', { status: forAudience, user });
        }
        const self = pubs.get(pairKey(me, me));
        if (self) emitToUser(me, 'status:new', { status: own!, user: self });
      },
      async (dbx) => {
        pubs = await toUserPublicsForPairs(
          dbx,
          [...audience, me].map((viewerId) => ({ viewerId, subjectId: me })),
        );
      },
    );
    return own!;
  });
}

/** `DELETE /status/:id` (author): `status:deleted` → the audience and me. Others: 404 unless visible, then 403. */
export async function deleteStatus(me: string, statusId: string): Promise<void> {
  await transact(async (tx, fx) => {
    const [row] = await tx.select().from(statuses).where(eq(statuses.id, statusId)).limit(1).for('update');
    if (!row) throw notFound('Status');
    if (row.userId !== me) {
      await requireVisibleStatus(tx, me, statusId);
      throw forbidden('Only the author can delete a status');
    }
    await tx.delete(statuses).where(eq(statuses.id, statusId));
    fx.toUsers(uniq([...row.audience, me]), 'status:deleted', { statusId, userId: me });
  });
}

/** Register `status:viewed` → author unless the viewer has read receipts off. */
async function notifyAuthor(
  tx: Tx,
  fx: Effects,
  authorId: string,
  viewerId: string,
  view: { statusId: string; viewedAt: Date; reaction: string | null },
): Promise<void> {
  const viewer = await getUserRow(tx, viewerId);
  if (!viewer || !settingsOf(viewer).readReceipts) return;
  let user: UserPublic | null = null;
  fx.add(
    () => {
      if (user) emitToUser(authorId, 'status:viewed', { statusId: view.statusId, viewer: { user, viewedAt: view.viewedAt.toISOString(), reaction: view.reaction } });
    },
    async (dbx) => {
      user = await toUserPublic(dbx, authorId, viewerId);
    },
  );
}

/** `POST /status/:id/view` (audience; the author's own view is a no-op). First view only notifies. */
export async function viewStatus(me: string, statusId: string): Promise<void> {
  await transact(async (tx, fx) => {
    const status = await requireVisibleStatus(tx, me, statusId);
    if (status.userId === me) return;
    const [view] = await tx.insert(statusViews).values({ statusId, viewerId: me, viewedAt: new Date() }).onConflictDoNothing().returning();
    if (view) await notifyAuthor(tx, fx, status.userId, me, view);
  });
}

/** `PUT /status/:id/reaction` (audience only): records a view with my reaction (replacing it). */
export async function reactToStatus(me: string, statusId: string, emoji: string): Promise<void> {
  await transact(async (tx, fx) => {
    const status = await requireVisibleStatus(tx, me, statusId);
    if (status.userId === me) throw forbidden("You can't react to your own status");
    const [view] = await tx
      .insert(statusViews)
      .values({ statusId, viewerId: me, viewedAt: new Date(), reaction: emoji })
      .onConflictDoUpdate({ target: [statusViews.statusId, statusViews.viewerId], set: { reaction: emoji } })
      .returning();
    await notifyAuthor(tx, fx, status.userId, me, view!);
  });
}

/** Account deletion: delete my statuses (`status:deleted` → their audiences) and my views. */
export async function deleteUserStatusesTx(tx: Tx, fx: Effects, userId: string): Promise<void> {
  const rows = await tx.delete(statuses).where(eq(statuses.userId, userId)).returning({ id: statuses.id, audience: statuses.audience });
  for (const r of rows) fx.toUsers(r.audience, 'status:deleted', { statusId: r.id, userId });
  await tx.delete(statusViews).where(eq(statusViews.viewerId, userId));
}

/** Expiry job: delete expired statuses in batches (views cascade; media refs go with the row). */
export async function purgeExpiredStatuses(opts: { batchSize?: number } = {}): Promise<number> {
  const batch = opts.batchSize ?? 500;
  let total = 0;
  for (;;) {
    const rows = await rawRows<{ id: string }>(
      db,
      sql`delete from statuses where id in (
            select id from statuses where expires_at <= now() order by expires_at limit ${batch} for update skip locked
          ) returning id`,
    );
    total += rows.length;
    if (rows.length < batch) break;
  }
  return total;
}
