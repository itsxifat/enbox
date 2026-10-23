import { Router } from 'express';

/**
 * Ignore module — owns: /me/ignores, /users/:userId/ignore. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
