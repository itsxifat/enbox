import { Router } from 'express';
import {
  createThreadSchema,
  idParamSchema,
  threadsQuerySchema,
  updateThreadSchema,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { createThread, deleteThread, listThreads, updateThread } from './service.js';

/**
 * Threads module — owns: /chats/:chatId/threads, /threads/:threadId. Paths are relative to
 * /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth. A thread's messages,
 * reads and pins use the chats/messages routes with its id. Business rules: ./service.ts.
 */
export const router = Router();

const chatParams = idParamSchema('chatId');
const threadParams = idParamSchema('threadId');

router.post('/chats/:chatId/threads', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const body = parse(createThreadSchema, req.body ?? {});
  res.status(201).json(await createThread(me, chatId, body));
});

router.get('/chats/:chatId/threads', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const query = parse(threadsQuerySchema, req.query);
  res.json(await listThreads(me, chatId, query));
});

router.patch('/threads/:threadId', async (req, res) => {
  const me = authUserId(req);
  const { threadId } = parse(threadParams, req.params);
  const body = parse(updateThreadSchema, req.body ?? {});
  res.json(await updateThread(me, threadId, body));
});

router.delete('/threads/:threadId', async (req, res) => {
  const me = authUserId(req);
  const { threadId } = parse(threadParams, req.params);
  await deleteThread(me, threadId);
  res.status(204).end();
});
