import { Router } from 'express';

/**
 * Users module — owns: /me, /me/settings, /users/*, /contacts*, /blocks*, /users/presence.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared). This router is mounted
 * behind requireAuth; use req.auth / authUserId(req).
 */
export const router = Router();
