import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TYPING_TIMEOUT_MS } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { makeChat, makeUser } from '@/test/factories';
import { selectSortedChats, useChats } from './chats';
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
