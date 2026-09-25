import { Router } from 'express';

/**
 * Media module — owns: POST /media (multipart upload).
 * Paths are relative to /api (see ApiRoutes in @enbox/shared). This router is mounted
 * behind requireAuth; use req.auth / authUserId(req).
 */
export const router = Router();
