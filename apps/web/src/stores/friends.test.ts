import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { FriendRequest, FriendRequests, ServerToClientEvents } from '@enbox/shared';
import { registerFriendHandlers, resyncFriends } from '@/realtime/friends';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { isAppFocused, playSound, showNotification } from '@/lib/notify';
import type * as NotifyModule from '@/lib/notify';
import { resetSessionState } from '@/lib/session';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { makeMe, makeUser } from '@/test/factories';
import { useAuth } from './auth';
import { useContacts } from './contacts';
import { useFriendStatus, useFriends, useIncomingFriendRequestCount } from './friends';
import { useUi } from './ui';
import { useUsers } from './users';

const request = (
  id: string,
  direction: FriendRequest['direction'],
  displayName = id.toUpperCase(),
  createdAt = '2026-10-01T00:00:00.000Z',
): FriendRequest => ({ user: makeUser({ id, displayName }), direction, createdAt });

const lists = (incoming: FriendRequest[], outgoing: FriendRequest[] = []): FriendRequests => ({
  incoming,
  outgoing,
});

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    on(event: string, fn: (payload: unknown) => void) {
      handlers.set(event, fn);
      return socket;
    },
  } as unknown as AppSocket;
  const fire = <E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ) => handlers.get(event)!(payload);
  return { socket, fire };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

vi.mock('@/lib/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof NotifyModule>();
  return {
    ...actual,
    isAppFocused: vi.fn(() => true),
    playSound: vi.fn(),
    showNotification: vi.fn(async () => true),
  };
});

beforeEach(() => {
  resetSessionState();
  vi.restoreAllMocks();
  vi.mocked(isAppFocused).mockReturnValue(true);
  vi.mocked(playSound).mockClear();
  vi.mocked(showNotification).mockClear();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  useUi.getState().setPref('sounds', true);
  useUi.getState().setPref('desktopNotifications', true);
});

describe('friends store', () => {
  it('load fetches both lists once, newest first, with the profiles in the users store', async () => {
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue(
        lists([request('a', 'incoming'), request('b', 'incoming')], [request('c', 'outgoing')]),
      );
    await Promise.all([useFriends.getState().load(), useFriends.getState().load()]);
    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/api/friends/requests');
    expect(useFriends.getState().incoming.map((e) => e.userId)).toEqual(['a', 'b']);
    expect(useFriends.getState().outgoing.map((e) => e.userId)).toEqual(['c']);
    expect(useUsers.getState().byId.c?.displayName).toBe('C');
    await useFriends.getState().load(); // cached
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('send posts the username or id and refetches; an accepted one also refetches contacts', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 'sent' });
    const get = vi.spyOn(api, 'get').mockResolvedValue(lists([], [request('b', 'outgoing')]));
    expect(await useFriends.getState().send({ username: 'bob' })).toBe('sent');
    expect(post).toHaveBeenCalledWith('/api/friends/requests', { username: 'bob' });
    await flush();
    expect(useFriends.getState().outgoing.map((e) => e.userId)).toEqual(['b']);

    post.mockResolvedValue({ status: 'accepted' });
    get.mockResolvedValue(lists([]));
    const syncContacts = vi.spyOn(useContacts.getState(), 'syncContacts').mockResolvedValue();
    expect(await useFriends.getState().send({ userId: 'c' })).toBe('accepted');
    expect(syncContacts).toHaveBeenCalled();
  });

  it('accept, decline and cancel call their routes and update the lists; accept makes a contact', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(
      lists([request('a', 'incoming'), request('b', 'incoming')], [request('c', 'outgoing')]),
    );
    await useFriends.getState().load();
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);

    await useFriends.getState().accept('a');
    expect(post).toHaveBeenCalledWith('/api/friends/requests/a/accept');
    expect(useFriends.getState().incoming.map((e) => e.userId)).toEqual(['b']);
    expect(useUsers.getState().byId.a?.isContact).toBe(true);
    expect(useContacts.getState().contacts).toMatchObject([{ userId: 'a', name: null }]);

    await useFriends.getState().decline('b');
    expect(del).toHaveBeenLastCalledWith('/api/friends/requests/b');
    await useFriends.getState().cancel('c');
    expect(del).toHaveBeenLastCalledWith('/api/friends/requests/c');
    expect(useFriends.getState()).toMatchObject({ incoming: [], outgoing: [] });
  });

  it('a failed action leaves the lists as they were', async () => {
    vi.spyOn(api, 'get').mockResolvedValue(lists([request('a', 'incoming')]));
    await useFriends.getState().load();
    vi.spyOn(api, 'post').mockRejectedValue(new Error('nope'));
    await expect(useFriends.getState().accept('a')).rejects.toThrow('nope');
    expect(useFriends.getState().incoming.map((e) => e.userId)).toEqual(['a']);
  });

  it('removeFriend deletes the friendship and unmarks the contact everywhere', async () => {
    useUsers.getState().upsertUsers([makeUser({ id: 'f', isContact: true })]);
    useContacts.setState({
      contacts: [{ userId: 'f', name: null, createdAt: '2026-01-01T00:00:00.000Z' }],
    });
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    await useFriends.getState().removeFriend('f');
    expect(del).toHaveBeenCalledWith('/api/friends/f');
    expect(useUsers.getState().byId.f?.isContact).toBe(false);
    expect(useContacts.getState().contacts).toEqual([]);
  });

  it('sync coalesces a burst into at most two requests', async () => {
    let resolve!: (v: FriendRequests) => void;
    const get = vi
      .spyOn(api, 'get')
      .mockImplementationOnce(() => new Promise((r) => (resolve = r as typeof resolve)))
      .mockResolvedValue(lists([request('z', 'incoming')]));
    const s = useFriends.getState();
    void s.sync();
    void s.sync();
    void s.sync();
    resolve(lists([]));
    await flush();
    await flush();
    expect(get).toHaveBeenCalledTimes(2);
    expect(useFriends.getState().incoming.map((e) => e.userId)).toEqual(['z']);
  });

  it('logout clears the lists and drops late responses', async () => {
    let resolve!: (v: FriendRequests) => void;
    vi.spyOn(api, 'get').mockImplementationOnce(
      () => new Promise((r) => (resolve = r as typeof resolve)),
    );
    const pending = useFriends.getState().load();
    resetSessionState();
    resolve(lists([request('late', 'incoming')]));
    await pending;
    expect(useFriends.getState()).toMatchObject({ incoming: [], loaded: false });
  });
});

