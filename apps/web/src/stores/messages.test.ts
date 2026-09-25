import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message, MessagePage } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { useAuth } from './auth';
import { useChats } from './chats';
import { mergePage, upsertInto, useMessages, type ClientMessage } from './messages';

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

    useMessages.getState().clearChat(CHAT, 3);
    expect(seqs(items())).toEqual([4, 'p:ca']);
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
      messages: [makeMessage({ id: 'm5', seq: 5 }), makeMessage({ id: 'm4', seq: 4 })],
      hasMore: true,
    };
    vi.spyOn(api, 'get').mockResolvedValue(page);
    await useMessages.getState().loadLatest(CHAT);
    const s = useMessages.getState().byChat[CHAT]!;
    expect(seqs(s.items)).toEqual([4, 5, 'p:cp']);
    expect(s.hasMoreBefore).toBe(true);
    expect(s.hasMoreAfter).toBe(false);
  });

  it('ignores realtime messages for chats that were never opened', () => {
    useMessages.getState().upsertMessage(makeMessage({ chatId: 'other', id: 'z', seq: 1 }));
    expect(useMessages.getState().byChat.other).toBeUndefined();
  });
});
