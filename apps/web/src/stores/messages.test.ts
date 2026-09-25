import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, MessagePage } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { useAuth } from './auth';
import { useChats } from './chats';
import {
  MAX_CACHED_WINDOWS,
  TRIM_WINDOW_TO,
  compactWindows,
  mergePage,
  releaseDropped,
  upsertInto,
  useMessages,
  type ChatMessages,
  type ClientMessage,
} from './messages';
import { useUsers } from './users';

const CHAT = 'chat-1';

function seqs(items: ClientMessage[]) {
  return items.map((m) => (m.pending || m.failed ? `p:${m.clientId}` : m.seq));
}

function seed(
  messages: Message[],
  bounds: Partial<{ hasMoreBefore: boolean; hasMoreAfter: boolean }> = {},
) {
  useMessages.setState({
    byChat: {
      [CHAT]: {
        items: mergePage([], messages),
        hasMoreBefore: false,
        hasMoreAfter: false,
        loaded: true,
        loadingLatest: false,
        loadingBefore: false,
        loadingAfter: false,
        error: null,
        ...bounds,
      },
    },
  });
}

const items = () => useMessages.getState().byChat[CHAT]!.items;

describe('upsertInto (pure)', () => {
  it('keeps confirmed messages ordered by seq and dedupes by id', () => {
    let list: ClientMessage[] = [];
    for (const seq of [3, 1, 2, 2]) list = upsertInto(list, makeMessage({ id: `m${seq}`, seq }));
    expect(seqs(list)).toEqual([1, 2, 3]);
  });

  it('merges updates so viewer-specific fields survive viewer-neutral payloads', () => {
    let list = upsertInto([], makeMessage({ id: 'm1', seq: 1, text: 'hi', starred: true }));
    list = upsertInto(
      list,
      makeMessage({ id: 'm1', seq: 1, text: 'hi (edited)', editedAt: '2025-03-12T10:43:00.000Z' }),
    );
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ text: 'hi (edited)', starred: true });
  });

  it('keeps viewer-specific fields (myReaction, poll.myOptionIds) across viewer-neutral updates', () => {
    const poll = {
      question: 'Lunch?',
      allowMultiple: false,
      totalVoters: 1,
      options: [
        { id: 'a', text: 'Pizza', voteCount: 1, voterIds: ['me'] },
        { id: 'b', text: 'Sushi', voteCount: 0, voterIds: [] },
      ],
    };
    let list = upsertInto(
      [],
      makeMessage({
        id: 'p1',
        seq: 1,
        type: 'poll',
        poll: { ...poll, myOptionIds: ['a'] },
        myReaction: '👍',
      }),
    );
    list = upsertInto(
      list,
      makeMessage({ id: 'p1', seq: 1, type: 'poll', poll: { ...poll, totalVoters: 2 } }),
    );
    expect(list[0]).toMatchObject({
      myReaction: '👍',
      poll: { totalVoters: 2, myOptionIds: ['a'] },
    });
  });

  it('ignores new messages outside the loaded window', () => {
    const list = mergePage(
      [],
      [makeMessage({ id: 'a', seq: 10 }), makeMessage({ id: 'b', seq: 11 })],
    );
    expect(
      upsertInto(list, makeMessage({ id: 'c', seq: 12 }), {
        hasMoreBefore: false,
        hasMoreAfter: true,
      }),
    ).toBe(list);
    expect(
      upsertInto(list, makeMessage({ id: 'd', seq: 5 }), {
        hasMoreBefore: true,
        hasMoreAfter: false,
      }),
    ).toBe(list);
    expect(seqs(upsertInto(list, makeMessage({ id: 'e', seq: 12 })))).toEqual([10, 11, 12]);
  });

  it('onlyIfPresent never inserts', () => {
    const list = mergePage([], [makeMessage({ id: 'a', seq: 1 })]);
    expect(upsertInto(list, makeMessage({ id: 'x', seq: 2 }), undefined, true)).toBe(list);
  });
});

