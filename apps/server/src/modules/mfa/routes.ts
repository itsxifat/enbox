import { Router } from 'express';

/**
 * Two-factor module — owns: /me/mfa/** (the login step lives in auth/routes.ts). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 */
export const router = Router();
