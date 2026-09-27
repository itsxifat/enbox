/**
 * STUN/TURN servers from `GET /api/calls/ice-servers`, cached while enough of the server's
 * `ttlSec` remains for a call to outlive it (TURN REST credentials are time-limited and
 * bound to the user: `<expiry>:<userId>`). Falls back to no servers (host candidates only)
 * when the request fails, so LAN calls still work.
 *
 * Per account: the cache is dropped on logout (lib/session.ts), and a response that was in
 * flight across the reset is discarded, so the next account never reuses these credentials.
 */

import { api } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';

let cached = null;
let inflight = null;
/** Bumped by resetIceServersCache(): responses of an older generation are dropped. */
let generation = 0;

/** Never hand out credentials with less than this left (or half the TTL when shorter). */
export const ICE_MIN_HORIZON_MS = 60 * 60_000;
const SAFETY_MS = 60_000;

/** How long a fresh response may be served from the cache. */
export function iceCacheLifetimeMs(ttlSec) {
  const ttlMs = Math.max(0, ttlSec * 1000);
  const keep = Math.max(SAFETY_MS, Math.min(ICE_MIN_HORIZON_MS, ttlMs / 2));
  return Math.max(0, ttlMs - keep);
}

export function toRtcIceServers(list) {
  return list.map((s) => ({
    urls: s.urls,
    ...(s.username ? { username: s.username } : {}),
    ...(s.credential ? { credential: s.credential } : {}),
  }));
}

export async function getIceServers(now = Date.now()) {
  if (cached && cached.expiresAt > now) return cached.servers;
  if (inflight) return inflight;
  const gen = generation;
  const stale = cached?.servers ?? [];
  const p = api
    .get('/api/calls/ice-servers', { timeoutMs: 6_000 })
    .then((res) => {
      const servers = toRtcIceServers(res.iceServers);
      if (gen === generation) {
        cached = { servers, expiresAt: Date.now() + iceCacheLifetimeMs(res.ttlSec) };
      }
      return servers;
    })
    .catch(() => (gen === generation ? stale : []))
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}

/** Logout / account switch (registered below) and tests. */
export function resetIceServersCache() {
  generation++;
  cached = null;
  inflight = null;
}

registerSessionReset(resetIceServersCache);
