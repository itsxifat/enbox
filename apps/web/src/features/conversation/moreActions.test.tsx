/**
 * Mark Unread on the web: the NEW line follows a mark made here or on another device (a
 * summary that comes back with an earlier read position and `markedUnread`), the conversation
 * hands it to the message list; Discord's Delete Message (one question, none with Shift);
 * message links.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type ChatSummary, type Message } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChat, useChats } from '@/stores/chats';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { Conversation } from './ConversationPane';
import { deleteMessage, messageUrl, useUnreadMarkSync, useUnreadMarks } from './moreActions';

vi.mock('./MessageList', () => ({
  MessageList: ({ unread }: { unread: { afterSeq: number; count: number } | null }) => (
    <div
      data-testid="message-list"
      data-unread={unread ? `${unread.afterSeq}:${unread.count}` : ''}
    />
  ),
}));
vi.mock('./composer/Composer', () => ({ Composer: () => <div data-testid="composer" /> }));

const MEMBER = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES | PERM.ADD_REACTIONS;
const MOD = MEMBER | PERM.MANAGE_MESSAGES;

const space: NonNullable<ChatSummary['space']> = {
  spaceId: 's1',
  categoryId: null,
  position: 0,
  topic: null,
  slowmodeSeconds: 0,
  nsfw: false,
  userLimit: null,
  bitrate: null,
  permissionsSynced: true,
  overwrites: [],
};
const channel = (bits = MEMBER, p: Partial<ChatSummary> = {}) =>
  makeChat({
    id: 'general',
    type: 'space_text',
    name: 'general',
    space,
    spacePermissions: bits,
    lastSeq: 10,
    lastReadSeq: 10,
    ...p,
  });

const message = (p: Partial<Message> = {}) =>
  makeMessage({
    id: 'm4',
    chatId: 'general',
    seq: 4,
    senderId: 'olive',
    text: 'hello',
    createdAt: new Date().toISOString(),
    ...p,
  });

function seed(chat: ChatSummary, items: Message[] = []) {
  useChats.setState({ byId: { [chat.id]: chat }, loaded: true });
  useMessages.setState({
    byChat: {
      [chat.id]: {
        items,
        loaded: true,
        hasMoreBefore: false,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
}

function Probe({ chatId }: { chatId: string }) {
  const chat = useChat(chatId)!;
  useUnreadMarkSync(chat);
  return null;
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS }, dialogs: [] });
});

afterEach(() => {
  cleanup(); // unmount before the stores are emptied
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
  useChats.setState({ byId: {}, loaded: false, pins: {} });
  useMessages.setState({ byChat: {} });
});

describe('Mark Unread: the NEW line', () => {
  it('follows a mark made on another device (earlier read position + markedUnread)', () => {
    seed(channel());
    render(<Probe chatId="general" />);
    act(() =>
      useChats
        .getState()
        .patchChat('general', { lastReadSeq: 3, unreadCount: 6, markedUnread: true }),
    );
    expect(useUnreadMarks.getState().marks.general).toEqual({ afterSeq: 3, count: 6 });
  });

  it('ignores reads and stale summaries (an earlier position without markedUnread)', () => {
    seed(channel());
    render(<Probe chatId="general" />);
    act(() => useChats.getState().patchChat('general', { lastReadSeq: 7, unreadCount: 3 }));
    act(() => useChats.getState().patchChat('general', { lastReadSeq: 10, unreadCount: 0 }));
    expect(useUnreadMarks.getState().marks.general).toBeUndefined();
  });

  it('the conversation hands the mark to the message list (and takes it)', () => {
    const chat = channel();
    seed(chat);
    render(
      <MemoryRouter>
        <Conversation chat={chat} initialTarget={null} header={<div />} />
      </MemoryRouter>,
    );
    expect(screen.getByTestId('message-list')).toHaveAttribute('data-unread', '');
    act(() => useUnreadMarks.getState().set('general', { afterSeq: 3, count: 6 }));
    expect(screen.getByTestId('message-list')).toHaveAttribute('data-unread', '3:6');
    expect(useUnreadMarks.getState().marks.general).toBeUndefined();
  });
});

describe('Delete Message', () => {
  it('Space channels: one question, then deleted for everyone', async () => {
    const chat = channel(MOD);
    const m = message();
    seed(chat, [m]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    const done = deleteMessage(chat, m);
    await vi.waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    const dialog = useUi.getState().dialogs[0]!;
    expect(dialog.title).toBe('Delete Message');
    expect(dialog.options).toBeUndefined(); // no "for me"
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    expect(await done).toBe(true);
    expect(del).toHaveBeenCalledWith('/api/messages/m4', undefined, { query: { for: 'everyone' } });
  });

  it('cancelling keeps the message; Space members can’t delete others’ messages', async () => {
    const m = message();
    seed(channel(MOD), [m]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    const done = deleteMessage(channel(MOD), m);
    await vi.waitFor(() => expect(useUi.getState().dialogs).toHaveLength(1));
    act(() => useUi.getState().closeDialog(useUi.getState().dialogs[0]!.id, null));
    expect(await done).toBe(false);
    expect(await deleteMessage(channel(MEMBER), m, { immediate: true })).toBe(false);
    expect(del).not.toHaveBeenCalled();
  });

  it('other chats with Shift: for everyone when allowed, else for me', async () => {
    const g = makeChat({ id: 'g1', type: 'group' });
    const theirs = message({ id: 't1', chatId: 'g1' });
    const mine = message({ id: 'o1', chatId: 'g1', senderId: 'me' });
    seed(g, [theirs, mine]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    expect(await deleteMessage(g, theirs, { immediate: true })).toBe(true);
    expect(del).toHaveBeenLastCalledWith('/api/messages/t1', undefined, { query: { for: 'me' } });
    expect(useMessages.getState().byChat.g1!.items.map((x) => x.id)).toEqual(['o1']);
    expect(await deleteMessage(g, mine, { immediate: true })).toBe(true);
    expect(del).toHaveBeenLastCalledWith('/api/messages/o1', undefined, {
      query: { for: 'everyone' },
    });
    expect(useUi.getState().dialogs).toHaveLength(0);
  });
});

describe('message links', () => {
  it('point at the message in its chat', () => {
    expect(messageUrl(channel(), { id: 'm4', seq: 4 })).toBe(
      `${location.origin}/spaces/s1/general?m=4&mid=m4`,
    );
    expect(messageUrl(makeChat({ id: 'dm', type: 'direct' }), { id: 'x', seq: 7 })).toBe(
      `${location.origin}/chats/dm?m=7&mid=x`,
    );
  });
});
