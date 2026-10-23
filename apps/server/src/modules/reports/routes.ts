import { Router } from 'express';

/**
 * Reports module — owns: /reports, /spaces/:spaceId/reports/**. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
