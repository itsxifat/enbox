import { Router } from 'express';

/**
 * Active Now module — owns: /me/friends/activity. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
