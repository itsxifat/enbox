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

  it('applyViewed takes the server count and never refetches viewers', () => {
    const get = vi.spyOn(api, 'get');
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
    s.applyViewed('m1', viewer, { firstView: true, viewCount: 1 });
    expect(useStatus.getState().feed!.mine[0]!.viewCount).toBe(1);
    // A reaction to a view already counted (viewers list not loaded): no refetch, same count.
    s.applyViewed('m1', { ...viewer, reaction: '😍' }, { firstView: false, viewCount: 1 });
    expect(useStatus.getState().feed!.mine[0]!.viewCount).toBe(1);
    // A reaction that is also the first view of someone else.
    s.applyViewed(
      'm1',
      { user: makeUser({ id: 'v2' }), viewedAt: '2099-01-01T10:05:00.000Z', reaction: '🔥' },
      { firstView: true, viewCount: 2 },
    );
    expect(useStatus.getState().feed!.mine[0]!.viewCount).toBe(2);
    expect(get).not.toHaveBeenCalled();
  });

  it('applyViewed adds new viewers first and replaces reactions in place', async () => {
    const v1 = {
      user: makeUser({ id: 'v1' }),
      viewedAt: '2099-01-01T10:00:00.000Z',
      reaction: null,
    };
    const v2 = {
      user: makeUser({ id: 'v2' }),
      viewedAt: '2099-01-01T09:00:00.000Z',
      reaction: null,
    };
    const s = useStatus.getState();
    s.applyNew(
      status('m2', { userId: me.id, viewed: true, viewCount: 2 }),
      makeUser({ id: me.id }),
    );
    vi.spyOn(api, 'get').mockResolvedValue([v1, v2] as never);
    await s.loadViewers('m2');
    // v2 reacts: stays in place (its view time didn't change).
    s.applyViewed('m2', { ...v2, reaction: '👍' }, { firstView: false, viewCount: 2 });
    let items = useStatus.getState().viewers.m2!.items;
    expect(items.map((v) => [v.user.id, v.reaction])).toEqual([
      ['v1', null],
      ['v2', '👍'],
    ]);
    // v3 views: added first; the count comes from the server.
    const v3 = {
      user: makeUser({ id: 'v3' }),
      viewedAt: '2099-01-01T11:00:00.000Z',
      reaction: null,
    };
    s.applyViewed('m2', v3, { firstView: true, viewCount: 3 });
    items = useStatus.getState().viewers.m2!.items;
    expect(items.map((v) => v.user.id)).toEqual(['v3', 'v1', 'v2']);
    expect(useStatus.getState().feed!.mine[0]!.viewCount).toBe(3);
    // A duplicate first-view event does not duplicate the entry.
    s.applyViewed('m2', v3, { firstView: true, viewCount: 3 });
    expect(useStatus.getState().viewers.m2!.items).toHaveLength(3);
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
