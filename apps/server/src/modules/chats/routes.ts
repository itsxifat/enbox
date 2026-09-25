import { Router } from 'express';
import {
  chatMediaQuerySchema,
  createDirectChatSchema,
  idParamSchema,
  pinMessageSchema,
  readBodySchema,
  setDisappearingSchema,
  updateChatPrefsSchema,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';
import { advanceRead } from '../../services/watermarks.js';
import {
  chatMediaCounts,
  clearChat,
  deleteChatForMe,
  getChat,
  listChatMedia,
  listChats,
  listMembers,
  listPins,
  openDirectChat,
  pinMessage,
  setDisappearing,
  unpinMessage,
  updatePrefs,
} from './service.js';

/**
 * Chats module — owns: /chats, /chats/direct, /chats/:chatId, /chats/:chatId/{prefs,read,
 * clear,disappearing,members,media,media/counts,pins}. Paths are relative to /api (see ApiRoutes in
 * @enbox/shared); mounted behind requireAuth. `/chats/:chatId/messages` lives in the
 * messages module. Business rules: ./service.ts.
 */
export const router = Router();

const chatParams = idParamSchema('chatId');
const pinParams = idParamSchema('chatId', 'messageId');

router.get('/chats', async (req, res) => {
  res.json(await listChats(authUserId(req)));
});

router.post('/chats/direct', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(createDirectChatSchema, req.body);
  res.json(await openDirectChat(me, userId));
});

router.get('/chats/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  res.json(await getChat(me, chatId));
});

router.patch('/chats/:chatId/prefs', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const patch = parse(updateChatPrefsSchema, req.body);
  res.json(await updatePrefs(me, chatId, patch));
});

// Same semantics as the `chat:read` socket event (modules/chats/socket.ts).
router.post('/chats/:chatId/read', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const { seq } = parse(readBodySchema, req.body);
  await transact((tx, fx) => advanceRead(tx, fx, { chatId, userId: me, seq }));
  res.status(204).end();
});

router.post('/chats/:chatId/clear', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  await clearChat(me, chatId);
  res.status(204).end();
});

router.delete('/chats/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  await deleteChatForMe(me, chatId);
  res.status(204).end();
});

router.put('/chats/:chatId/disappearing', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const { seconds } = parse(setDisappearingSchema, req.body);
  res.json(await setDisappearing(me, chatId, seconds));
});

router.get('/chats/:chatId/members', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  res.json(await listMembers(me, chatId));
});

// Literal segment first (docs "Routes"): the counts of the gallery below.
router.get('/chats/:chatId/media/counts', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  res.json(await chatMediaCounts(me, chatId));
});

router.get('/chats/:chatId/media', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const query = parse(chatMediaQuerySchema, req.query);
  res.json(await listChatMedia(me, chatId, query));
});

router.get('/chats/:chatId/pins', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  res.json(await listPins(me, chatId));
});

router.post('/chats/:chatId/pins', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const { messageId } = parse(pinMessageSchema, req.body);
  res.json(await pinMessage(me, chatId, messageId));
});

router.delete('/chats/:chatId/pins/:messageId', async (req, res) => {
  const me = authUserId(req);
  const { chatId, messageId } = parse(pinParams, req.params);
  res.json(await unpinMessage(me, chatId, messageId));
});
