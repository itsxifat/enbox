import { Router } from 'express';

/**
 * Following posts and threads (polish wave, agent 6). Paths are relative to /api (see
 * ApiRoutes in @enbox/shared); mounted behind requireAuth.
 *
 *   PUT    /threads/:threadId/follow          ChatSummary: follow it (thread:follow → my devices)
 *   DELETE /threads/:threadId/follow          unfollow it
 *   GET    /spaces/:spaceId/followed-threads  FollowedThreads: what I follow there (sidebar)
 */
export const router = Router();
