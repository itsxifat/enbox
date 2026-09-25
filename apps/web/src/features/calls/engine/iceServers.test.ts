import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import {
  ICE_MIN_HORIZON_MS,
  getIceServers,
  iceCacheLifetimeMs,
  resetIceServersCache,
} from './iceServers';

const turn = (user: string) => ({
  iceServers: [
    { urls: ['turn:turn.example:3478'], username: `9999999999:${user}`, credential: 'x' },
  ],
  ttlSec: 86_400,
});

beforeEach(() => resetIceServersCache());
afterEach(() => vi.restoreAllMocks());

describe('iceCacheLifetimeMs', () => {
  it('keeps at least an hour (or half a short TTL) of validity for the call', () => {
    expect(iceCacheLifetimeMs(86_400)).toBe(86_400_000 - ICE_MIN_HORIZON_MS);
    expect(iceCacheLifetimeMs(3_600)).toBe(1_800_000);
    expect(iceCacheLifetimeMs(600)).toBe(300_000);
    expect(iceCacheLifetimeMs(60)).toBe(0);
  });
});

describe('getIceServers', () => {
  it('caches per session and drops the credentials on logout (session reset)', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValueOnce(turn('userA') as never);
    expect((await getIceServers())[0]!.username).toBe('9999999999:userA');
    expect((await getIceServers())[0]!.username).toBe('9999999999:userA');
    expect(get).toHaveBeenCalledTimes(1);

    resetSessionState();
    get.mockResolvedValueOnce(turn('userB') as never);
    expect((await getIceServers())[0]!.username).toBe('9999999999:userB');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('never caches a response that was in flight across the reset', async () => {
    let resolveA!: (v: unknown) => void;
    const get = vi
      .spyOn(api, 'get')
      .mockImplementationOnce(() => new Promise((r) => (resolveA = r)) as never);
    const pending = getIceServers();
    resetSessionState();
    resolveA(turn('userA'));
    await pending;
    get.mockResolvedValueOnce(turn('userB') as never);
    expect((await getIceServers())[0]!.username).toBe('9999999999:userB');
  });

  it('refetches once the cached credentials get close to expiry', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValueOnce({ ...turn('a'), ttlSec: 3_600 } as never)
      .mockResolvedValueOnce({ ...turn('a2'), ttlSec: 3_600 } as never);
    await getIceServers();
    const later = Date.now() + 31 * 60_000; // past half of a 1 h TTL
    expect((await getIceServers(later))[0]!.username).toBe('9999999999:a2');
    expect(get).toHaveBeenCalledTimes(2);
  });

  it('falls back to no servers when the request fails', async () => {
    vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('down'));
    expect(await getIceServers()).toEqual([]);
  });
});
