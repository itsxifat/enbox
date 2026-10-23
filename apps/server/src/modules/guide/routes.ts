import { Router } from 'express';

/**
 * Server Guide module — owns: /spaces/:spaceId/guide/**, /spaces/:spaceId/channel-prefs, /spaces/:spaceId/onboarding/answers (PUT). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
