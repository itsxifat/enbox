import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TYPING_TIMEOUT_MS, type ChatSummary } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { useAuth } from './auth';
import {
  compareChats,
  filterChats,
  mergeChatUpsert,
  selectSortedChats,
  useChats,
} from './chats';
import { useUsers } from './users';

const t = (h: number) => `2025-03-12T${String(h).padStart(2, '0')}:00:00.000Z`;

describe('selectSortedChats', () => {
  const chats = [
    makeChat({ id: 'a', lastActivityAt: t(9) }),
    makeChat({ id: 'b', lastActivityAt: t(12), unreadCount: 2 }),
    makeChat({ id: 'c', lastActivityAt: t(8), isPinned: true }),
    makeChat({ id: 'd', lastActivityAt: t(13), isArchived: true }),
    makeChat({ id: 'e', lastActivityAt: t(14), type: 'channel' }),
    makeChat({
      id: 'f',
      lastActivityAt: t(10),
      type: 'direct',
      name: null,
      peer: makeUser({ displayName: 'Zoe' }),
      markedUnread: true,
    }),
  ];
  const byId = Object.fromEntries(chats.map((c) => [c.id, c]));
  const ids = (list: { id: string }[]) => list.map((c) => c.id);

  it('sorts pinned first, then by last activity; excludes archived and channels', () => {
    expect(ids(selectSortedChats(byId))).toEqual(['c', 'b', 'f', 'a']);
  });

  it('filters unread (count or marked) and groups', () => {
    expect(ids(selectSortedChats(byId, { filter: 'unread' }))).toEqual(['b', 'f']);
    expect(ids(selectSortedChats(byId, { filter: 'groups' }))).toEqual(['c', 'b', 'a']);
  });

  it('lists the archive and channels separately', () => {
    expect(ids(selectSortedChats(byId, { archived: true }))).toEqual(['d']);
    expect(ids(selectSortedChats(byId, { kind: 'channels' }))).toEqual(['e']);
  });

  it('matches the query against the chat title (peer name for direct chats)', () => {
    expect(ids(selectSortedChats(byId, { query: 'zo' }))).toEqual(['f']);
  });
});

describe('chats store', () => {
  beforeEach(() => resetSessionState());
  afterEach(() => vi.useRealTimers());

  it('upserts peers into the users cache and merges patches', () => {
    const peer = makeUser({ id: 'u1', displayName: 'Ada', online: true, lastSeenAt: null });
    useChats.getState().upsertChat(makeChat({ id: 'x', type: 'direct', peer }));
    expect(useUsers.getState().byId.u1?.displayName).toBe('Ada');
    expect(useUsers.getState().presence.u1?.online).toBe(true);
    useChats.getState().patchChat('x', { unreadCount: 4 });
    expect(useChats.getState().byId.x).toMatchObject({ unreadCount: 4, peer: { id: 'u1' } });
    useChats.getState().removeChat('x');
    expect(useChats.getState().byId.x).toBeUndefined();
  });

  it('typing indicators auto-expire after TYPING_TIMEOUT_MS', () => {
    vi.useFakeTimers();
    useChats.getState().setTyping('x', 'u1', 'typing');
    expect(useChats.getState().typing.x?.u1?.state).toBe('typing');
    vi.advanceTimersByTime(TYPING_TIMEOUT_MS - 100);
    useChats.getState().setTyping('x', 'u1', 'recording'); // refresh
    vi.advanceTimersByTime(TYPING_TIMEOUT_MS - 100);
    expect(useChats.getState().typing.x?.u1?.state).toBe('recording');
    vi.advanceTimersByTime(200);
    expect(useChats.getState().typing.x).toBeUndefined();
  });

  it('idle clears typing immediately', () => {
    useChats.getState().setTyping('x', 'u1', 'typing');
    useChats.getState().setTyping('x', 'u1', 'idle');
    expect(useChats.getState().typing.x).toBeUndefined();
  });
});

