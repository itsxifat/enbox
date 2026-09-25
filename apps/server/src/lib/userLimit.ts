/**
 * Tiny in-memory fixed-window rate limiter keyed by user (or any subject id, e.g. a socket
 * id) and action. Per process: with several instances each one counts separately, which
 * is acceptable for v1 abuse protection. Limits live in `USER_RATE_LIMITS` (@enbox/shared).
 * Disabled when `config.rateLimit` is off (tests).
 *
 *   if (!limitUser(socket.id, `typing:${chatId}`, 1, 1000)) return;          // drop silently
 *   assertUserLimit(userId, 'sendMessage', USER_RATE_LIMITS.sendMessage);     // throws 429
 */
import { config } from '../config.js';
import { rateLimited } from './errors.js';

/**
 * Server-side per-socket / per-user limits that are not part of the shared contract (abuse
 * protection; docs "Rate limits"). Excess socket events are dropped (fire-and-forget events)
 * or acked `rate_limited`; excess handshakes fail with connect_error `rate_limited`; REST
 * answers `429 rate_limited`.
 */
export const SERVER_RATE_LIMITS = {
  /** `POST /status` per user. */
  statusPost: { limit: 30, windowMs: 60 * 60_000 },
  /** Socket handshakes per user. */
  connect: { limit: 60, windowMs: 60_000 },
  /** `chat:read` per socket. */
  chatRead: { limit: 100, windowMs: 5_000 },
  /** `chat:typing` per socket across all chats (the per-chat throttle is USER_RATE_LIMITS.typing). */
  typingAnyChat: { limit: 20, windowMs: 1_000 },
  /** `call:media` per socket. */
  callMedia: { limit: 40, windowMs: 10_000 },
} as const;

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let lastSweep = 0;
const SWEEP_INTERVAL_MS = 60_000;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}

/**
 * Count one action (`cost` units) for `subjectId`/`key`. Returns false (and does not count)
 * when it would exceed `limit` within the current `windowMs` window.
 */
export function limitUser(subjectId: string, key: string, limit: number, windowMs: number, cost = 1): boolean {
  if (!config.rateLimit) return true;
  const now = Date.now();
  sweep(now);
  const k = `${key}\u0000${subjectId}`;
  let b = buckets.get(k);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(k, b);
  }
  if (b.count + cost > limit) return false;
  b.count += cost;
  return true;
}

/** Like `limitUser` but throws `429 rate_limited` when over the limit. */
export function assertUserLimit(
  subjectId: string,
  key: string,
  rule: { limit: number; windowMs: number },
  cost = 1,
): void {
  if (!limitUser(subjectId, key, rule.limit, rule.windowMs, cost)) throw rateLimited();
}

/** Forget all counters (tests). */
export function resetUserLimits(): void {
  buckets.clear();
  lastSweep = 0;
}
