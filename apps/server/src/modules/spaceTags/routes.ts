/**
 * Server tags module — owns PUT|DELETE /spaces/:spaceId/tag and PUT /me/space-tag
 * (docs/design/discord-parity.md W3-D). Paths are relative to /api (see ApiRoutes in
 * @enbox/shared); mounted behind requireAuth, before the Spaces router. Business rules and
 * fan-out: ./service.ts; leaving a Space takes its tag off: ./hooks.ts.
 *
 *   PUT    /spaces/:spaceId/tag   SpaceTag: set or change it (MANAGE_SPACE; space:updated)
 *   DELETE /spaces/:spaceId/tag   remove it (wearers' tags disappear)
 *   PUT    /me/space-tag          UserPublic: wear a Space's tag, or none (user:changed)
 */
import { Router } from 'express';
import {
  USER_RATE_LIMITS,
  adoptSpaceTagSchema,
  idParamSchema,
  spaceTagSchema,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { removeSpaceTag, setSpaceTag, wearSpaceTag } from './service.js';
import './hooks.js';

export const router = Router();

const P = { space: idParamSchema('spaceId') };

/** Tag edits per user (each one reaches every member). */
const TAG_LIMIT = { limit: 30, windowMs: 60_000 } as const;

// PUT /spaces/:spaceId/tag (MANAGE_SPACE) { tag, badge, color } → SpaceTag. 2-4 letters or
// digits, a known badge, a #rrggbb colour (400). Audited; space:updated { tag } → room.
router.put('/spaces/:spaceId/tag', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(spaceTagSchema, req.body ?? {});
  assertUserLimit(me, 'spaceTag', TAG_LIMIT);
  res.json(await setSpaceTag(me, spaceId, body));
});

// DELETE /spaces/:spaceId/tag (MANAGE_SPACE) → 204. Audited; space:updated { tag: null } → room.
router.delete('/spaces/:spaceId/tag', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  assertUserLimit(me, 'spaceTag', TAG_LIMIT);
  await removeSpaceTag(me, spaceId);
  res.status(204).end();
});

// PUT /me/space-tag { spaceId | null } → UserPublic (me). The `PATCH /me` rate limit;
// user:changed → my devices and everyone who sees my profile.
router.put('/me/space-tag', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(adoptSpaceTagSchema, req.body ?? {});
  assertUserLimit(me, 'profileUpdate', USER_RATE_LIMITS.profileUpdate);
  res.json(await wearSpaceTag(me, spaceId));
});