/** A promise resolved from outside (to hold a request "in flight"). */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const flush = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('chats store: list reloads vs. concurrent changes', () => {
  beforeEach(() => {
    resetSessionState();
    vi.restoreAllMocks();
    useAuth.setState({ user: makeMe({ id: 'me' }) });
  });

  it('keeps a chat added and drops a chat removed while GET /api/chats was in flight', async () => {
    const req = deferred<ChatSummary[]>();
    vi.spyOn(api, 'get').mockReturnValue(req.promise as never);
    const loading = useChats.getState().loadChats();
    useChats.getState().upsertChat(makeChat({ id: 'new-group' })); // chat:upsert (added)
    useChats.getState().removeChat('gone'); // chat:removed (deleted channel)
    req.resolve([makeChat({ id: 'old' }), makeChat({ id: 'gone' })]); // snapshot built earlier
    await loading;
    expect(Object.keys(useChats.getState().byId).sort()).toEqual(['new-group', 'old']);
  });

  it('replays messages received meanwhile onto the snapshot without double counting', async () => {
    const req = deferred<ChatSummary[]>();
    vi.spyOn(api, 'get').mockReturnValue(req.promise as never);
    // Stale cache from before a reconnect: 2 unread, lastSeq 7.
    useChats.getState().upsertChat(makeChat({ id: 'c', lastSeq: 7, unreadCount: 2 }));
    const loading = useChats.getState().loadChats({ fresh: true });
    const bump = (seq: number) =>
      useChats
        .getState()
        .mutateChat('c', (c) =>
          seq > c.lastSeq ? { lastSeq: seq, unreadCount: c.unreadCount + 1 } : null,
        );
    bump(10); // already in the snapshot
    bump(11); // newer than the snapshot
    req.resolve([makeChat({ id: 'c', lastSeq: 10, unreadCount: 5 })]);
    await loading;
    expect(useChats.getState().byId.c).toMatchObject({ lastSeq: 11, unreadCount: 6 });
  });

  it('a REST summary older than applied messages keeps the newer preview and counts', () => {
    const m = makeMessage({ id: 'm9', seq: 9 });
    useChats
      .getState()
      .upsertChat(makeChat({ id: 'c', lastSeq: 9, lastMessage: m, unreadCount: 3 }));
    // e.g. the response of PATCH prefs, built before message 9.
    useChats
      .getState()
      .upsertChat(makeChat({ id: 'c', lastSeq: 8, unreadCount: 2, isPinned: true }));
    expect(useChats.getState().byId.c).toMatchObject({
      lastSeq: 9,
      unreadCount: 3,
      isPinned: true,
      lastMessage: { id: 'm9' },
    });
    // Membership changes always take the incoming summary.
    useChats.getState().upsertChat(makeChat({ id: 'c', lastSeq: 5, membership: 'left' }));
    expect(useChats.getState().byId.c).toMatchObject({ lastSeq: 5, membership: 'left' });
  });

  it('mergeChatUpsert keeps watermarks monotonic for older summaries', () => {
    const cached = makeChat({ lastSeq: 9, readWatermark: 9, deliveredWatermark: 9 });
    const older = makeChat({ id: cached.id, lastSeq: 8, readWatermark: 7, deliveredWatermark: 8 });
    expect(mergeChatUpsert(cached, older)).toMatchObject({
      lastSeq: 9,
      readWatermark: 9,
      deliveredWatermark: 9,
    });
  });

  it('a fresh load never reuses the request already in flight (it follows it)', async () => {
    const first = deferred<ChatSummary[]>();
    const second = deferred<ChatSummary[]>();
    const get = vi
      .spyOn(api, 'get')
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    const early = useChats.getState().loadChats(); // e.g. startRealtime, before `ready`
    const a = useChats.getState().loadChats({ fresh: true }); // resync on `ready`
    const b = useChats.getState().loadChats({ fresh: true }); // shared by concurrent callers
    expect(useChats.getState().loadChats()).toBe(early); // plain callers still dedupe
    expect(get).toHaveBeenCalledTimes(1);
    first.resolve([makeChat({ id: 'before-join' })]);
    await early;
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    second.resolve([makeChat({ id: 'after-join' })]);
    await Promise.all([a, b]);
    expect(Object.keys(useChats.getState().byId)).toEqual(['after-join']);
  });

  it('drops responses that land after a logout', async () => {
    const req = deferred<ChatSummary[]>();
    const one = deferred<ChatSummary>();
    vi.spyOn(api, 'get')
      .mockReturnValueOnce(req.promise as never)
      .mockReturnValueOnce(one.promise as never);
    const loading = useChats.getState().loadChats();
    const refreshing = useChats.getState().refreshChat('x');
    resetSessionState();
    req.resolve([makeChat({ id: 'previous-account' })]);
    one.resolve(makeChat({ id: 'x' }));
    await loading;
    await refreshing;
    expect(useChats.getState().byId).toEqual({});
    expect(useChats.getState().loaded).toBe(false);
  });

  it('recomputes a direct chat’s permissions when its peer changes (deleted account)', () => {
    const peer = makeUser({ id: 'bob' });
    useChats.getState().upsertChat(makeChat({ id: 'd', type: 'direct', name: null, peer }));
    expect(useChats.getState().byId.d!.permissions.canSend).toBe(true);
    useChats.getState().patchChat('d', { peer: { ...peer, isDeleted: true } });
    expect(useChats.getState().byId.d!.permissions).toMatchObject({
      canSend: false,
      canCall: false,
    });
  });

  it('forgetPins / resetPins drop cached pin ids', () => {
    const s = useChats.getState();
    s.setPins('a', ['m1']);
    s.setPins('b', ['m2']);
    s.resetPins('a');
    expect(useChats.getState().pins).toEqual({ a: ['m1'] });
    useChats.getState().forgetPins('a');
    expect(useChats.getState().pins).toEqual({});
  });
});

describe('sorting helpers', () => {
  it('filterChats keeps the sorted order; the archive ignores pinning', () => {
    const chats = [
      makeChat({ id: 'a', lastActivityAt: t(9), unreadCount: 1 }),
      makeChat({ id: 'b', lastActivityAt: t(12) }),
      makeChat({ id: 'c', lastActivityAt: t(8), isPinned: true, unreadCount: 1 }),
      makeChat({ id: 'x', lastActivityAt: t(7), isArchived: true, isPinned: true }),
      makeChat({ id: 'y', lastActivityAt: t(10), isArchived: true }),
    ];
    const byId = Object.fromEntries(chats.map((c) => [c.id, c]));
    const sorted = selectSortedChats(byId);
    expect(sorted.map((c) => c.id)).toEqual(['c', 'b', 'a']);
    expect(filterChats(sorted, { filter: 'unread' }).map((c) => c.id)).toEqual(['c', 'a']);
    expect(filterChats(sorted)).toBe(sorted);
    expect(selectSortedChats(byId, { archived: true }).map((c) => c.id)).toEqual(['y', 'x']);
    expect(compareChats(chats[3]!, chats[4]!, { ignorePinned: true })).toBeGreaterThan(0);
  });
});
