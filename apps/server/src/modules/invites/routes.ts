import { Router } from 'express';

/**
 * Invites module — owns: /invites/:code (preview) and /invites/:code/join.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared). This router is mounted
 * behind requireAuth; use req.auth / authUserId(req).
 */
export const router = Router();