describe('messages store', () => {
  beforeEach(() => {
    resetSessionState();
    useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
    useChats.getState().upsertChat(makeChat({ id: CHAT, lastSeq: 2 }));
  });

  it('replaces the optimistic entry when the server message (same clientId) arrives', () => {
    seed([makeMessage({ id: 'm1', seq: 1 }), makeMessage({ id: 'm2', seq: 2 })]);
    const opt = useMessages
      .getState()
      .addOptimistic(CHAT, { type: 'text', text: 'yo', clientId: 'c1', localUrl: 'blob:x' });
    expect(opt).toMatchObject({ id: 'local:c1', seq: 0, pending: true, senderId: 'me' });
    expect(seqs(items())).toEqual([1, 2, 'p:c1']);
    // Chat list preview shows the outgoing message immediately.
    expect(useChats.getState().byId[CHAT]!.lastMessage?.id).toBe('local:c1');

    useMessages
      .getState()
      .upsertMessage(makeMessage({ id: 'm3', seq: 3, clientId: 'c1', senderId: 'me', text: 'yo' }));
    expect(seqs(items())).toEqual([1, 2, 3]);
    const confirmed = items()[2]!;
    expect(confirmed.pending).toBeUndefined();
    expect(confirmed.id).toBe('m3');
    expect(confirmed.localUrl).toBe('blob:x');

    // The same message again (socket echo after the REST response) is a no-op merge.
    useMessages
      .getState()
      .upsertMessage(makeMessage({ id: 'm3', seq: 3, clientId: 'c1', senderId: 'me', text: 'yo' }));
    expect(items()).toHaveLength(3);
  });

  it('keeps optimistic entries at the end while newer confirmed messages arrive', () => {
    seed([makeMessage({ id: 'm1', seq: 1 })]);
    useMessages.getState().addOptimistic(CHAT, { type: 'text', text: 'a', clientId: 'ca' });
    useMessages.getState().upsertMessage(makeMessage({ id: 'm2', seq: 2 }));
    expect(seqs(items())).toEqual([1, 2, 'p:ca']);
  });

  it('markFailed flags the optimistic entry; removeMessages / clearChat prune', () => {
    seed([1, 2, 3, 4].map((seq) => makeMessage({ id: `m${seq}`, seq })));
    useMessages.getState().addOptimistic(CHAT, { type: 'text', text: 'a', clientId: 'ca' });
    useMessages.getState().markFailed(CHAT, 'ca');
    expect(items().at(-1)).toMatchObject({ failed: true, pending: false });

    useMessages.getState().removeMessages(CHAT, ['m2']);
    expect(seqs(items())).toEqual([1, 3, 4, 'p:ca']);

    useChats.getState().setPins(CHAT, ['m3']);
    useMessages.getState().clearChat(CHAT, 3);
    expect(seqs(items())).toEqual([4, 'p:ca']);
    // Pins on cleared messages are no longer mine to see: re-seeded from the server.
    expect(useChats.getState().pins[CHAT]).toBeUndefined();
  });

  it('sendMessage posts, replaces the optimistic entry and updates the chat preview', async () => {
    seed([makeMessage({ id: 'm1', seq: 1 })]);
    const server = makeMessage({ id: 'm2', seq: 2, clientId: 'c9', senderId: 'me', text: 'hello' });
    const post = vi.spyOn(api, 'post').mockResolvedValue(server);
    const result = await useMessages
      .getState()
      .sendMessage(CHAT, { type: 'text', text: 'hello', clientId: 'c9' });
    expect(post).toHaveBeenCalledWith(`/api/chats/${CHAT}/messages`, {
      type: 'text',
      text: 'hello',
      clientId: 'c9',
    });
    expect(result.id).toBe('m2');
    expect(seqs(items())).toEqual([1, 2]);
    expect(useChats.getState().byId[CHAT]).toMatchObject({ lastSeq: 2, lastReadSeq: 2 });
  });

  it('sendMessage marks failed on error and retryMessage re-sends', async () => {
    seed([]);
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('offline'));
    await expect(
      useMessages.getState().sendMessage(CHAT, { type: 'text', text: 'x', clientId: 'cx' }),
    ).rejects.toThrow('offline');
    expect(items()[0]).toMatchObject({ failed: true });

    post.mockResolvedValueOnce(
      makeMessage({ id: 'm1', seq: 1, clientId: 'cx', senderId: 'me', text: 'x' }),
    );
    await useMessages.getState().retryMessage(CHAT, 'cx');
    expect(seqs(items())).toEqual([1]);
  });

  it('loadLatest replaces the window but keeps unconfirmed optimistic entries', async () => {
    seed([makeMessage({ id: 'old', seq: 1, starred: true })]);
    useMessages.getState().addOptimistic(CHAT, { type: 'text', text: 'pending', clientId: 'cp' });
    const page: MessagePage = {
      messages: [makeMessage({ id: 'm4', seq: 4 }), makeMessage({ id: 'm5', seq: 5 })],
      hasMoreBefore: true,
      hasMoreAfter: false,
      users: [makeUser({ id: 'user-1', displayName: 'Sender' })],
    };
    vi.spyOn(api, 'get').mockResolvedValue(page);
    await useMessages.getState().loadLatest(CHAT);
    const s = useMessages.getState().byChat[CHAT]!;
    expect(seqs(s.items)).toEqual([4, 5, 'p:cp']);
    expect(s.hasMoreBefore).toBe(true);
    expect(s.hasMoreAfter).toBe(false);
    // Side-loaded users land in the users store.
    expect(useUsers.getState().byId['user-1']?.displayName).toBe('Sender');
  });

  it('ignores realtime messages for chats that were never opened', () => {
    useMessages.getState().upsertMessage(makeMessage({ chatId: 'other', id: 'z', seq: 1 }));
    expect(useMessages.getState().byChat.other).toBeUndefined();
  });
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const page = (messages: Message[], more: Partial<MessagePage> = {}): MessagePage => ({
  messages,
  hasMoreBefore: false,
  hasMoreAfter: false,
  users: [],
  ...more,
});

describe('messages store: page requests vs. concurrent changes', () => {
  beforeEach(() => {
    resetSessionState();
    vi.restoreAllMocks();
    useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
    useChats.getState().upsertChat(makeChat({ id: CHAT, lastSeq: 2 }));
  });

  it('keeps messages that arrived while the latest page was in flight', async () => {
    seed([makeMessage({ id: 'm1', seq: 1 }), makeMessage({ id: 'm2', seq: 2 })]);
    const req = deferred<MessagePage>();
    vi.spyOn(api, 'get').mockReturnValue(req.promise as never);
    const loading = useMessages.getState().loadLatest(CHAT);
    // Carol's message is committed after the server built the page.
    useMessages.getState().upsertMessage(makeMessage({ id: 'm3', seq: 3, text: 'carol' }));
    // An edit of message 2 received meanwhile is newer than the page's copy.
    useMessages
      .getState()
      .upsertMessage(makeMessage({ id: 'm2', seq: 2, text: 'edited' }), { onlyIfPresent: true });
    req.resolve(page([makeMessage({ id: 'm1', seq: 1 }), makeMessage({ id: 'm2', seq: 2 })]));
    await loading;
    expect(seqs(items())).toEqual([1, 2, 3]);
    expect(items()[1]!.text).toBe('edited');
  });

  it('applies removals and clears received while the page was in flight', async () => {
    seed([]);
    const req = deferred<MessagePage>();
    vi.spyOn(api, 'get').mockReturnValue(req.promise as never);
    const loading = useMessages.getState().loadLatest(CHAT);
    useMessages.getState().removeMessages(CHAT, ['m2']); // disappearing purge
    useMessages.getState().clearChat(CHAT, 1);
    req.resolve(page([1, 2, 3].map((seq) => makeMessage({ id: `m${seq}`, seq }))));
    await loading;
    expect(seqs(items())).toEqual([3]);
  });

  it('a jump that reaches the newest message also keeps arrivals; an older one does not', async () => {
    seed([]);
    const req = deferred<MessagePage>();
    vi.spyOn(api, 'get').mockReturnValue(req.promise as never);
    const loading = useMessages.getState().loadAround(CHAT, 2);
    useMessages.getState().upsertMessage(makeMessage({ id: 'm9', seq: 9 }));
    req.resolve(page([makeMessage({ id: 'm1', seq: 1 }), makeMessage({ id: 'm2', seq: 2 })]));
    await loading;
    expect(seqs(items())).toEqual([1, 2, 9]);

    const older = deferred<MessagePage>();
    vi.spyOn(api, 'get').mockReturnValue(older.promise as never);
    const again = useMessages.getState().loadAround(CHAT, 1);
    useMessages.getState().upsertMessage(makeMessage({ id: 'm10', seq: 10 }));
    older.resolve(page([makeMessage({ id: 'm1', seq: 1 })], { hasMoreAfter: true }));
    await again;
    expect(seqs(items())).toEqual([1]);
  });

  it('a fresh loadLatest issues a new request after the one in flight', async () => {
    seed([]);
    const first = deferred<MessagePage>();
    const second = deferred<MessagePage>();
    const get = vi
      .spyOn(api, 'get')
      .mockReturnValueOnce(first.promise as never)
      .mockReturnValueOnce(second.promise as never);
    const opening = useMessages.getState().loadLatest(CHAT); // ConversationPane, pre-`ready`
    const resync = useMessages.getState().loadLatest(CHAT, { fresh: true });
    expect(useMessages.getState().loadLatest(CHAT, { fresh: true })).toBe(resync);
    expect(get).toHaveBeenCalledTimes(1);
    first.resolve(page([makeMessage({ id: 'm1', seq: 1 })]));
    await opening;
    for (let i = 0; i < 5; i++) await Promise.resolve();
    expect(get).toHaveBeenCalledTimes(2);
    second.resolve(page([makeMessage({ id: 'm1', seq: 1 }), makeMessage({ id: 'm2', seq: 2 })]));
    await resync;
    expect(seqs(items())).toEqual([1, 2]);
  });

  it('a page superseded by a newer window request is dropped (a jump wins)', async () => {
    seed([]);
    const latest = deferred<MessagePage>();
    const around = deferred<MessagePage>();
    const older = deferred<MessagePage>();
    vi.spyOn(api, 'get')
      .mockReturnValueOnce(latest.promise as never)
      .mockReturnValueOnce(around.promise as never);
    const reload = useMessages.getState().loadLatest(CHAT); // e.g. a reconnect reload
    const jump = useMessages.getState().loadAround(CHAT, 1); // the user jumps meanwhile
    around.resolve(page([makeMessage({ id: 'm1', seq: 1 })], { hasMoreAfter: true }));
    await jump;
    latest.resolve(page([makeMessage({ id: 'm90', seq: 90 })]));
    await reload;
    expect(seqs(items())).toEqual([1]);
    expect(useMessages.getState().byChat[CHAT]!.loadingLatest).toBe(false);

    // An older page requested for a window that was replaced meanwhile isn't merged into it.
    vi.spyOn(api, 'get').mockReturnValueOnce(older.promise as never);
    useMessages.setState((s) => ({
      byChat: { ...s.byChat, [CHAT]: { ...s.byChat[CHAT]!, hasMoreBefore: true } },
    }));
    const scrollingUp = useMessages.getState().loadOlder(CHAT);
    vi.spyOn(api, 'get').mockResolvedValueOnce(page([makeMessage({ id: 'm99', seq: 99 })]));
    await useMessages.getState().loadLatest(CHAT);
    older.resolve(page([makeMessage({ id: 'm0', seq: 0.5 })]));
    await scrollingUp;
    expect(seqs(items())).toEqual([99]);
    expect(useMessages.getState().byChat[CHAT]!.loadingBefore).toBe(false);
  });

  it('drops a page that lands after a logout', async () => {
    seed([]);
    const req = deferred<MessagePage>();
    vi.spyOn(api, 'get').mockReturnValue(req.promise as never);
    const loading = useMessages.getState().loadLatest(CHAT);
    resetSessionState();
    req.resolve(page([makeMessage({ id: 'previous-account', seq: 1 })]));
    await loading;
    expect(useMessages.getState().byChat).toEqual({});
  });

  it('discardConfirmed keeps unsent messages (not loaded, so history reloads on open)', () => {
    seed([makeMessage({ id: 'm1', seq: 1 })]);
    useMessages.getState().addOptimistic(CHAT, { type: 'text', text: 'x', clientId: 'cf' });
    useMessages.getState().markFailed(CHAT, 'cf');
    useMessages.getState().discardConfirmed(CHAT);
    const w = useMessages.getState().byChat[CHAT]!;
    expect(w.loaded).toBe(false);
    expect(seqs(w.items)).toEqual(['p:cf']);
    useMessages.getState().markFailed(CHAT, 'cf'); // still addressable
    expect(w.items[0]!.failed).toBe(true);

    useMessages.getState().removeOptimistic(CHAT, 'cf');
    useMessages.getState().discardConfirmed(CHAT);
    expect(useMessages.getState().byChat[CHAT]).toBeUndefined();
  });
});

describe('messages store: optimistic sends and the chat preview', () => {
  beforeEach(() => {
    resetSessionState();
    vi.restoreAllMocks();
    useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
    useChats.getState().upsertChat(
      makeChat({
        id: CHAT,
        lastSeq: 1,
        lastMessage: makeMessage({ id: 'm1', seq: 1 }),
        lastActivityAt: '2025-03-12T10:42:00.000Z',
      }),
    );
  });

  const preview = () => useChats.getState().byId[CHAT]!.lastMessage as ClientMessage;

  it('the preview shows a failed send, and falls back when the message is removed', () => {
    seed([makeMessage({ id: 'm1', seq: 1 })]);
    useMessages.getState().addOptimistic(CHAT, { type: 'text', text: 'x', clientId: 'c1' });
    expect(preview()).toMatchObject({ id: 'local:c1', pending: true });
    useMessages.getState().markFailed(CHAT, 'c1');
    expect(preview()).toMatchObject({ id: 'local:c1', pending: false, failed: true });
    useMessages.getState().removeOptimistic(CHAT, 'c1');
    expect(preview().id).toBe('m1');
    expect(useChats.getState().byId[CHAT]!.lastActivityAt).toBe('2025-03-12T10:42:00.000Z');
  });

  it('an optimistic copy never replaces the confirmed message', () => {
    const confirmed = makeMessage({ id: 'm2', seq: 2, clientId: 'c2', senderId: 'me' });
    const list = mergePage([], [confirmed]);
    const optimistic = { ...confirmed, id: 'local:c2', seq: 0, pending: true } as ClientMessage;
    expect(upsertInto(list, optimistic)).toBe(list);
  });

  it('a retry of a send that did commit resolves with it without posting again', async () => {
    seed([makeMessage({ id: 'm1', seq: 1 })]);
    const post = vi.spyOn(api, 'post').mockRejectedValueOnce(new ApiError('timeout', 'slow'));
    await expect(
      useMessages.getState().sendMessage(CHAT, { type: 'text', text: 'hi', clientId: 'c3' }),
    ).rejects.toThrow();
    // …but the server committed it: the echo replaces the (failed) optimistic entry.
    const echo = makeMessage({ id: 'm2', seq: 2, clientId: 'c3', senderId: 'me', text: 'hi' });
    useMessages.getState().upsertMessage(echo);
    const again = await useMessages.getState().retryMessage(CHAT, 'c3');
    expect(again?.id).toBe('m2');
    expect(post).toHaveBeenCalledTimes(1);
    expect(seqs(items())).toEqual([1, 2]);
    // An explicit send with the same clientId is a no-op too (and keeps the preview).
    useChats.getState().patchChat(CHAT, { lastMessage: echo, lastSeq: 2 });
    await useMessages.getState().sendMessage(CHAT, { type: 'text', text: 'hi', clientId: 'c3' });
    expect(post).toHaveBeenCalledTimes(1);
    expect(preview().id).toBe('m2');
  });
});

describe('messages store: memory', () => {
  const revoke = vi.fn();
  beforeEach(() => {
    resetSessionState();
    vi.restoreAllMocks();
    revoke.mockReset();
    Object.defineProperty(URL, 'revokeObjectURL', { value: revoke, configurable: true });
    useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
    useChats.getState().upsertChat(makeChat({ id: CHAT, lastSeq: 2 }));
  });

  it('revokes the object URLs of removed messages', () => {
    seed([makeMessage({ id: 'm1', seq: 1 })]);
    useMessages.getState().addOptimistic(CHAT, {
      type: 'image',
      clientId: 'ci',
      localUrl: 'blob:local',
      media: {
        id: 'local-ci',
        kind: 'image',
        url: 'blob:local',
        thumbnailUrl: 'blob:thumb',
        mimeType: 'image/jpeg',
        fileName: 'a.jpg',
        size: 1,
        width: null,
        height: null,
        durationMs: null,
        waveform: null,
      },
    });
    useMessages.getState().removeOptimistic(CHAT, 'ci');
    expect(revoke.mock.calls.map((c) => c[0]).sort()).toEqual(['blob:local', 'blob:thumb']);
  });

  it('releaseDropped keeps URLs still referenced by kept messages', () => {
    const a = { ...makeMessage({ id: 'a' }), localUrl: 'blob:shared' } as ClientMessage;
    const b = { ...makeMessage({ id: 'b' }), localUrl: 'blob:shared' } as ClientMessage;
    const c = { ...makeMessage({ id: 'c' }), localUrl: 'https://x/y.jpg' } as ClientMessage;
    releaseDropped([a, c], [b]);
    expect(revoke).not.toHaveBeenCalled();
    releaseDropped([a, c]);
    expect(revoke).toHaveBeenCalledWith('blob:shared');
    expect(revoke).toHaveBeenCalledTimes(1);
  });

  it('bounds the cache: trims closed chats, drops the least recently used windows', () => {
    const windows: Record<string, ChatMessages> = {};
    const base = {
      hasMoreBefore: false,
      hasMoreAfter: false,
      loaded: true,
      loadingLatest: false,
      loadingBefore: false,
      loadingAfter: false,
      error: null,
    };
    for (let i = 0; i < MAX_CACHED_WINDOWS + 3; i++)
      windows[`c${i}`] = { ...base, items: mergePage([], [makeMessage({ chatId: `c${i}` })]) };
    windows.big = {
      ...base,
      items: mergePage(
        [],
        Array.from({ length: TRIM_WINDOW_TO + 30 }, (_, i) =>
          makeMessage({ chatId: 'big', id: `b${i}`, seq: i + 1 }),
        ),
      ),
    };
    windows.unsent = {
      ...base,
      items: [{ ...makeMessage({ chatId: 'unsent' }), id: 'local:u', seq: 0, pending: true }],
    };
    useMessages.setState({ byChat: windows });
    useChats.setState({ openChatId: 'c0' });
    compactWindows();
    const kept = useMessages.getState().byChat;
    expect(Object.keys(kept)).toHaveLength(MAX_CACHED_WINDOWS);
    expect(kept.c0).toBeDefined(); // open
    expect(kept.unsent).toBeDefined(); // has an unsent message
    expect(kept.big!.items).toHaveLength(TRIM_WINDOW_TO);
    expect(kept.big!.items.at(-1)!.seq).toBe(TRIM_WINDOW_TO + 30);
    expect(kept.big!.hasMoreBefore).toBe(true);
  });
});
