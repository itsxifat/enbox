/**
 * Session tokens ("linked devices"). Tokens are random 256-bit strings; only their sha256
 * is stored. Lookups are cached briefly to avoid a DB hit per request/socket event.
 */
import { and, eq, gt } from 'drizzle-orm';
import { db, type DbOrTx } from '../db/index.js';
import { sessions, type SessionRow } from '../db/schema.js';
import { config } from '../config.js';
import { generateToken, sha256 } from '../lib/crypto.js';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

const CACHE_TTL_MS = 30_000;
const TOUCH_INTERVAL_MS = 5 * 60_000;
const cache = new Map<string, { ctx: AuthContext; at: number }>();
const lastTouch = new Map<string, number>();

export interface CreateSessionInput {
  userId: string;
  deviceName?: string;
  userAgent?: string | null;
  ip?: string | null;
}

/** Create a session (pass `tx` when called inside a transaction, e.g. registration). */
export async function createSession(input: CreateSessionInput, dbx: DbOrTx = db): Promise<{ token: string; session: SessionRow }> {
  const token = generateToken();
  const [session] = await dbx
    .insert(sessions)
    .values({
      userId: input.userId,
      tokenHash: sha256(token),
      deviceName: input.deviceName?.trim() || guessDeviceName(input.userAgent),
      userAgent: input.userAgent ?? null,
      ip: input.ip ?? null,
      expiresAt: new Date(Date.now() + config.sessionTtlDays * 24 * 60 * 60 * 1000),
    })
    .returning();
  return { token, session: session! };
}

/** Resolve a bearer token to its user/session, or null if invalid/expired/revoked (or not a string: socket handshakes pass anything). */
export async function resolveToken(token: unknown): Promise<AuthContext | null> {
  if (typeof token !== 'string' || !token || token.length > 200) return null;
  const hash = sha256(token);
  const now = Date.now();
  const hit = cache.get(hash);
  if (hit && now - hit.at < CACHE_TTL_MS) {
    touch(hit.ctx.sessionId, now);
    return hit.ctx;
  }
  const [row] = await db
    .select({ id: sessions.id, userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, hash), gt(sessions.expiresAt, new Date())))
    .limit(1);
  if (!row) {
    cache.delete(hash);
    return null;
  }
  const ctx = { userId: row.userId, sessionId: row.id };
  cache.set(hash, { ctx, at: now });
  touch(row.id, now);
  return ctx;
}

function touch(sessionId: string, now: number) {
  const last = lastTouch.get(sessionId) ?? 0;
  if (now - last < TOUCH_INTERVAL_MS) return;
  lastTouch.set(sessionId, now);
  const ttl = config.sessionTtlDays * 24 * 60 * 60 * 1000;
  // Sliding expiry; fire-and-forget.
  db.update(sessions)
    .set({ lastActiveAt: new Date(now), expiresAt: new Date(now + ttl) })
    .where(eq(sessions.id, sessionId))
    .catch(() => {});
}

/**
 * Drop cached lookups for these sessions (call after deleting session rows, then emit
 * `session:revoked` to rooms.session(id) and `disconnectSession(id)`). Other instances may
 * honour a revoked token for up to CACHE_TTL_MS (30 s).
 */
export function invalidateSessions(sessionIds: string[]) {
  const ids = new Set(sessionIds);
  for (const [hash, entry] of cache) if (ids.has(entry.ctx.sessionId)) cache.delete(hash);
  for (const id of sessionIds) lastTouch.delete(id);
}

export function guessDeviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\//.test(ua)
      ? 'Opera'
      : /Chrome\//.test(ua)
        ? 'Chrome'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}
