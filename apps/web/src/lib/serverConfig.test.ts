import { describe, expect, it, vi } from 'vitest';
import type { ServerConfig } from '@enbox/shared';

const CONFIG: ServerConfig = {
  vapidPublicKey: null,
  maxUploadBytes: 1,
  version: 'test',
  publicUrl: 'https://enbox.dev',
  voice: null,
  limits: {
    maxUploadBytes: 1,
    maxAvatarBytes: 1,
    maxAnimatedAvatarBytes: 1,
    maxBannerBytes: 1,
    maxWallpaperBytes: 1,
  },
};

/** Fresh module instances: the config cache is module state. */
async function load() {
  vi.resetModules();
  const [{ api }, config, share] = await Promise.all([
    import('./api'),
    import('./serverConfig'),
    import('@/features/groups/shared/share'),
  ]);
  return { api, ...config, inviteUrl: share.inviteUrl };
}

describe('serverConfig', () => {
  it('falls back to this origin until the config loads, then uses the canonical one', async () => {
    const { api, getServerConfig, serverConfig, publicOrigin, publicUrl, inviteUrl } = await load();
    const get = vi.spyOn(api, 'get').mockResolvedValue(CONFIG);
    expect(serverConfig()).toBeNull();
    expect(publicOrigin()).toBe(window.location.origin);
    expect(inviteUrl('abc')).toBe(`${window.location.origin}/join/abc`);

    await expect(getServerConfig()).resolves.toEqual(CONFIG);
    await getServerConfig();
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/config', { auth: false });
    expect(serverConfig()).toEqual(CONFIG);
    expect(publicOrigin()).toBe('https://enbox.dev');
    expect(inviteUrl('abc')).toBe('https://enbox.dev/join/abc');
    await expect(publicUrl('/join/abc')).resolves.toBe('https://enbox.dev/join/abc');
  });

  it('retries a failed load on the next call and keeps links usable meanwhile', async () => {
    const { api, getServerConfig, publicOrigin, publicUrl } = await load();
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(CONFIG);
    await expect(getServerConfig()).rejects.toThrow('Failed to fetch');
    await expect(publicUrl('/x')).resolves.toBe('https://enbox.dev/x');
    expect(publicOrigin()).toBe('https://enbox.dev');
    expect(get).toHaveBeenCalledTimes(2);
  });
});
