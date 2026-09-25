import type { NextFunction, Request, Response } from 'express';
import { unauthorized } from '../lib/errors.js';
import { resolveToken, type AuthContext } from '../services/sessions.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `requireAuth`. */
      auth?: AuthContext;
    }
  }
}

export function bearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  return null;
}

/** Rejects with 401 unless a valid session token is presented. */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const ctx = await resolveToken(bearerToken(req));
  if (!ctx) return next(unauthorized());
  req.auth = ctx;
  next();
}

/** The authenticated user's id (use in handlers behind `requireAuth`). */
export function authUserId(req: Request): string {
  if (!req.auth) throw unauthorized();
  return req.auth.userId;
}

export function authCtx(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}
