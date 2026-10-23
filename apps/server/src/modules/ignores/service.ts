/**
 * Ignore (docs/design/discord-parity.md W7-F; contracts in @enbox/shared safety.ts): a silent,
 * one-way quieting of someone. They are never told and nothing changes for them; for me:
 * - no pushes from them in DMs, groups or Spaces (`silencedRecipients`: one query per
 *   message, which also covers recipients who blocked the sender);
 * - on the web their messages collapse behind "Ignored message — Show", their typing is
 *   hidden and they raise no desktop notifications (the client keeps my list, kept fresh by
 *   `ignores:changed`).
 *
 * Changes to my list are serialized per user (a transaction-scoped advisory lock), so the
 * MAX_IGNORED_USERS cap holds under concurrent requests. Events: `ignores:changed { userIds }`
 * (my whole list, newest first, as committed) → my devices, only when the list changed.
 */
import { and, asc, count, desc, eq, sql } from 'drizzle-orm';
import { MAX_IGNORED_USERS, type ID, type UserPublic } from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { userIgnores } from '../../db/schema.js';
import { badRequest, limitReached, notFound } from '../../lib/errors.js';
import { emitToUser } from '../../realtime/emit.js';
import { transact, type Effects } from '../../services/effects.js';
import { rawRows, uniq, uuidArray } from '../../services/sql.js';
import { lockLiveUsers, requireUser, toUserPublics } from '../../services/users.js';

/** Ignore / unignore requests per user (abuse guard: each change fans out my whole list). */
export const IGNORE_RATE_LIMIT = { limit: 60, windowMs: 60_000 };

/** The users I ignore, newest first. */
export async function ignoredIds(dbx: DbOrTx, userId: ID): Promise<ID[]> {
  const rows = await dbx
    .select({ id: userIgnores.ignoredId })
    .from(userIgnores)
    .where(eq(userIgnores.userId, userId))
    .orderBy(desc(userIgnores.createdAt), asc(userIgnores.ignoredId));
  return rows.map((r) => r.id);
}

/** `GET /me/ignores`: my view of everyone I ignore, newest first. */
export async function listIgnored(dbx: DbOrTx, me: ID): Promise<UserPublic[]> {
  const users = await toUserPublics(dbx, me, await ignoredIds(dbx, me));
  return users.filter((u) => !u.isDeleted);
}

/**
 * Those of `recipientIds` who ignore or blocked `senderId`: their pushes from this sender are
 * dropped (DMs, groups, Space mentions). One query whatever the number of recipients.
 */
export async function silencedRecipients(
  dbx: DbOrTx,
  senderId: ID,
  recipientIds: Iterable<ID>,
): Promise<Set<ID>> {
  const ids = uniq(recipientIds).filter((id) => id !== senderId);
  if (ids.length === 0) return new Set();
  const list = uuidArray(ids);
  const rows = await rawRows<{ user_id: string }>(
    dbx,
    sql`select user_id from user_ignores where ignored_id = ${senderId} and user_id = any(${list})
        union
        select blocker_id from blocks where blocked_id = ${senderId} and blocker_id = any(${list})`,
  );
  return new Set(rows.map((r) => r.user_id));
}

/** Serialize changes of my ignore list until the end of the transaction. */
async function lockIgnores(tx: DbOrTx, me: ID): Promise<void> {
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${`enbox:ignores:${me}`}, 0))`,
  );
}

/** `ignores:changed` → my devices, with the list as of the end of the transaction. */
function ignoresChanged(fx: Effects, me: ID): void {
  let userIds: ID[] = [];
  fx.add(
    () => emitToUser(me, 'ignores:changed', { userIds }),
    async (dbx) => {
      userIds = await ignoredIds(dbx, me);
    },
  );
}

/**
 * `PUT /users/:userId/ignore` (idempotent: already ignored → nothing emitted). Not myself
 * (400), existing accounts only (404, deleted included), at most MAX_IGNORED_USERS (409).
 */
export async function ignoreUser(me: ID, userId: ID): Promise<void> {
  if (userId === me) throw badRequest("You can't ignore yourself");
  await requireUser(db, userId);
  await transact(async (tx, fx) => {
    await lockIgnores(tx, me);
    // FOR SHARE: an account deletion committing meanwhile is waited for, then seen.
    if (!(await lockLiveUsers(tx, [userId])).has(userId)) throw notFound('User');
    const [existing] = await tx
      .select({ id: userIgnores.ignoredId })
      .from(userIgnores)
      .where(and(eq(userIgnores.userId, me), eq(userIgnores.ignoredId, userId)))
      .limit(1);
    if (existing) return;
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(userIgnores)
      .where(eq(userIgnores.userId, me));
    if (Number(n) >= MAX_IGNORED_USERS)
      throw limitReached(`You can ignore up to ${MAX_IGNORED_USERS} people`);
    await tx.insert(userIgnores).values({ userId: me, ignoredId: userId });
    ignoresChanged(fx, me);
  });
}

/** `DELETE /users/:userId/ignore` (idempotent; unknown ids 404, deleted accounts allowed). */
export async function unignoreUser(me: ID, userId: ID): Promise<void> {
  await requireUser(db, userId, { allowDeleted: true });
  await transact(async (tx, fx) => {
    await lockIgnores(tx, me);
    const removed = await tx
      .delete(userIgnores)
      .where(and(eq(userIgnores.userId, me), eq(userIgnores.ignoredId, userId)))
      .returning({ id: userIgnores.ignoredId });
    if (removed.length) ignoresChanged(fx, me);
  });
}
