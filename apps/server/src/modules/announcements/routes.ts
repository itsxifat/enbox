import { Router } from 'express';
import { followChannelSchema, idParamSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import {
  followChannel,
  listFollowers,
  listSpaceFollows,
  publishMessage,
  unfollowChannel,
} from './service.js';

/**
 * Announcement channels module — owns: /messages/:messageId/crosspost, /chats/:chatId/followers, /spaces/:spaceId/follows, /channel-follows/**. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();

const P = {
  message: idParamSchema('messageId'),
  chat: idParamSchema('chatId'),
  space: idParamSchema('spaceId'),
  follow: idParamSchema('followId'),
};

// Publish → the message with CROSSPOSTED; copies reach the followers after commit.
router.post('/messages/:messageId/crosspost', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(P.message, req.params);
  res.json(await publishMessage(me, messageId));
});

router.get('/chats/:chatId/followers', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(P.chat, req.params);
  res.json(await listFollowers(me, chatId));
});

// Follow this announcement channel into `targetChannelId` (201).
router.post('/chats/:chatId/followers', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(P.chat, req.params);
  const { targetChannelId } = parse(followChannelSchema, req.body ?? {});
  res.status(201).json(await followChannel(me, chatId, targetChannelId));
});

router.get('/spaces/:spaceId/follows', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  res.json(await listSpaceFollows(me, spaceId));
});

router.delete('/channel-follows/:followId', async (req, res) => {
  const me = authUserId(req);
  const { followId } = parse(P.follow, req.params);
  await unfollowChannel(me, followId);
  res.status(204).end();
});
