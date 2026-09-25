/**
 * STUN/TURN servers from `GET /api/calls/ice-servers`, cached until shortly before the
 * server's `ttlSec` (TURN REST credentials are time-limited). Falls back to no servers
 * (host candidates only) when the request fails, so LAN calls still work.
 */
import type { IceServerConfig } from '@enbox/shared';
import { api, type ApiResponse } from '@/lib/api';

let cached: { servers: RTCIceServer[]; expiresAt: number } | null = null;
let inflight: Promise<RTCIceServer[]> | null = null;

/** Refresh this long before the credentials expire. */
const SAFETY_MS = 60_000;

export function toRtcIceServers(list: IceServerConfig[]): RTCIceServer[] {
  return list.map((s) => ({
    urls: s.urls,
    ...(s.username ? { username: s.username } : {}),
    ...(s.credential ? { credential: s.credential } : {}),
  }));
}

export async function getIceServers(now: number = Date.now()): Promise<RTCIceServer[]> {
  if (cached && cached.expiresAt > now) return cached.servers;
  if (inflight) return inflight;
  inflight = api
    .get<ApiResponse<'GET /api/calls/ice-servers'>>('/api/calls/ice-servers', { timeoutMs: 6_000 })
    .then((res) => {
      const servers = toRtcIceServers(res.iceServers);
      const ttlMs = Math.max(60_000, res.ttlSec * 1000 - SAFETY_MS);
      cached = { servers, expiresAt: Date.now() + ttlMs };
      return servers;
    })
    .catch(() => cached?.servers ?? [])
    .finally(() => {
      inflight = null;
    });
  return inflight;
}

/** Tests / logout. */
export function resetIceServersCache(): void {
  cached = null;
  inflight = null;
}
