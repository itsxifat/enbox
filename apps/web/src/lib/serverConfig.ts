/**
 * `GET /api/config` (public, cached for the session): VAPID key, upload limits, the canonical
 * public origin (server PUBLIC_URL) and, once P3c wires LiveKit, the voice signalling URL.
 *
 *   const { limits } = await getServerConfig();   // cached; a failed load is retried next call
 *   publicOrigin()                                  // 'https://enbox.cloud' once loaded, else this origin
 *   await publicUrl('/join/abc')                    // absolute link on the canonical origin
 */
import type { ServerConfig } from '@enbox/shared';
import { api } from './api';

let configPromise: Promise<ServerConfig> | null = null;
let loaded: ServerConfig | null = null;

/** Cached `GET /api/config` (public). */
export function getServerConfig(): Promise<ServerConfig> {
  if (!configPromise) {
    configPromise = api
      .get<ServerConfig>('/api/config', { auth: false })
      .then((c) => {
        loaded = c;
        return c;
      })
      .catch((e: unknown) => {
        configPromise = null;
        throw e;
      });
  }
  return configPromise;
}

/** The config once `getServerConfig()` resolved, else null (sync, for render paths). */
export function serverConfig(): ServerConfig | null {
  return loaded;
}

/**
 * Origin for links people share outside the app (invites, profiles): the server's PUBLIC_URL
 * once the config is loaded (the app may be served from an alias domain, and native wrappers
 * have no useful window origin), this page's origin until then.
 */
export function publicOrigin(): string {
  if (loaded?.publicUrl) return loaded.publicUrl;
  return typeof window !== 'undefined' ? window.location.origin : '';
}

/** Absolute link on the canonical origin (`path` starts with `/`); loads the config first. */
export async function publicUrl(path: string): Promise<string> {
  await getServerConfig().catch(() => undefined);
  return `${publicOrigin()}${path}`;
}
