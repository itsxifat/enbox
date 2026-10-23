import { Router } from 'express';

/**
 * Soundboard module — owns: /spaces/:spaceId/sounds/** (play included). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
