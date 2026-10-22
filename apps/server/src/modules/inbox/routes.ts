import { Router } from 'express';
import { inboxMentionsQuerySchema } from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { parse } from '../../lib/validate.js';
import { listMentions } from './service.js';

/**
 * Inbox module — owns: GET /me/mentions (the Inbox's Mentions tab). The Unreads tab is built
 * by clients from their chat summaries. Business rules: ./service.ts.
 */
export const router = Router();

// GET /me/mentions?before=&limit=&spaceId=&everyone=&roles= → InboxMentionsPage (newest
// first; `before` = the previous page's `nextCursor`).
router.get('/me/mentions', async (req, res) => {
  const query = parse(inboxMentionsQuerySchema, req.query);
  res.json(await listMentions(authUserId(req), query));
});
