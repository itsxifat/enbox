import { Router } from 'express';

/**
 * Space templates module — owns: /templates/:code, /spaces/:spaceId/templates/** (starters: STARTER_TEMPLATES). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
