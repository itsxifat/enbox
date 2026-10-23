import { Router } from 'express';
import { z } from 'zod';
import { idParamSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { acceptRequest, ignoreRequest, listRequests } from './service.js';

/**
 * Message requests module — owns: /chats/requests, /chats/:chatId/request/**. Paths are
 * relative to /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth, before the
 * chats module (whose `/chats/:chatId` would take `/chats/requests`). Business rules:
 * ./service.ts and services/dmGate.ts.
 *
 *   GET  /chats/requests[?state=ignored]   my requests, newest first
 *   POST /chats/:chatId/request/accept     → ChatSummary (an ordinary chat now)
 *   POST /chats/:chatId/request/ignore     → 204 (the sender isn't told)
 */
export const router = Router();

const listQuerySchema = z.object({ state: z.enum(['pending', 'ignored']).default('pending') });
const chatParams = idParamSchema('chatId');

router.get('/chats/requests', async (req, res) => {
  const { state } = parse(listQuerySchema, req.query);
  res.json(await listRequests(authUserId(req), state));
});

router.post('/chats/:chatId/request/accept', async (req, res) => {
  const { chatId } = parse(chatParams, req.params);
  res.json(await acceptRequest(authUserId(req), chatId));
});

router.post('/chats/:chatId/request/ignore', async (req, res) => {
  const { chatId } = parse(chatParams, req.params);
  await ignoreRequest(authUserId(req), chatId);
  res.status(204).end();
});
