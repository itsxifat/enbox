import type { RequestHandler } from 'express';
import { rateLimit } from 'express-rate-limit';
import { config } from '../config.js';

const passthrough: RequestHandler = (_req, _res, next) => next();

function limiter(windowMs: number, limit: number): RequestHandler {
  const real = rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, res) => {
      res.status(429).json({ error: { code: 'rate_limited', message: 'Too many requests, slow down' } });
    },
  });
  // Evaluate config lazily so tests can disable rate limiting.
  return (req, res, next) => (config.rateLimit ? real(req, res, next) : passthrough(req, res, next));
}

/** Login/register: 20 attempts per 10 minutes per IP. */
export const authLimiter = limiter(10 * 60_000, 20);
/** Public username availability checks (register form): 120 per 10 minutes per IP (anti enumeration). */
export const usernameCheckLimiter = limiter(10 * 60_000, 120);
/** Invite lookups/joins: 60 per 10 minutes per IP (anti brute-force). */
export const inviteLimiter = limiter(10 * 60_000, 60);
/** Uploads: 120 per 10 minutes per IP. */
export const uploadLimiter = limiter(10 * 60_000, 120);
/** General API: 1200 per minute per IP. */
export const apiLimiter = limiter(60_000, 1200);
