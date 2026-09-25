import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Call,
  ChatSummary,
  Message,
  MessagePage,
  ServerToClientEvents,
  UserPublic,
} from '@enbox/shared';
import { api } from '@/lib/api';
import type * as NotifyModule from '@/lib/notify';
import { resetSessionState } from '@/lib/session';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { mergePage, useMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { registerChatHandlers, resyncChats } from './chats';
import {
  handleMessageUpdated,
  handleMessagesRemoved,
  handleNewMessage,
  messageChatPatch,
  withViewerFields,
} from './messages';
import { registerUserHandlers } from './users';
import type * as CallsModule from './calls';
import type * as ChatsModule from './chats';
import type * as UsersModule from './users';

vi.mock('@/lib/notify', async (importOriginal) => {
  const actual = await importOriginal<typeof NotifyModule>();
  return {
    ...actual,
    isAppFocused: vi.fn(() => false),
    playSound: vi.fn(),
    showNotification: vi.fn(async () => true),
  };
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

const READY: ReadyInfo = { userId: 'me', sessionId: 's', serverTime: '', reconnect: true };

function seedWindow(chatId: string, messages: Message[]) {
  useMessages.setState((s) => ({
    byChat: {
      ...s.byChat,
      [chatId]: {
        items: mergePage([], messages),
        hasMoreBefore: false,
        hasMoreAfter: false,
        loaded: true,
        loadingLatest: false,
        loadingBefore: false,
        loadingAfter: false,
        error: null,
      },
    },
  }));
}

beforeEach(() => {
  resetSessionState();
  vi.restoreAllMocks();
  useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
});

describe('message:new → chat list', () => {
  it('does not count twice when chat:upsert (already counting it) came first', () => {
    // JOIN(me): the summary is built after the message was inserted.
    const message = makeMessage({ id: 'm1', seq: 1, senderId: 'bob', mentions: ['me'] });
    useChats.getState().upsertChat(
      makeChat({
        id: 'chat-1',
        lastSeq: 1,
        lastMessage: message,
        unreadCount: 1,
        unreadMentionCount: 1,
      }),
    );
    handleNewMessage(message);
    expect(useChats.getState().byId['chat-1']).toMatchObject({
      unreadCount: 1,
      unreadMentionCount: 1,
    });
    handleNewMessage(makeMessage({ id: 'm2', seq: 2, senderId: 'bob' }));
    expect(useChats.getState().byId['chat-1']).toMatchObject({
      lastSeq: 2,
      unreadCount: 2,
      unreadMentionCount: 1,
    });
  });

  it('messageChatPatch: my own message reads everything before it', () => {
    const chat = makeChat({ lastSeq: 4, lastReadSeq: 2, unreadCount: 2, markedUnread: true });
    expect(
      messageChatPatch(chat, makeMessage({ seq: 5, senderId: 'me' }), {
        me: 'me',
        visible: false,
      }),
    ).toMatchObject({ lastSeq: 5, lastReadSeq: 5, unreadCount: 0, markedUnread: false });
    // A lower seq from someone else after my confirmed send: already read, not fresh.
    expect(
      messageChatPatch({ ...chat, lastSeq: 6, lastReadSeq: 6, unreadCount: 0 }, makeMessage({ seq: 5 }), {
        me: 'me',
        visible: false,
      }),
    ).toBeNull();
  });
});

describe('message:updated / message:removed', () => {
  it('derives my reaction and votes outside channels (changed on another device)', () => {
    const m = makeMessage({
      type: 'poll',
      reactions: [{ emoji: '👍', count: 1, userIds: ['me'] }],
      poll: {
        question: 'q',
        allowMultiple: false,
        totalVoters: 1,
        options: [
          { id: 'a', text: 'A', voteCount: 1, voterIds: ['me'] },
          { id: 'b', text: 'B', voteCount: 0, voterIds: [] },
        ],
      },
    });
    const derived = withViewerFields(m, { type: 'group' }, 'me');
    expect(derived.myReaction).toBe('👍');
    expect(derived.poll?.myOptionIds).toEqual(['a']);
    // Channels are anonymous: keep the cached values.
    expect(withViewerFields(m, { type: 'channel' }, 'me')).toBe(m);

    useChats.getState().upsertChat(makeChat({ id: 'chat-1' }));
    seedWindow('chat-1', [{ ...m, reactions: [], myReaction: null }]);
    handleMessageUpdated(m);
    expect(useMessages.getState().byChat['chat-1']!.items[0]!.myReaction).toBe('👍');
  });

  it('recounts when an unread mention is edited out or deleted', async () => {
    vi.useFakeTimers();
    const get = vi
      .spyOn(api, 'get')
      .mockResolvedValue(makeChat({ id: 'chat-1', lastSeq: 3, unreadCount: 1 }) as never);
    useChats
      .getState()
      .upsertChat(makeChat({ id: 'chat-1', lastSeq: 3, unreadCount: 1, unreadMentionCount: 1 }));
    // A reaction on an unread message without a mention: nothing to recount.
    handleMessageUpdated(makeMessage({ id: 'x', seq: 2, senderId: 'bob', mentions: ['me'] }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(get).not.toHaveBeenCalled();

    handleMessageUpdated(
      makeMessage({ id: 'x', seq: 3, senderId: 'bob', deletedAt: '2025-03-12T11:00:00.000Z' }),
    );
    await vi.advanceTimersByTimeAsync(1_000);
    expect(get).toHaveBeenCalledWith('/api/chats/chat-1');
    expect(useChats.getState().byId['chat-1']!.unreadMentionCount).toBe(0);
    vi.useRealTimers();
  });

  it('recounts when unknown (possibly unread) messages are removed', async () => {
    vi.useFakeTimers();
    const get = vi.spyOn(api, 'get').mockResolvedValue(makeChat({ id: 'chat-1' }) as never);
    useChats
      .getState()
      .upsertChat(makeChat({ id: 'chat-1', lastSeq: 9, lastReadSeq: 5, unreadCount: 3 }));
    seedWindow('chat-1', [makeMessage({ id: 'read', seq: 4, senderId: 'bob' })]);
    handleMessagesRemoved('chat-1', ['read']); // known and already read
    await vi.advanceTimersByTimeAsync(1_000);
    expect(get).not.toHaveBeenCalled();
    handleMessagesRemoved('chat-1', ['purged-1', 'purged-2']); // disappearing purge
    await vi.advanceTimersByTimeAsync(1_000);
    expect(get).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe('chat events', () => {
  const liveCall = (chatId: string) =>
    ({ id: 'call-1', chatId, status: 'ongoing', isGroup: true, participants: [] }) as unknown as Call;

  it('forgets the live call of a chat I left or that was removed', () => {
    const { socket, fire } = fakeSocket();
    registerChatHandlers(socket);
    useChats.getState().upsertChat(makeChat({ id: 'g1' }));
    useChats.getState().upsertChat(makeChat({ id: 'g2' }));
    useCalls.getState().setLiveCall(liveCall('g1'));
    useCalls.getState().setLiveCall(liveCall('g2'));

    fire('chat:upsert', { chat: makeChat({ id: 'g1', membership: 'removed' }) });
    expect(useCalls.getState().liveCalls.g1).toBeUndefined();
    fire('chat:removed', { chatId: 'g2' });
    expect(useCalls.getState().liveCalls.g2).toBeUndefined();
    // A late call:updated for a chat I'm no longer in doesn't bring the banner back.
    useCalls.getState().setLiveCall(liveCall('g1'));
    expect(useCalls.getState().liveCalls.g1).toBeUndefined();
  });

  it('an older chat:read does not undo a newer local read', () => {
    const { socket, fire } = fakeSocket();
    registerChatHandlers(socket);
    useChats.getState().upsertChat(makeChat({ id: 'c', lastSeq: 10, lastReadSeq: 10 }));
    fire('chat:read', {
      chatId: 'c',
      lastReadSeq: 8,
      unreadCount: 2,
      unreadMentionCount: 0,
      markedUnread: false,
    });
    expect(useChats.getState().byId.c).toMatchObject({ lastReadSeq: 10, unreadCount: 0 });
  });

  it('user:changed for a deleted peer makes the direct chat read-only', async () => {
    const { socket, fire } = fakeSocket();
    registerUserHandlers(socket);
    const bob = makeUser({ id: 'bob' });
    useChats.getState().upsertChat(makeChat({ id: 'd', type: 'direct', name: null, peer: bob }));
    vi.spyOn(api, 'post').mockResolvedValue([{ ...bob, isDeleted: true }] as UserPublic[]);
    fire('user:changed', { userId: 'bob' });
    await vi.waitFor(() =>
      expect(useChats.getState().byId.d!.permissions.canSend).toBe(false),
    );
    expect(useChats.getState().byId.d!.permissions.canCall).toBe(false);
    expect(useUsers.getState().byId.bob?.isDeleted).toBe(true);
  });
});

describe('resyncChats (every `ready`)', () => {
  it('keeps unsent messages of other chats and forgets their pins', async () => {
    const open = makeChat({ id: 'open', lastSeq: 1 });
    const other = makeChat({ id: 'other', lastSeq: 1 });
    useChats.getState().upsertChats([open, other]);
    useChats.getState().setOpenChat('open');
    useChats.getState().setPins('open', ['p-stale']);
    useChats.getState().setPins('other', ['p-stale']);
    seedWindow('open', [makeMessage({ chatId: 'open', id: 'o1', seq: 1 })]);
    seedWindow('other', [makeMessage({ chatId: 'other', id: 'x1', seq: 1 })]);
    useMessages.getState().addOptimistic('other', { type: 'text', text: 'x', clientId: 'cf' });
    useMessages.getState().markFailed('other', 'cf');

    vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
      if (path === '/api/chats') return [open, other] as ChatSummary[];
      if (path === '/api/chats/open/pins')
        return [makeMessage({ chatId: 'open', id: 'p-new' })] as Message[];
      if (path === '/api/chats/open/messages')
        return {
          messages: [makeMessage({ chatId: 'open', id: 'o1', seq: 1 })],
          hasMoreBefore: false,
          hasMoreAfter: false,
          users: [],
        } satisfies MessagePage;
      throw new Error(`unexpected ${path}`);
    });
    await resyncChats(READY);

    expect(useChats.getState().pins).toEqual({ open: ['p-new'] });
    const w = useMessages.getState().byChat.other!;
    expect(w.loaded).toBe(false);
    expect(w.items.map((m) => m.clientId)).toEqual(['cf']);
    expect(w.items[0]!.failed).toBe(true);
  });

  it('does not undo a jump made after `ready` by reloading the latest page', async () => {
    const open = makeChat({ id: 'open', lastSeq: 90 });
    useChats.getState().upsertChats([open]);
    useChats.getState().setOpenChat('open');
    seedWindow('open', [makeMessage({ chatId: 'open', id: 'o90', seq: 90 })]);
    let releaseChats!: (v: ChatSummary[]) => void;
    const get = vi.spyOn(api, 'get').mockImplementation(async (path: string, opts) => {
      if (path === '/api/chats') return new Promise((r) => (releaseChats = r));
      if (path === '/api/chats/open/pins') return [];
      if (path === '/api/chats/open/messages') {
        const around = (opts?.query as { around?: number } | undefined)?.around;
        return {
          messages: [makeMessage({ chatId: 'open', id: around ? 'o1' : 'o90', seq: around ?? 90 })],
          hasMoreBefore: false,
          hasMoreAfter: !!around,
          users: [],
        } satisfies MessagePage;
      }
      throw new Error(`unexpected ${path}`);
    });
    const resync = resyncChats(READY);
    await useMessages.getState().loadAround('open', 1); // search → jump, after `ready`
    releaseChats([open]);
    await resync;
    const latestLoads = get.mock.calls.filter(
      ([path, opts]) =>
        path === '/api/chats/open/messages' &&
        !(opts?.query as { around?: number } | undefined)?.around,
    );
    expect(latestLoads).toHaveLength(0);
    expect(useMessages.getState().byChat.open!.items.map((m) => m.seq)).toEqual([1]);
  });
});

describe('ready resync order', () => {
  afterEach(() => vi.doUnmock('./chats'));

  it('starts the calls resync without waiting for the chat list', async () => {
    vi.resetModules();
    let releaseChats!: () => void;
    const order: string[] = [];
    vi.doMock('./chats', async (importOriginal) => ({
      ...(await importOriginal<typeof ChatsModule>()),
      resyncChats: vi.fn(
        () =>
          new Promise<void>((resolve) => {
            order.push('chats:start');
            releaseChats = () => {
              order.push('chats:done');
              resolve();
            };
          }),
      ),
    }));
    vi.doMock('./calls', async (importOriginal) => ({
      ...(await importOriginal<typeof CallsModule>()),
      resyncCalls: vi.fn(async () => {
        order.push('calls');
      }),
    }));
    vi.doMock('./users', async (importOriginal) => ({
      ...(await importOriginal<typeof UsersModule>()),
      resyncUsers: vi.fn(async () => {
        order.push('users');
      }),
    }));
    const { resyncAll } = await import('./index');
    const done = resyncAll(READY);
    await Promise.resolve();
    expect(order).toEqual(['calls', 'chats:start']);
    releaseChats();
    await done;
    expect(order).toEqual(['calls', 'chats:start', 'chats:done', 'users']);
    vi.doUnmock('./calls');
    vi.doUnmock('./users');
  });
});
