import { Router } from 'express';
import {
  MAX_ANIMATED_AVATAR_BYTES,
  MAX_AVATAR_BYTES,
  MAX_BANNER_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_WALLPAPER_BYTES,
  type ServerConfig,
} from '@enbox/shared';
import { config } from '../../config.js';

/** Public system endpoints: health check and client bootstrap config. */
export const publicRouter = Router();

publicRouter.get('/health', (_req, res) => {
  res.json({ ok: true, version: config.version });
});

/**
 * `ServerConfig` (shared api.ts): `publicUrl` is PUBLIC_URL without its trailing slash, or
 * null when it is unset (clients build share links on their own origin then); `voice` stays
 * null until P3c wires LiveKit; `limits` mirror the shared MAX_* constants
 * (`maxWallpaperBytes` is enforced from P2, exposed now so clients need no build-time copy).
 */
publicRouter.get('/config', (_req, res) => {
  const body: ServerConfig = {
    vapidPublicKey:
      config.vapid.publicKey && config.vapid.privateKey ? config.vapid.publicKey : null,
    maxUploadBytes: MAX_UPLOAD_BYTES,
    version: config.version,
    publicUrl: config.publicUrl,
    voice: null,
    limits: {
      maxUploadBytes: MAX_UPLOAD_BYTES,
      maxAvatarBytes: MAX_AVATAR_BYTES,
      maxAnimatedAvatarBytes: MAX_ANIMATED_AVATAR_BYTES,
      maxBannerBytes: MAX_BANNER_BYTES,
      maxWallpaperBytes: MAX_WALLPAPER_BYTES,
    },
  };
  res.json(body);
});
