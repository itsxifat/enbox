import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { Status } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { makeUser } from '@/test/factories';
import { nextUnseenExpiry, normalizeItem, useHasUnseenStatus, useStatus } from './status';

const NOW = Date.parse('2030-01-01T12:00:00.000Z');

function status(id: string, expiresInMs: number, viewed = false): Status {
  return {
    id,
    userId: 'u1',
    type: 'text',
    text: id,
    backgroundColor: '#6D5DFC',
    font: 0,
    media: null,
    createdAt: new Date(NOW - 1_000).toISOString(),
    expiresAt: new Date(NOW + expiresInMs).toISOString(),
    viewed,
    viewCount: null,
  };
}

function feed(statuses: Status[]) {
  const user = makeUser({ id: 'u1' });
  return {
    mine: [],
    updates: [normalizeItem({ user, statuses, allViewed: false, lastUpdatedAt: '' })],
  };
}

describe('Updates tab dot (unseen statuses)', () => {
  beforeEach(() => {
    resetSessionState();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('nextUnseenExpiry ignores viewed and expired statuses', () => {
    const f = feed([status('a', 5_000), status('b', 1_000, true), status('c', -1)]);
    expect(nextUnseenExpiry(f, NOW)).toBe(NOW + 5_000);
    expect(nextUnseenExpiry(null, NOW)).toBeNull();
  });

  it('turns off when the last unseen status expires, without the status list mounted', async () => {
    useStatus.setState({ feed: feed([status('a', 60_000)]), loaded: true });
    const { result } = renderHook(() => useHasUnseenStatus());
    expect(result.current).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_100);
    });
    expect(result.current).toBe(false);
    // …and the expired status was pruned from the feed.
    expect(useStatus.getState().feed!.updates).toEqual([]);
  });

  it('drops a feed that lands after a logout', async () => {
    let resolve!: (v: unknown) => void;
    vi.spyOn(api, 'get').mockReturnValue(new Promise((r) => (resolve = r)) as never);
    const loading = useStatus.getState().loadFeed();
    resetSessionState();
    resolve(feed([status('a', 60_000)]));
    await loading;
    expect(useStatus.getState().feed).toBeNull();
  });
});
