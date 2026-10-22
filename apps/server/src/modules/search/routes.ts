import { Router } from 'express';
import { USER_RATE_LIMITS, idParamSchema, messageSearchSchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { searchChatMessages, searchSpaceMessages } from './service.js';

/**
 * Search module — owns: /spaces/:spaceId/messages/search, /chats/:chatId/messages/search
 * (Discord's header search; rules in ./service.ts). The WhatsApp-style `GET /search/messages`
 * stays in the messages module for the Android app.
 */
export const router = Router();

const spaceParams = idParamSchema('spaceId');
const chatParams = idParamSchema('chatId');

// → MessageSearchPage over the text channels (and threads) of the Space I can see.
router.get('/spaces/:spaceId/messages/search', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(spaceParams, req.params);
  const query = parse(messageSearchSchema, req.query);
  assertUserLimit(me, 'messageSearch', USER_RATE_LIMITS.search);
  res.json(await searchSpaceMessages(me, spaceId, query));
});

// → MessageSearchPage within one direct chat or group (my visible window).
router.get('/chats/:chatId/messages/search', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const query = parse(messageSearchSchema, req.query);
  assertUserLimit(me, 'messageSearch', USER_RATE_LIMITS.search);
  res.json(await searchChatMessages(me, chatId, query));
});
