import { Router } from 'express';

/**
 * Space preview module — owns: /spaces/:spaceId/preview/** (discoverable Spaces, non-members). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
