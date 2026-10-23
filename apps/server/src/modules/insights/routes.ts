import { Router } from 'express';

/**
 * Insights module — owns: /spaces/:spaceId/insights(.csv). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
