import { Router } from 'express';
import {
  deleteMessageQuerySchema,
  editMessageSchema,
  forwardSchema,
  idParamSchema,
  listMessagesQuerySchema,
  pollVoteSchema,
  reactSchema,
  searchMessagesQuerySchema,
  sendMessageSchema,
  starredMessagesQuerySchema,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import {
  deleteMessage,
  editMessage,
  forwardMessages,
  listMessages,
  listStarred,
  messageInfo,
  react,
  searchMessages,
  sendMessage,
  setStar,
  unreact,
  vote,
} from './service.js';

/**
 * Messages module — owns: /chats/:chatId/messages, /messages/*, /search/messages.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth.
 * Literal segments (`/messages/starred`, `/messages/forward`) are registered before
 * `/messages/:messageId`. Business rules: ./service.ts.
 */
export const router = Router();

const chatParams = idParamSchema('chatId');
const messageParams = idParamSchema('messageId');

router.get('/chats/:chatId/messages', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const query = parse(listMessagesQuerySchema, req.query);
  res.json(await listMessages(me, chatId, query));
});

// 201 = created; 200 = idempotent retry (same clientId) returning the original message.
router.post('/chats/:chatId/messages', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const body = parse(sendMessageSchema, req.body);
  const { message, created } = await sendMessage(me, chatId, body);
  res.status(created ? 201 : 200).json(message);
});

router.get('/messages/starred', async (req, res) => {
  const me = authUserId(req);
  const query = parse(starredMessagesQuerySchema, req.query);
  res.json(await listStarred(me, query));
});

// 201 when at least one copy was created; 200 for a pure retry.
router.post('/messages/forward', async (req, res) => {
  const me = authUserId(req);
  const body = parse(forwardSchema, req.body);
  const { messages, created } = await forwardMessages(me, body);
  res.status(created ? 201 : 200).json(messages);
});

router.patch('/messages/:messageId', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  const { text } = parse(editMessageSchema, req.body);
  res.json(await editMessage(me, messageId, text));
});

router.delete('/messages/:messageId', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  const query = parse(deleteMessageQuerySchema, req.query);
  await deleteMessage(me, messageId, query.for);
  res.status(204).end();
});

router.put('/messages/:messageId/reaction', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  const { emoji } = parse(reactSchema, req.body);
  res.json(await react(me, messageId, emoji));
});

router.delete('/messages/:messageId/reaction', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  res.json(await unreact(me, messageId));
});

router.put('/messages/:messageId/star', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  await setStar(me, messageId, true);
  res.status(204).end();
});

router.delete('/messages/:messageId/star', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  await setStar(me, messageId, false);
  res.status(204).end();
});

router.get('/messages/:messageId/info', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  res.json(await messageInfo(me, messageId));
});

router.put('/messages/:messageId/vote', async (req, res) => {
  const me = authUserId(req);
  const { messageId } = parse(messageParams, req.params);
  const { optionIds } = parse(pollVoteSchema, req.body);
  res.json(await vote(me, messageId, optionIds));
});

router.get('/search/messages', async (req, res) => {
  const me = authUserId(req);
  const query = parse(searchMessagesQuerySchema, req.query);
  res.json(await searchMessages(me, query));
});
