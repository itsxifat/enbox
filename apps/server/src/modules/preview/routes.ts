/**
 * Space preview module — owns /spaces/:spaceId/preview/** (discoverable Spaces, non-members:
 * docs/design/discord-parity.md W12-C). Paths are relative to /api (see ApiRoutes in
 * @enbox/shared); mounted behind requireAuth, before the Spaces router. Business rules:
 * ./service.ts. Invite unfurls (`/join/:code` HTML) live in ./unfurl.ts.
 *
 * - Any signed-in user may preview a Space listed in discovery unless it banned them (404
 *   either way, like an unlisted Space). Members may too; the client opens the Space instead.
 * - Nothing is written: no read rows, no membership, no realtime rooms. Both routes are
 *   rate-limited per user.
 */
import { Router } from 'express';
import { idParamSchema } from '@enbox/shared';
import { db } from '../../db/index.js';
import { authUserId } from '../../http/auth.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { previewMessages, spacePreview } from './service.js';

export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  channel: idParamSchema('spaceId', 'channelId'),
};

/** Previews opened per user (a handful of indexed queries each). */
const PREVIEW_LIMIT = { limit: 60, windowMs: 60_000 } as const;
/** Channel histories read per user (a channel switch every two seconds). */
const PREVIEW_MESSAGES_LIMIT = { limit: 30, windowMs: 60_000 } as const;

// GET /spaces/:spaceId/preview → SpacePreview (listed Spaces; banned or unlisted 404)
router.get('/spaces/:spaceId/preview', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  assertUserLimit(me, 'spacePreview', PREVIEW_LIMIT);
  res.json(await spacePreview(db, me, spaceId));
});

// GET /spaces/:spaceId/preview/channels/:channelId/messages → SpacePreviewMessages (the newest
// PREVIEW_MESSAGE_LIMIT, oldest first; a channel @everyone can't read 404)
router.get('/spaces/:spaceId/preview/channels/:channelId/messages', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, channelId } = parse(P.channel, req.params);
  assertUserLimit(me, 'spacePreviewMessages', PREVIEW_MESSAGES_LIMIT);
  res.json(await previewMessages(db, me, spaceId, channelId));
});