describe('friend status and badge hooks', () => {
  it('friend / incoming / outgoing / none / self', () => {
    useFriends.setState({
      incoming: [{ userId: 'in', createdAt: '' }],
      outgoing: [{ userId: 'out', createdAt: '' }],
      loaded: true,
    });
    const status = (u: { id: string; isContact: boolean }) =>
      renderHook(() => useFriendStatus(u)).result.current;
    expect(status({ id: 'me', isContact: false })).toBe('self');
    expect(status({ id: 'pal', isContact: true })).toBe('friend');
    expect(status({ id: 'in', isContact: false })).toBe('incoming');
    expect(status({ id: 'out', isContact: false })).toBe('outgoing');
    expect(status({ id: 'new', isContact: false })).toBe('none');
    // The cached profile wins over a stale copy.
    useUsers.getState().upsertUsers([makeUser({ id: 'pal', isContact: false })]);
    expect(status({ id: 'pal', isContact: true })).toBe('none');
  });

  it('the badge counts incoming requests only, live', () => {
    const { result } = renderHook(() => useIncomingFriendRequestCount());
    expect(result.current).toBe(0);
    act(() => {
      useFriends.getState().applyIncoming(request('a', 'incoming'));
      useFriends.getState().applyIncoming(request('b', 'incoming'));
      useFriends.setState({ outgoing: [{ userId: 'c', createdAt: '' }] });
    });
    expect(result.current).toBe(2);
  });
});

describe('realtime friends', () => {
  it('friends:request adds the request (deduped, newest first) and toasts with a View action', () => {
    const { socket, fire } = fakeSocket();
    registerFriendHandlers(socket);
    fire('friends:request', { request: request('a', 'incoming', 'Ada') });
    fire('friends:request', { request: request('b', 'incoming', 'Bo') });
    fire('friends:request', { request: request('a', 'incoming', 'Ada') });
    expect(useFriends.getState().incoming.map((e) => e.userId)).toEqual(['a', 'b']);
    expect(useUsers.getState().byId.b?.displayName).toBe('Bo');

    const toasts = useUi.getState().toasts;
    expect(toasts.map((t) => t.message)).toEqual([
      'Bo sent you a friend request.',
      'Ada sent you a friend request.',
    ]);
    const navigate = vi.fn();
    const off = bus.on('navigate', navigate);
    toasts[1]!.action!.onClick();
    off();
    expect(navigate).toHaveBeenCalledWith({ to: '/chats?friends=pending' });
    // Looking at the app: the sound, no system notification.
    expect(playSound).toHaveBeenCalledWith('notification');
    expect(showNotification).not.toHaveBeenCalled();
  });

  it('away from the app: a system notification with the push tag; nothing in do not disturb', () => {
    const { socket, fire } = fakeSocket();
    registerFriendHandlers(socket);
    vi.mocked(isAppFocused).mockReturnValue(false);
    fire('friends:request', { request: request('a', 'incoming', 'Ada') });
    expect(showNotification).toHaveBeenCalledWith({
      title: 'Ada',
      body: 'Sent you a friend request',
      tag: 'friend:a',
      url: '/chats?friends=pending',
    });

    vi.mocked(showNotification).mockClear();
    useAuth.setState({ user: makeMe({ id: 'me', availability: 'dnd' }) });
    fire('friends:request', { request: request('b', 'incoming', 'Bo') });
    expect(showNotification).not.toHaveBeenCalled();
    expect(playSound).not.toHaveBeenCalled();
    // The request and its toast still arrive.
    expect(useFriends.getState().incoming.map((e) => e.userId)).toEqual(['b', 'a']);
    expect(useUi.getState().toasts.at(-1)?.message).toBe('Bo sent you a friend request.');
  });

  it('friends:changed and every ready refetch the requests', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue(lists([request('a', 'incoming')]));
    const { socket, fire } = fakeSocket();
    registerFriendHandlers(socket);
    fire('friends:changed', {});
    await flush();
    expect(get).toHaveBeenCalledWith('/api/friends/requests');
    expect(useFriends.getState().incoming.map((e) => e.userId)).toEqual(['a']);

    get.mockResolvedValue(lists([]));
    await resyncFriends({ userId: 'me', sessionId: 's', reconnect: true } as ReadyInfo);
    expect(useFriends.getState().incoming).toEqual([]);
  });
});
