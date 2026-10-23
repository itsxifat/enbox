import { Router } from 'express';
import { and, desc, eq, sql } from 'drizzle-orm';
import { idParamSchema, type ChatSummary, type FollowedThreads } from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { chats, threadFollows } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { getChatAccess } from '../../services/chats.js';
import { transact, type Effects } from '../../services/effects.js';
import { requireSpaceMember } from '../../services/spaceAccess.js';
import { spaceChannelSummariesForPairs } from '../../services/spaceSummaries.js';
import { pairKey, rawRows } from '../../services/sql.js';
import './followHooks.js';

/**
 * Following posts and threads (Discord's Follow Post / Join Thread). A follow is a
 * `thread_follows` row (thread, user, the thread's Space): my sidebar lists what I follow under
 * its channel and my summaries say so (`ThreadInfo.following`). Creating a post or a thread,
 * and sending a message in one, follow it (`autoFollowThread`). Paths are relative to /api
 * (see ApiRoutes in @enbox/shared); mounted behind requireAuth.
 *
 *   PUT    /threads/:threadId/follow          ChatSummary: follow it (thread:follow → my devices)
 *   DELETE /threads/:threadId/follow          unfollow it
 *   GET    /spaces/:spaceId/followed-threads  FollowedThreads: what I follow there (sidebar)
 */
export const router = Router();

/** Followed threads listed per Space. */
export const FOLLOWED_THREADS_LIMIT = 100;

const threadParams = idParamSchema('threadId');
const spaceParams = idParamSchema('spaceId');

/**
 * Follow a thread for `userId` unless they already do: one statement, conflicts ignored. With
 * `fx`, a new follow reaches the user's devices (`thread:follow`) after commit. Returns whether
 * it is new.
 */
export async function autoFollowThread(
  dbx: DbOrTx,
  threadId: string,
  userId: string,
  fx?: Effects,
): Promise<boolean> {
  const [row] = await rawRows<{ parent_id: string; space_id: string }>(
    dbx,
    sql`with t as (
          select id, parent_id, space_id from chats
          where id = ${threadId}::uuid and type = 'space_thread' and space_id is not null
        ), ins as (
          insert into thread_follows (thread_id, user_id, space_id)
          select id, ${userId}::uuid, space_id from t
          on conflict do nothing
          returning thread_id
        )
        select t.parent_id, t.space_id from t join ins on ins.thread_id = t.id`,
  );
  if (!row) return false;
  fx?.toUser(userId, 'thread:follow', {
    threadId,
    parentId: row.parent_id,
    spaceId: row.space_id,
    following: true,
  });
  return true;
}

/** The viewer's summary of a thread (404 when they cannot see it). */
async function threadSummaryFor(userId: string, threadId: string): Promise<ChatSummary> {
  const s = (await spaceChannelSummariesForPairs(db, [{ chatId: threadId, userId }])).get(
    pairKey(threadId, userId),
  );
  if (!s) throw notFound('Thread');
  return s;
}

/**
 * `PUT /threads/:threadId/follow` → the thread's ChatSummary, `following: true` (404 unless I
 * can see it). Idempotent; a new follow reaches my devices.
 */
export async function followThread(me: string, threadId: string): Promise<ChatSummary> {
  await transact(async (tx, fx) => {
    const access = await getChatAccess(tx, me, threadId);
    if (access.chat.type !== 'space_thread') throw notFound('Thread');
    await autoFollowThread(tx, threadId, me, fx);
  });
  return threadSummaryFor(me, threadId);
}

/**
 * `DELETE /threads/:threadId/follow` → 204, also once I can no longer see the thread (it only
 * drops my own row). Idempotent; a removed follow reaches my devices.
 */
export async function unfollowThread(me: string, threadId: string): Promise<void> {
  await transact(async (tx, fx) => {
    const [gone] = await tx
      .delete(threadFollows)
      .where(and(eq(threadFollows.threadId, threadId), eq(threadFollows.userId, me)))
      .returning({ spaceId: threadFollows.spaceId });
    if (!gone) return;
    const [t] = await tx
      .select({ parentId: chats.parentId })
      .from(chats)
      .where(eq(chats.id, threadId))
      .limit(1);
    if (t?.parentId)
      fx.toUser(me, 'thread:follow', {
        threadId,
        parentId: t.parentId,
        spaceId: gone.spaceId,
        following: false,
      });
  });
}

/**
 * `GET /spaces/:spaceId/followed-threads` (members, 404 otherwise): the posts and threads I
 * follow there that I can still see — open ones first, then by last activity, at most
 * FOLLOWED_THREADS_LIMIT — as my summaries.
 */
export async function followedThreads(me: string, spaceId: string): Promise<FollowedThreads> {
  await requireSpaceMember(db, spaceId, me);
  const rows = await db
    .select({ id: chats.id })
    .from(threadFollows)
    .innerJoin(chats, eq(chats.id, threadFollows.threadId))
    .where(and(eq(threadFollows.userId, me), eq(threadFollows.spaceId, spaceId)))
    .orderBy(sql`${chats.threadArchivedAt} is not null`, desc(chats.lastMessageAt), desc(chats.id))
    .limit(FOLLOWED_THREADS_LIMIT);
  const map = await spaceChannelSummariesForPairs(
    db,
    rows.map((r) => ({ chatId: r.id, userId: me })),
  );
  return {
    threads: rows.map((r) => map.get(pairKey(r.id, me))).filter((s): s is ChatSummary => !!s),
  };
}

router.put('/threads/:threadId/follow', async (req, res) => {
  const me = authUserId(req);
  const { threadId } = parse(threadParams, req.params);
  res.json(await followThread(me, threadId));
});

router.delete('/threads/:threadId/follow', async (req, res) => {
  const me = authUserId(req);
  const { threadId } = parse(threadParams, req.params);
  await unfollowThread(me, threadId);
  res.status(204).end();
});

router.get('/spaces/:spaceId/followed-threads', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(spaceParams, req.params);
  res.json(await followedThreads(me, spaceId));
});
