import { Router } from 'express';

/**
 * Stickers module — owns: /spaces/:spaceId/stickers/**, /me/stickers. Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
