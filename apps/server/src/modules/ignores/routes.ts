import { Router } from 'express';
import { idParamSchema } from '@enbox/shared';
import { db } from '../../db/index.js';
import { authUserId } from '../../http/auth.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { IGNORE_RATE_LIMIT, ignoreUser, listIgnored, unignoreUser } from './service.js';

/**
 * Ignore module — owns: /me/ignores, /users/:userId/ignore. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();

router.get('/me/ignores', async (req, res) => {
  res.json(await listIgnored(db, authUserId(req)));
});

/** Ignore someone (silent). Events: `ignores:changed` → my devices. */
router.put('/users/:userId/ignore', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  assertUserLimit(me, 'ignore', IGNORE_RATE_LIMIT);
  await ignoreUser(me, userId);
  res.status(204).end();
});

router.delete('/users/:userId/ignore', async (req, res) => {
  const me = authUserId(req);
  const { userId } = parse(idParamSchema('userId'), req.params);
  assertUserLimit(me, 'ignore', IGNORE_RATE_LIMIT);
  await unignoreUser(me, userId);
  res.status(204).end();
});
