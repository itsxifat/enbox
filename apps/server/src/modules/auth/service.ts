/**
 * Accounts & sessions helpers shared by the auth and users modules: credential checks
 * (constant-ish timing), session revocation fan-out, unique-violation mapping.
 */
import { randomBytes } from 'node:crypto';
import type { Effects } from '../../services/effects.js';
import { invalidateSessions } from '../../services/sessions.js';
import { hashPassword, verifyPassword } from '../../lib/crypto.js';
import { disconnectSession, emitToSession } from '../../realtime/emit.js';

// A random password nobody knows; verifying against it costs the same as a real check.
let dummyHash: Promise<string> | undefined;

/**
 * Verify `password` against a user's stored hash. Unknown and deleted users are verified
 * against a dummy hash so the response time doesn't reveal whether the account exists.
 */
export async function checkPassword(
  user: { passwordHash: string; deletedAt: Date | null } | null | undefined,
  password: string,
): Promise<boolean> {
  if (!user || user.deletedAt) {
    await verifyPassword(password, await (dummyHash ??= hashPassword(randomBytes(24).toString('base64url'))));
    return false;
  }
  return verifyPassword(password, user.passwordHash);
}

/**
 * Register the post-commit fan-out of revoked sessions (docs matrix): per session s,
 * `invalidateSessions([s])` → `session:revoked { sessionId: s }` → session:<s> →
 * `disconnectSession(s)`. With `notify: false` (logout) the event is skipped.
 */
export function revokeSessionsEffect(fx: Effects, sessionIds: string[], opts: { notify?: boolean } = {}): Effects {
  const notify = opts.notify ?? true;
  for (const sessionId of sessionIds) {
    fx.add(() => {
      invalidateSessions([sessionId]);
      if (notify) emitToSession(sessionId, 'session:revoked', { sessionId });
      disconnectSession(sessionId);
    });
  }
  return fx;
}

/** Postgres error code of a (possibly drizzle-wrapped) driver error. */
function pgError(err: unknown): { code?: string; constraint?: string; message?: string } | null {
  let e: unknown = err;
  for (let i = 0; i < 3 && e && typeof e === 'object'; i++) {
    const x = e as { code?: unknown; constraint?: unknown; message?: unknown; cause?: unknown };
    if (typeof x.code === 'string' && /^[0-9A-Z]{5}$/.test(x.code)) {
      return { code: x.code, constraint: typeof x.constraint === 'string' ? x.constraint : undefined, message: typeof x.message === 'string' ? x.message : undefined };
    }
    e = x.cause;
  }
  return null;
}

/** The error is a unique violation (optionally of this index/constraint). */
export function isUniqueViolation(err: unknown, constraint?: string): boolean {
  const e = pgError(err);
  if (e?.code !== '23505') return false;
  if (!constraint) return true;
  return e.constraint === constraint || (e.message ?? '').includes(constraint);
}

/** The error is a foreign-key violation. */
export function isForeignKeyViolation(err: unknown): boolean {
  return pgError(err)?.code === '23503';
}
