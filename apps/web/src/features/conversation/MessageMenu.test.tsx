/**
 * The message menu, Discord's structure: Add Reaction ▸, Edit Message, Reply, Forward, Thread,
 * Copy Text, Pin Message, Mark Unread, Copy Message Link, Speak Message, Delete Message, Copy
 * Message ID (Developer Mode). Space channels drop the WhatsApp extras (Star, Info, Select).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { PERM, type ChatReadState, type ChatSummary, type Message } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { MessageActionsHost } from './MessageActionsHost';
import { useUnreadMarks } from './moreActions';
import { useConversationUi } from './state';

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

const channel = (bits = MEMBER) =>
  makeChat({
    id: 'general',
    type: 'space_text',
    name: 'general',
    space,
    spacePermissions: bits,
    lastSeq: 9,
    lastReadSeq: 9,
  });
const group = () => makeChat({ id: 'general', type: 'group', lastSeq: 9, lastReadSeq: 9 });

const message = (p: Partial<Message> = {}) =>
  makeMessage({
    id: 'm1',
    chatId: 'general',
    seq: 4,
    senderId: 'olive',
    text: 'hello there',
    createdAt: new Date().toISOString(),
    ...p,
  });

function openMenu(chat: ChatSummary, m: Message, mode: 'menu' | 'sheet' = 'menu') {
  useChats.setState({ byId: { [chat.id]: chat }, loaded: true });
  useMessages.setState({
    byChat: {
      [chat.id]: {
        items: [m],
        loaded: true,
        hasMoreBefore: false,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
  render(
    <MemoryRouter>
      <MessageActionsHost chat={chat} />
    </MemoryRouter>,
  );
  act(() =>
    useConversationUi
      .getState()
      .openActions({ chatId: chat.id, messageId: m.id, anchor: { x: 20, y: 20 }, mode }),
  );
}

const menuItems = () =>
  within(screen.getByRole('menu', { name: 'Message options' }))
    .getAllByRole('menuitem')
    .map((b) => b.textContent?.trim());

const writeText = vi.fn();

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  writeText.mockResolvedValue(undefined);
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.setState({ byId: { olive: makeUser({ id: 'olive', displayName: 'Olive' }) } });
  useUi.setState({ prefs: { ...DEFAULT_PREFS }, toasts: [] });
  vi.spyOn(api, 'put').mockResolvedValue(undefined as never);
  vi.spyOn(api, 'get').mockResolvedValue([] as never);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  writeText.mockReset();
  resetSessionState();
  useChats.setState({ byId: {}, loaded: false, pins: {} });
});

describe('message menu', () => {
  it('Space channel, someone else’s message: Discord’s items, no WhatsApp extras', () => {
    openMenu(channel(), message());
    expect(menuItems()).toEqual([
      'Add Reaction',
      'Reply',
      'Forward',
      'Create Thread',
      'Copy Text',
      'Mark Unread',
      'Copy Message Link',
      'Report Message',
    ]);
  });

  it('Space channel, my own message: Edit Message and Delete Message', () => {
    openMenu(channel(), message({ senderId: 'me' }));
    expect(menuItems()).toEqual([
      'Add Reaction',
      'Edit Message',
      'Reply',
      'Forward',
      'Create Thread',
      'Copy Text',
      'Mark Unread',
      'Copy Message Link',
      'Delete Message',
    ]);
  });

  it('moderators pin and delete anyone’s message; pinned ones say Unpin', () => {
    useChats.setState({ pins: { general: ['m1'] } });
    openMenu(channel(MOD), message());
    expect(menuItems()).toEqual([
      'Add Reaction',
      'Reply',
      'Forward',
      'Create Thread',
      'Copy Text',
      'Unpin Message',
      'Mark Unread',
      'Copy Message Link',
      'Report Message',
      'Delete Message',
    ]);
  });

  it('groups keep their WhatsApp extras (star, select, reply privately)', () => {
    openMenu(group(), message());
    const items = menuItems();
    expect(items).toEqual(
      expect.arrayContaining([
        'Reply privately',
        'Message Olive',
        'Star',
        'Select',
        'Delete Message',
      ]),
    );
    expect(items.indexOf('Reply')).toBeLessThan(items.indexOf('Forward'));
    expect(items).not.toContain('Create Thread');
    expect(items.at(-1)).toBe('Delete Message');
  });

  it('Developer Mode adds Copy Message ID, which copies the id', async () => {
    useUi.getState().setPref('developerMode', true);
    openMenu(channel(), message());
    expect(menuItems().at(-1)).toBe('Copy Message ID');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Message ID' }));
    expect(writeText).toHaveBeenCalledWith('m1');
    await vi.waitFor(() =>
      expect(useUi.getState().toasts.at(-1)?.message).toBe('Message ID copied'),
    );
  });

  it('Speak Message reads it aloud where the browser can', () => {
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak, cancel: vi.fn() });
    vi.stubGlobal(
      'SpeechSynthesisUtterance',
      class {
        constructor(public text: string) {}
      },
    );
    openMenu(channel(), message());
    expect(menuItems()).toContain('Speak Message');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Speak Message' }));
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Olive said hello there' }));
  });

  it('Add Reaction opens quick picks and View More (the full picker)', async () => {
    localStorage.setItem('enbox:recent-reactions', JSON.stringify(['🔥', '🎉']));
    openMenu(channel(), message());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Reaction' }));
    const sub = screen.getByRole('menu', { name: 'Add Reaction' });
    expect(
      within(sub)
        .getAllByRole('menuitem')
        .map((b) => b.textContent),
    ).toEqual(['🔥🔥', '🎉🎉', '👍👍', '❤️❤️', 'View More']);
    fireEvent.click(within(sub).getAllByRole('menuitem')[0]!);
    await vi.waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        `/api/messages/m1/reactions/${encodeURIComponent('🔥')}/@me`,
      ),
    );
    act(() =>
      useConversationUi
        .getState()
        .openActions({
          chatId: 'general',
          messageId: 'm1',
          anchor: { x: 20, y: 20 },
          mode: 'menu',
        }),
    );
    fireEvent.click(screen.getByRole('menuitem', { name: 'Add Reaction' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'View More' }));
    expect(screen.getByRole('dialog', { name: 'Choose a reaction' })).toBeInTheDocument();
  });

  it('Mark Unread posts the message and shows the chat unread from it', async () => {
    const state: ChatReadState = {
      chatId: 'general',
      lastReadSeq: 3,
      unreadCount: 6,
      unreadMentionCount: 0,
      markedUnread: true,
    };
    const post = vi.spyOn(api, 'post').mockResolvedValue(state as never);
    openMenu(channel(), message());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mark Unread' }));
    await vi.waitFor(() =>
      expect(post).toHaveBeenCalledWith('/api/chats/general/unread', { messageId: 'm1' }),
    );
    await vi.waitFor(() =>
      expect(useChats.getState().byId.general).toMatchObject({
        lastReadSeq: 3,
        unreadCount: 6,
        markedUnread: true,
      }),
    );
    expect(useUnreadMarks.getState().marks.general).toEqual({ afterSeq: 3, count: 6 });
  });

  it('Copy Message Link copies the message’s link', async () => {
    openMenu(channel(), message());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Copy Message Link' }));
    expect(writeText).toHaveBeenCalledWith(`${location.origin}/spaces/s1/general?m=4&mid=m1`);
    await vi.waitFor(() => expect(useUi.getState().toasts.at(-1)?.message).toBe('Link copied'));
  });

  it('the long-press sheet has the same items minus Add Reaction (its strip does that)', () => {
    openMenu(channel(), message(), 'sheet');
    const sheet = screen.getByRole('dialog', { name: 'Message options' });
    const items = within(sheet)
      .getAllByRole('menuitem')
      .map((b) => b.textContent?.trim());
    expect(items).not.toContain('Add Reaction');
    expect(items).toContain('Mark Unread');
    expect(within(sheet).getByRole('group', { name: 'Quick reactions' })).toBeInTheDocument();
  });
});
