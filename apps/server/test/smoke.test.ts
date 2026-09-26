import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_ANIMATED_AVATAR_BYTES,
  MAX_AVATAR_BYTES,
  MAX_BANNER_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_WALLPAPER_BYTES,
  type ServerConfig,
} from '@enbox/shared';
import { config } from '../src/config.js';
import { startTestServer, type TestServer } from './helpers.js';

describe('server smoke', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  it('serves health and config (ServerConfig: publicUrl, voice, limits)', async () => {
    const health = await t.api().get('/api/health').expect(200);
    expect(health.body.ok).toBe(true);
    const cfg = (await t.api().get('/api/config').expect(200)).body as ServerConfig;
    expect(cfg).toEqual({
      vapidPublicKey: null,
      maxUploadBytes: MAX_UPLOAD_BYTES,
      version: config.version,
      publicUrl: 'http://localhost:5173',
      voice: null,
      limits: {
        maxUploadBytes: MAX_UPLOAD_BYTES,
        maxAvatarBytes: MAX_AVATAR_BYTES,
        maxAnimatedAvatarBytes: MAX_ANIMATED_AVATAR_BYTES,
        maxBannerBytes: MAX_BANNER_BYTES,
        maxWallpaperBytes: MAX_WALLPAPER_BYTES,
      },
    });
    expect(cfg.publicUrl).not.toMatch(/\/$/);
  });

  it('rejects unauthenticated API calls and unknown endpoints', async () => {
    const res = await t.api().get('/api/chats').expect(401);
    expect(res.body.error.code).toBe('unauthorized');
    const u = await t.createUser();
    const nf = await t.api(u).get('/api/definitely-not-here').expect(404);
    expect(nf.body.error.code).toBe('not_found');
  });

  it('authenticates sockets and emits ready', async () => {
    const u = await t.createUser();
    const s = await t.connect(u);
    expect(s.connected).toBe(true);
    await expect(t.connect({ token: 'bogus' })).rejects.toThrow(/unauthorized/);
  });
});
