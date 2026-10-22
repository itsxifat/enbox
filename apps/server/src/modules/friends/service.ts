/**
 * Friend requests and friendships (docs/design/discord-parity.md W7-A; contracts in
 * @enbox/shared social.ts). A friend is someone in my contacts: accepting a request saves
 * both users as each other's contacts (name null, so each shows under their own display
 * name), and the "contacts" privacy levels cover friends with no change.
 *
 * Everything that changes a pair's requests or friendship takes a transaction-scoped
 * advisory lock on the pair (`lockPair`). Simultaneous requests both ways therefore become
 * one friendship, and a block can't miss a request sent while it commits. The friend routes
 * take it first; the block route takes it last (after its chat lock), and nothing holding it
 * ever waits for a chat or block lock, so it never closes a deadlock cycle.
 *
 * Events (mutation → event matrix, same shapes as the contacts routes):
 * - new request: `friends:request { request }` → them, `friends:changed` → me (my other
 *   devices), then a push to them;
 * - accept: `friends:changed` → both, `contacts:changed` → each user whose contacts gained a
 *   row, `user:changed { owner }` → the saved user, and the owners' presence re-evaluated
 *   (exactly what POST /contacts emits per added contact);
 * - decline / cancel / dropped by a block: `friends:changed` → both;
 * - remove: like accept, with the contact rows deleted.
 */
import { and, asc, count, desc, eq, isNull, or, sql, type SQL } from 'drizzle-orm';
import {
  MAX_PENDING_FRIEND_REQUESTS,
  type FriendRequest,
  type FriendRequests,
  type ID,
  type SendFriendRequestResult,
} from '@enbox/shared';
import type { DbOrTx } from '../../db/index.js';
import { contacts, friendRequests, users } from '../../db/schema.js';
import { HttpError, conflict, limitReached } from '../../lib/errors.js';
import { emitToUser } from '../../realtime/emit.js';
import type { Effects } from '../../services/effects.js';
import { rawRows } from '../../services/sql.js';
import {
  blockedEitherWay,
  settingsOf,
  toUserPublic,
  toUserPublicMap,
} from '../../services/users.js';
import { trackPush } from '../push/sender.js';
import { reevaluatePresence } from '../users/presence.js';
import { pushFriendEvent } from './push.js';

/**
 * The one answer for every target I can't send a request to: unknown, deleted, blocked either
 * way, or refusing requests from me. It never says which.
 */
export const CANT_ADD_MESSAGE = "Hm, didn't work. Double check the username.";
export const cantAdd = () => new HttpError(404, 'not_found', CANT_ADD_MESSAGE);

