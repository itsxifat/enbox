import { Router } from 'express';

/**
 * Push module — owns: /push/subscriptions.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared). This router is mounted
 * behind requireAuth; use req.auth / authUserId(req).
 */
export const router = Router();
