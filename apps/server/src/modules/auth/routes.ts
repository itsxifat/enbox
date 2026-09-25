import { Router } from 'express';

/**
 * Auth module.
 * publicRouter (no auth): POST /auth/register, POST /auth/login
 * router (authenticated): POST /auth/logout, GET/DELETE /auth/sessions[/:sessionId],
 *                         POST /auth/change-password
 */
export const publicRouter = Router();
export const router = Router();
