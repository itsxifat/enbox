import { Router } from 'express';

/**
 * Moderation module — owns: /spaces/:spaceId/members/search, /members/bulk, /members/:userId/mod-view, /spaces/:spaceId/security. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
