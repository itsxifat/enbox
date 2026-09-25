import { Router } from 'express';

/**
 * Calls module — owns: /calls/* (history, active calls, ICE servers). Signaling lives in socket.ts.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared). This router is mounted
 * behind requireAuth; use req.auth / authUserId(req).
 */
export const router = Router();
