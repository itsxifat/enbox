import { Router } from 'express';
import {
  USER_RATE_LIMITS,
  bulkMembersSchema,
  idParamSchema,
  memberSearchQuerySchema,
  updateSpaceSecuritySchema,
} from '@enbox/shared';
import { authUserId } from '../../http/auth.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import './hooks.js';
import { getSecurity, updateSecurity } from './security.js';
import { bulkMembers, modView, searchMembers } from './service.js';

/**
 * Moderation module — owns: /spaces/:spaceId/members/search, /members/bulk,
 * /members/:userId/mod-view, /spaces/:spaceId/security. Paths are relative to /api (see
 * ApiRoutes in @enbox/shared); mounted behind requireAuth, before the Spaces router (so
 * `members/search` is not taken for a user id). Business rules: ./service.ts (members) and
 * ./security.ts (security actions, raid alerts); membership hooks: ./hooks.ts.
 */
export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  member: idParamSchema('spaceId', 'userId'),
};

// GET /spaces/:spaceId/members/search?q=&roleIds=&joinedAfter=&joinedBefore=&accountCreatedAfter=
//   &timedOut=&sort=&after=&limit= → ModMemberPage (moderators)
router.get('/spaces/:spaceId/members/search', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const q = parse(memberSearchQuerySchema, req.query);
  res.json(await searchMembers(me, spaceId, q));
});

// POST /spaces/:spaceId/members/bulk { action, userIds, … } → BulkMembersResult
router.post('/spaces/:spaceId/members/bulk', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(bulkMembersSchema, req.body ?? {});
  assertUserLimit(me, 'spaceMemberUpdate', USER_RATE_LIMITS.spaceMemberUpdate);
  res.json(await bulkMembers(me, spaceId, body));
});

// GET /spaces/:spaceId/members/:userId/mod-view → ModView (any moderator bit)
router.get('/spaces/:spaceId/members/:userId/mod-view', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, userId } = parse(P.member, req.params);
  res.json(await modView(me, spaceId, userId));
});

// GET /spaces/:spaceId/security → SpaceSecurity (MANAGE_SPACE or MODERATE_MEMBERS)
router.get('/spaces/:spaceId/security', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  res.json(await getSecurity(me, spaceId));
});

// PATCH /spaces/:spaceId/security → SpaceSecurity; space:security → Space room
router.patch('/spaces/:spaceId/security', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(updateSpaceSecuritySchema, req.body ?? {});
  res.json(await updateSecurity(me, spaceId, body));
});
