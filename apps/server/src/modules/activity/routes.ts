import { Router } from 'express';
import { db } from '../../db/index.js';
import { authUserId } from '../../http/auth.js';
import { listFriendActivity } from './service.js';

/**
 * Active Now module — owns: /me/friends/activity. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 *
 *   GET /me/friends/activity   FriendActivity[]: my friends in voice, by channel (channels I can see)
 */
export const router = Router();

router.get('/me/friends/activity', async (req, res) => {
  res.json(await listFriendActivity(db, authUserId(req)));
});
