import { Router } from 'express';
import { and, eq, isNull } from 'drizzle-orm';
import {
  USER_RATE_LIMITS,
  idParamSchema,
  sendFriendRequestSchema,
  type SendFriendRequestResult,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';
import {
  acceptFriendRequest,
  cantAdd,
  dropFriendRequests,
  loadFriendRequests,
  removeFriend,
  sendFriendRequest,
} from './service.js';

/**
 * Friends module — owns /friends/*. Paths are relative to /api (ApiRoutes in @enbox/shared);
 * mounted behind requireAuth. Rules and events: service.ts.
 *
 *   GET    /friends/requests                 incoming and outgoing, newest first
 *   POST   /friends/requests                 { username } | { userId } → { status }
 *   POST   /friends/requests/:userId/accept  their request to me → friends
 *   DELETE /friends/requests/:userId         decline theirs or cancel mine
 *   DELETE /friends/:userId                  remove a friend (both contact rows)
 */
export const router = Router();

router.get('/friends/requests', async (req, res) => {
  res.json(await loadFriendRequests(db, authUserId(req)));
});

/**
 * Send a request by username (case-insensitive, an `@` in front is fine) or user id. Rate
 * limit `friendRequest`, counted before the lookup so it also caps username probing. Every
 * target I can't reach — unknown, deleted, a block either way, `friendRequestsFrom` refusing
 * me — gets the same 404; myself 400; already friends 409; too many pending 409.
 */
router.post('/friends/requests', async (req, res) => {
  const me = authUserId(req);
  const body = parse(sendFriendRequestSchema, req.body ?? {});
  assertUserLimit(me, 'friendRequest', USER_RATE_LIMITS.friendRequest);
  const where = body.username
    ? eq(users.username, body.username.replace(/^@/, '').trim().toLowerCase())
    : eq(users.id, body.userId!);
  const [target] = await db
    .select({ id: users.id })
    .from(users)
    .where(and(where, isNull(users.deletedAt)))
    .limit(1);
  if (!target) throw cantAdd();
  if (target.id === me) throw badRequest("You can't add yourself as a friend");
  const status = await transact((tx, fx) => sendFriendRequest(tx, fx, me, target.id));
  res.json({ status } satisfies SendFriendRequestResult);
});

router.post('/friends/requests/:userId/accept', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  const accepted = await transact((tx, fx) => acceptFriendRequest(tx, fx, me, userId));
  if (!accepted) throw notFound('Friend request');
  res.status(204).end();
});

router.delete('/friends/requests/:userId', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  const removed = await transact((tx, fx) => dropFriendRequests(tx, fx, me, userId));
  if (removed === 0) throw notFound('Friend request');
  res.status(204).end();
});

router.delete('/friends/:userId', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  const removed = await transact((tx, fx) => removeFriend(tx, fx, me, userId));
  if (!removed) throw notFound('Friend');
  res.status(204).end();
});
