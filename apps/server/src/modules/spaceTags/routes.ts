import { Router } from 'express';

/**
 * Server tags (polish wave, agent 5) — owns: a Space's tag and wearing one. Paths are relative
 * to /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth.
 *
 *   PUT    /spaces/:spaceId/tag   SpaceTag: set or change it (MANAGE_SPACE; space:updated)
 *   DELETE /spaces/:spaceId/tag   remove it (wearers' tags disappear)
 *   PUT    /me/space-tag          UserPublic: wear a Space's tag, or none (user:changed)
 */
export const router = Router();
