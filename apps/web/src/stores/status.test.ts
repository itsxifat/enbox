import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Status, StatusFeedItem, UserPublic } from '@enbox/shared';
import { api } from '@/lib/api';
import { makeMe, makeUser } from '@/test/factories';
import { useAuth } from './auth';
import { normalizeItem, sortUpdates, useStatus } from './status';

const me = makeMe({ id: '00000000-0000-4000-8000-0000000000aa' });

function status(id: string, p: Partial<Status> = {}): Status {
  return {
    id,
    userId: p.userId ?? 'u1',
    type: 'text',
    text: id,
    backgroundColor: '#6D5DFC',
    font: 0,
    media: null,
    createdAt: p.createdAt ?? '2099-01-01T10:00:00.000Z',
    expiresAt: p.expiresAt ?? '2099-01-02T10:00:00.000Z',
    viewed: false,
    viewCount: null,
    ...p,
  };
}

function item(user: UserPublic, statuses: Status[]): StatusFeedItem {
  return normalizeItem({ user, statuses, allViewed: false, lastUpdatedAt: '' });
}

const initial = useStatus.getState();
beforeEach(() => {
  useStatus.setState(initial, true);
  useAuth.setState({ user: me, status: 'authenticated', token: 't' });
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('status feed helpers', () => {
  it('normalizeItem sorts statuses and derives allViewed/lastUpdatedAt', () => {
    const u = makeUser();
    const it1 = item(u, [
      status('b', { createdAt: '2099-01-01T11:00:00.000Z', viewed: true }),
      status('a', { createdAt: '2099-01-01T10:00:00.000Z', viewed: true }),
    ]);
    expect(it1.statuses.map((s) => s.id)).toEqual(['a', 'b']);
    expect(it1.allViewed).toBe(true);
    expect(it1.lastUpdatedAt).toBe('2099-01-01T11:00:00.000Z');
  });

  it('sortUpdates puts unviewed first, newest first', () => {
    const [x, y, z] = [makeUser(), makeUser(), makeUser()];
    const list = sortUpdates([
      item(x, [status('x', { viewed: true, createdAt: '2099-01-01T12:00:00.000Z' })]),
      item(y, [status('y', { createdAt: '2099-01-01T09:00:00.000Z' })]),
      item(z, [status('z', { createdAt: '2099-01-01T11:00:00.000Z' })]),
    ]);
    expect(list.map((i) => i.statuses[0]!.id)).toEqual(['z', 'y', 'x']);
  });
});

describe('status store realtime', () => {
  it('applyNew adds to my list or to the author item (deduped)', () => {
    const s = useStatus.getState();
    const author = makeUser({ id: 'u1' });
    s.applyNew(status('s1'), author);
    s.applyNew(status('s1'), author);
    s.applyNew(status('s2', { createdAt: '2099-01-01T12:00:00.000Z' }), author);
    s.applyNew(
      status('mine', { userId: me.id, viewed: true, viewCount: 0 }),
      makeUser({ id: me.id }),
    );
    const feed = useStatus.getState().feed!;
    expect(feed.mine.map((x) => x.id)).toEqual(['mine']);
    expect(feed.updates).toHaveLength(1);
    expect(feed.updates[0]!.statuses.map((x) => x.id)).toEqual(['s1', 's2']);
    expect(feed.updates[0]!.lastUpdatedAt).toBe('2099-01-01T12:00:00.000Z');
  });

  it('applyDeleted removes statuses and empty authors', () => {
    const s = useStatus.getState();
    s.applyNew(status('s1'), makeUser({ id: 'u1' }));
    s.applyDeleted('s1', 'u1');
    expect(useStatus.getState().feed!.updates).toEqual([]);
  });

  it('applyViewed counts first views and refetches viewers for reactions', async () => {
    vi.useFakeTimers();
    const s = useStatus.getState();
    s.applyNew(
      status('m1', { userId: me.id, viewed: true, viewCount: 0 }),
      makeUser({ id: me.id }),
    );
    const viewer = {
      user: makeUser({ id: 'v1' }),
      viewedAt: '2099-01-01T10:00:00.000Z',
      reaction: null,
    };
    s.applyViewed('m1', viewer);
    expect(useStatus.getState().feed!.mine[0]!.viewCount).toBe(1);
    const get = vi.spyOn(api, 'get').mockResolvedValue([{ ...viewer, reaction: '😍' }] as never);
    s.applyViewed('m1', { ...viewer, reaction: '😍' });
    await vi.advanceTimersByTimeAsync(400);
    expect(get).toHaveBeenCalledWith('/api/status/m1/viewers');
    expect(useStatus.getState().feed!.mine[0]!.viewCount).toBe(1);
    expect(useStatus.getState().viewers.m1!.items[0]!.reaction).toBe('😍');
    // Once loaded, later events upsert into the list.
    s.applyViewed('m1', {
      user: makeUser({ id: 'v2' }),
      viewedAt: '2099-01-01T11:00:00.000Z',
      reaction: null,
    });
    expect(useStatus.getState().feed!.mine[0]!.viewCount).toBe(2);
    vi.useRealTimers();
  });

  it('markViewed is optimistic and posts once per status', () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined as never);
    const s = useStatus.getState();
    s.applyNew(status('v-1'), makeUser({ id: 'u9' }));
    s.markViewed('v-1');
    s.markViewed('v-1');
    expect(post).toHaveBeenCalledTimes(1);
    expect(post).toHaveBeenCalledWith('/api/status/v-1/view');
    const it9 = useStatus.getState().feed!.updates[0]!;
    expect(it9.statuses[0]!.viewed).toBe(true);
    expect(it9.allViewed).toBe(true);
  });

  it('pruneExpired drops expired statuses', () => {
    const s = useStatus.getState();
    s.applyNew(status('old', { expiresAt: '2000-01-01T00:00:00.000Z' }), makeUser({ id: 'u1' }));
    s.applyNew(status('new'), makeUser({ id: 'u1' }));
    s.pruneExpired();
    expect(useStatus.getState().feed!.updates[0]!.statuses.map((x) => x.id)).toEqual(['new']);
  });
});

describe('status store posting', () => {
  it('postMedia uploads, posts and tracks progress', async () => {
    const upload = vi.spyOn(api, 'upload').mockImplementation(async (_f, _m, onProgress) => {
      onProgress?.(0.5);
      expect(useStatus.getState().posting[0]?.progress).toBe(0.5);
      return { id: 'media-1' } as never;
    });
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue(status('p1', { userId: me.id, type: 'image' }) as never);
    await useStatus
      .getState()
      .postMedia({ file: new Blob(['x']), meta: { kind: 'image' }, caption: '  hi  ' });
    expect(upload).toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith('/api/status', {
      type: 'image',
      mediaId: 'media-1',
      text: 'hi',
    });
    expect(useStatus.getState().posting).toEqual([]);
    expect(useStatus.getState().feed!.mine.map((x) => x.id)).toEqual(['p1']);
  });
});