/** Serialize every change of the pair {a, b} until the end of the transaction. */
export async function lockPair(tx: DbOrTx, a: ID, b: ID): Promise<void> {
  const [lo, hi] = a < b ? [a, b] : [b, a];
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`enbox:friends:${lo}:${hi}`}, 0))`,
  );
}

/** Requests between a and b, both directions. */
function requestsBetween(a: ID, b: ID): SQL {
  return or(
    and(eq(friendRequests.fromId, a), eq(friendRequests.toId, b)),
    and(eq(friendRequests.fromId, b), eq(friendRequests.toId, a)),
  )!;
}

/** Contact rows between a and b, both directions. */
function contactsBetween(a: ID, b: ID): SQL {
  return or(
    and(eq(contacts.ownerId, a), eq(contacts.contactId, b)),
    and(eq(contacts.ownerId, b), eq(contacts.contactId, a)),
  )!;
}

/** We are both members of at least one Space. */
async function shareASpace(dbx: DbOrTx, a: ID, b: ID): Promise<boolean> {
  const rows = await rawRows<{ x: number }>(
    dbx,
    sql`select 1 as x from space_members m
        join space_members o on o.space_id = m.space_id and o.user_id = ${b}
        where m.user_id = ${a}
        limit 1`,
  );
  return rows.length > 0;
}

/**
 * Contact rows added or deleted between users: `contacts:changed` → each owner, then
 * `user:changed { owner }` → each saved user (their view of the owner changed), then the
 * owners' presence subscribers are re-evaluated.
 */
function contactRowsChanged(fx: Effects, rows: { ownerId: ID; contactId: ID }[]): void {
  if (rows.length === 0) return;
  for (const r of rows) fx.toUser(r.ownerId, 'contacts:changed', {});
  for (const r of rows) fx.toUser(r.contactId, 'user:changed', { userId: r.ownerId });
  fx.add(() => {
    for (const r of rows) void reevaluatePresence(r.ownerId);
  });
}

/** `friends:request { request }` → the target, with the sender as the target sees them at commit. */
function requestEffect(fx: Effects, row: { fromId: ID; toId: ID; createdAt: Date }): Effects {
  let request: FriendRequest | null = null;
  return fx.add(
    () => {
      if (request) emitToUser(row.toId, 'friends:request', { request });
    },
    async (dbx) => {
      const user = await toUserPublic(dbx, row.toId, row.fromId);
      request = user
        ? { user, direction: 'incoming', createdAt: row.createdAt.toISOString() }
        : null;
    },
  );
}

/**
 * Make a and b friends (inside the pair lock): the requests between them go, both contact
 * rows are ensured (an existing row keeps its saved name).
 */
async function befriend(tx: DbOrTx, fx: Effects, a: ID, b: ID): Promise<void> {
  await tx.delete(friendRequests).where(requestsBetween(a, b));
  const added = await tx
    .insert(contacts)
    .values([
      { ownerId: a, contactId: b, name: null },
      { ownerId: b, contactId: a, name: null },
    ])
    .onConflictDoNothing()
    .returning({ ownerId: contacts.ownerId, contactId: contacts.contactId });
  fx.toUsers([a, b], 'friends:changed', {});
  contactRowsChanged(fx, added);
}

/**
 * `POST /friends/requests` for a resolved, other user `them` (inside a transaction). Order:
 * gone or blocked → not found; already friends → 409; they asked me first (or already saved
 * me) → friends now; already asked → `sent` again with no events; their `friendRequestsFrom`
 * refuses me → not found; MAX_PENDING_FRIEND_REQUESTS of mine pending → 409; else a new
 * request.
 */
export async function sendFriendRequest(
  tx: DbOrTx,
  fx: Effects,
  me: ID,
  them: ID,
): Promise<SendFriendRequestResult['status']> {
  await lockPair(tx, me, them);
  // FOR SHARE waits for a concurrent account deletion of theirs (FOR NO KEY UPDATE).
  const [target] = await tx
    .select({ settings: users.settings })
    .from(users)
    .where(and(eq(users.id, them), isNull(users.deletedAt)))
    .for('share');
  if (!target || (await blockedEitherWay(tx, me, them))) throw cantAdd();

  const saved = await tx
    .select({ ownerId: contacts.ownerId })
    .from(contacts)
    .where(contactsBetween(me, them));
  const iSaved = saved.some((r) => r.ownerId === me);
  const theySaved = saved.some((r) => r.ownerId === them);
  if (iSaved && theySaved) throw conflict("You're already friends");

  const pending = await tx
    .select({ fromId: friendRequests.fromId })
    .from(friendRequests)
    .where(requestsBetween(me, them));
  const theyAsked = pending.some((r) => r.fromId === them);
  if (theyAsked || theySaved) {
    // They want this too (a request, or I'm already in their friends): no new request.
    await befriend(tx, fx, me, them);
    if (theyAsked) fx.add(() => trackPush(pushFriendEvent('accepted', me, them)));
    return 'accepted';
  }
  if (pending.length > 0) return 'sent';

  const from = settingsOf(target).friendRequestsFrom;
  if (from === 'nobody' || (from === 'spaces' && !(await shareASpace(tx, me, them))))
    throw cantAdd();

  const [{ n } = { n: 0 }] = await tx
    .select({ n: count() })
    .from(friendRequests)
    .where(eq(friendRequests.fromId, me));
  if (n >= MAX_PENDING_FRIEND_REQUESTS)
    throw limitReached(
      `You can have up to ${MAX_PENDING_FRIEND_REQUESTS} pending friend requests. Cancel some to send more.`,
    );

  const [row] = await tx.insert(friendRequests).values({ fromId: me, toId: them }).returning();
  requestEffect(fx, row!);
  fx.toUser(me, 'friends:changed', {});
  fx.add(() => trackPush(pushFriendEvent('request', me, them)));
  return 'sent';
}

/** Accept `them`'s request to me (inside a transaction); false when there is none. */
export async function acceptFriendRequest(
  tx: DbOrTx,
  fx: Effects,
  me: ID,
  them: ID,
): Promise<boolean> {
  await lockPair(tx, me, them);
  const [request] = await tx
    .select({ fromId: friendRequests.fromId })
    .from(friendRequests)
    .where(and(eq(friendRequests.fromId, them), eq(friendRequests.toId, me)));
  if (!request) return false;
  await befriend(tx, fx, me, them);
  fx.add(() => trackPush(pushFriendEvent('accepted', me, them)));
  return true;
}

/**
 * Delete the requests between a and b, both ways (decline, cancel, or a block: blocking
 * someone drops what is pending between us). `friends:changed` → both when any existed;
 * returns how many went.
 */
export async function dropFriendRequests(tx: DbOrTx, fx: Effects, a: ID, b: ID): Promise<number> {
  await lockPair(tx, a, b);
  const removed = await tx
    .delete(friendRequests)
    .where(requestsBetween(a, b))
    .returning({ fromId: friendRequests.fromId });
  if (removed.length) fx.toUsers([a, b], 'friends:changed', {});
  return removed.length;
}

/**
 * Remove a friend: both contact rows go (and any request left between us). False when they
 * are not in my contacts (nothing changes then).
 */
export async function removeFriend(tx: DbOrTx, fx: Effects, me: ID, them: ID): Promise<boolean> {
  await lockPair(tx, me, them);
  const [mine] = await tx
    .select({ ownerId: contacts.ownerId })
    .from(contacts)
    .where(and(eq(contacts.ownerId, me), eq(contacts.contactId, them)))
    .for('update');
  if (!mine) return false;
  const removed = await tx
    .delete(contacts)
    .where(contactsBetween(me, them))
    .returning({ ownerId: contacts.ownerId, contactId: contacts.contactId });
  await tx.delete(friendRequests).where(requestsBetween(me, them));
  fx.toUsers([me, them], 'friends:changed', {});
  contactRowsChanged(fx, removed);
  return true;
}

/**
 * My pending requests, newest first, with the other user as I see them: one query for the
 * requests plus `toUserPublicMap` (users, contacts, blocks) whatever their number. Deleted
 * accounts are left out (their requests go with them anyway).
 */
export async function loadFriendRequests(dbx: DbOrTx, me: ID): Promise<FriendRequests> {
  const rows = await dbx
    .select()
    .from(friendRequests)
    .where(or(eq(friendRequests.fromId, me), eq(friendRequests.toId, me)))
    .orderBy(desc(friendRequests.createdAt), asc(friendRequests.fromId), asc(friendRequests.toId));
  const otherOf = (r: (typeof rows)[number]) => (r.fromId === me ? r.toId : r.fromId);
  const publics = await toUserPublicMap(dbx, me, rows.map(otherOf));
  const out: FriendRequests = { incoming: [], outgoing: [] };
  for (const r of rows) {
    const user = publics.get(otherOf(r));
    if (!user || user.isDeleted) continue;
    const direction = r.fromId === me ? 'outgoing' : 'incoming';
    out[direction].push({ user, direction, createdAt: r.createdAt.toISOString() });
  }
  return out;
}
