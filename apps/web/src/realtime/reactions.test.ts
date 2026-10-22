/**
 * Reaction deltas (`message:reaction-add/-remove`, `message:reactions-cleared`) merge into the
 * messages store; my own echo of an optimistic change is never counted twice.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, Message, ReactionEvent, ServerToClientEvents } from '@enbox/shared';
import { addReaction } from '@/features/conversation/bubbles/reactions/reactionActions';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import type { AppSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { mergePage, useMessages, EMPTY_CHAT_MESSAGES } from '@/stores/messages';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { handleMessageUpdated, registerMessageHandlers } from './messages';

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    on(event: string, fn: (payload: unknown) => void) {
      handlers.set(event, fn);
      return socket;
    },
  } as unknown as AppSocket;
  registerMessageHandlers(socket);
  return <E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ) => handlers.get(event)!(payload);
}

function seed(chat: ChatSummary, m: Message) {
  useChats.getState().upsertChat(chat);
  useMessages.setState((s) => ({
    byChat: {
      ...s.byChat,
      [chat.id]: { ...EMPTY_CHAT_MESSAGES, items: mergePage([], [m]), loaded: true },
    },
  }));
}

const cached = (chatId: string) => useMessages.getState().byChat[chatId]!.items[0]!;
const delta = (p: Partial<ReactionEvent>): ReactionEvent => ({
  chatId: 'chat-1',
  messageId: 'm1',
  emoji: '👍',
  emojiId: null,
  userId: 'bob',
  ...p,
});

beforeEach(() => {
  resetSessionState();
  vi.restoreAllMocks();
  useAuth.setState({ user: makeMe({ id: 'me' }), status: 'authenticated', token: 't' });
});

describe('reaction deltas', () => {
  it('groups: others join and leave by user id (duplicates ignored), new emoji go last', () => {
    const fire = fakeSocket();
    seed(
      makeChat({ id: 'chat-1', type: 'group' }),
      makeMessage({
        id: 'm1',
        reactions: [{ emoji: '🎉', count: 1, userIds: ['ann'] }],
        myReactions: [],
      }),
    );
    fire('message:reaction-add', delta({}));
    fire('message:reaction-add', delta({})); // a duplicate changes nothing
    fire('message:reaction-add', delta({ emoji: '🎉' }));
    expect(cached('chat-1').reactions).toEqual([
      { emoji: '🎉', count: 2, userIds: ['ann', 'bob'] },
      { emoji: '👍', count: 1, userIds: ['bob'] },
    ]);
    fire('message:reaction-remove', delta({ emoji: '🎉', userId: 'ann' }));
    fire('message:reaction-remove', delta({}));
    expect(cached('chat-1').reactions).toEqual([{ emoji: '🎉', count: 1, userIds: ['bob'] }]);
  });

  it('Space channels: counts only; my other devices update my reactions; my echo counts once', () => {
    const fire = fakeSocket();
    seed(
      makeChat({ id: 'chat-1', type: 'space_text', spacePermissions: 0x7fffffff }),
      makeMessage({
        id: 'm1',
        reactions: [{ emoji: '👍', count: 2, userIds: [] }],
        myReactions: ['👍'],
      }),
    );
    fire('message:reaction-add', delta({ userId: 'me' })); // echo of mine
    expect(cached('chat-1').reactions[0]!.count).toBe(2);
    fire('message:reaction-add', delta({ emoji: '🔥', userId: 'me' })); // another device
    expect(cached('chat-1')).toMatchObject({
      reactions: [
        { emoji: '👍', count: 2 },
        { emoji: '🔥', count: 1, userIds: [] },
      ],
      myReactions: ['👍', '🔥'],
      myReaction: '👍',
    });
    fire('message:reaction-remove', delta({ userId: 'carol' }));
    fire('message:reaction-remove', delta({ userId: 'dave' })); // would go below my own: ignored
    expect(cached('chat-1').reactions[0]!.count).toBe(1);
  });

  it('skips my echoes while my change to that emoji is in flight', async () => {
    const fire = fakeSocket();
    const chat = makeChat({ id: 'chat-1', type: 'space_text', spacePermissions: 0x7fffffff });
    seed(chat, makeMessage({ id: 'm1', reactions: [], myReactions: [] }));
    let finish!: () => void;
    const put = vi
      .spyOn(api, 'put')
      .mockReturnValue(new Promise<void>((r) => (finish = r)) as never);
    const done = addReaction(chat, cached('chat-1'), '👍');
    expect(put).toHaveBeenCalledWith(`/api/messages/m1/reactions/${encodeURIComponent('👍')}/@me`);
    expect(cached('chat-1')).toMatchObject({
      reactions: [{ emoji: '👍', count: 1 }],
      myReactions: ['👍'],
    });
    // A stale echo (say, of an earlier removal) while the add runs: skipped.
    fire('message:reaction-remove', delta({ userId: 'me' }));
    fire('message:reaction-add', delta({ userId: 'me' }));
    expect(cached('chat-1').reactions).toEqual([{ emoji: '👍', count: 1, userIds: [] }]);
    finish();
    await done;
    fire('message:reaction-add', delta({ userId: 'me' })); // late echo: already mine
    expect(cached('chat-1').reactions[0]!.count).toBe(1);
  });

  it('clears one emoji or all of them', () => {
    const fire = fakeSocket();
    seed(
      makeChat({ id: 'chat-1', type: 'group' }),
      makeMessage({
        id: 'm1',
        reactions: [
          { emoji: '👍', count: 1, userIds: ['me'] },
          { emoji: '🎉', count: 1, userIds: ['bob'] },
        ],
        myReactions: ['👍'],
      }),
    );
    fire('message:reactions-cleared', { chatId: 'chat-1', messageId: 'm1', emoji: '👍' });
    expect(cached('chat-1')).toMatchObject({
      reactions: [{ emoji: '🎉', count: 1, userIds: ['bob'] }],
      myReactions: [],
      myReaction: null,
    });
    fire('message:reactions-cleared', { chatId: 'chat-1', messageId: 'm1', emoji: null });
    expect(cached('chat-1').reactions).toEqual([]);
  });

  it('message:updated in groups derives all of my reactions from the lists', () => {
    seed(makeChat({ id: 'chat-1', type: 'group' }), makeMessage({ id: 'm1', myReactions: [] }));
    handleMessageUpdated(
      makeMessage({
        id: 'm1',
        reactions: [
          { emoji: '👍', count: 1, userIds: ['me'] },
          { emoji: '🎉', count: 2, userIds: ['bob', 'me'] },
        ],
      }),
    );
    expect(cached('chat-1')).toMatchObject({ myReactions: ['👍', '🎉'], myReaction: '👍' });
  });
});
