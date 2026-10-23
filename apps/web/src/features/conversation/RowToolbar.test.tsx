/**
 * The hover toolbar (Discord's): three recent quick reactions, Add Reaction, Reply, Edit (mine),
 * Create Thread (Space text channels) and More; Shift reveals Pin, Copy Message Link, Mark
 * Unread, Copy Message ID (Developer Mode) and an immediate Delete.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { PERM, type ChatSummary, type Message } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { RowAppearanceContext } from './bubbles/appearance';
import { CozyMessageRow } from './CozyMessageRow';
import type { Row } from './lib/rows';
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
  makeChat({ id: 'general', type: 'space_text', name: 'general', space, spacePermissions: bits });

const message = (p: Partial<Message> = {}) =>
  makeMessage({
    id: 'm1',
    chatId: 'general',
    seq: 4,
    senderId: 'other',
    text: 'hello there',
    createdAt: new Date().toISOString(),
    ...p,
  });

function renderRow(chat: ChatSummary, m: Message) {
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
  const row: Row = {
    key: m.id,
    message: m,
    mine: m.senderId === 'me',
    showDay: false,
    unreadDivider: 0,
    firstInGroup: true,
    lastInGroup: true,
  };
  return render(
    <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'fade' }}>
      <CozyMessageRow row={row} chat={chat} onJump={() => undefined} onJumpById={() => undefined} />
    </RowAppearanceContext.Provider>,
  );
}

const toolbar = () => screen.getByTestId('message-toolbar');
const labels = () =>
  within(toolbar())
    .getAllByRole('button')
    .map((b) => b.getAttribute('aria-label'));
const hoverWithShift = () => {
  fireEvent.pointerEnter(toolbar().parentElement!);
  fireEvent.keyDown(window, { key: 'Shift', shiftKey: true });
};

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
  useUi.setState({ prefs: { ...DEFAULT_PREFS } });
  vi.spyOn(api, 'put').mockResolvedValue(undefined as never);
  vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
  vi.spyOn(api, 'post').mockResolvedValue([] as never);
});

afterEach(() => {
  fireEvent.keyUp(window, { key: 'Shift', shiftKey: false });
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
});

describe('message hover toolbar', () => {
  it('shows my three recent reactions, Add Reaction, Reply, Create Thread and More', () => {
    localStorage.setItem('enbox:recent-reactions', JSON.stringify(['🔥', '🎉', '👀', '🤖']));
    renderRow(channel(), message());
    expect(labels()).toEqual([
      'React 🔥',
      'React 🎉',
      'React 👀',
      'Add Reaction',
      'Reply',
      'Create Thread',
      'More',
    ]);
  });

  it('falls back to the default quick reactions and adds Edit on my own messages', () => {
    renderRow(channel(), message({ senderId: 'me' }));
    expect(labels()).toEqual([
      'React 👍',
      'React ❤️',
      'React 😂',
      'Add Reaction',
      'Reply',
      'Edit',
      'Create Thread',
      'More',
    ]);
  });

  it('runs its actions: quick reaction, reply, edit, more', async () => {
    renderRow(channel(), message({ senderId: 'me' }));
    fireEvent.click(screen.getByRole('button', { name: 'React 👍' }));
    await vi.waitFor(() =>
      expect(api.put).toHaveBeenCalledWith(
        `/api/messages/m1/reactions/${encodeURIComponent('👍')}/@me`,
      ),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Reply' }));
    expect(useConversationUi.getState().reply.general?.id).toBe('m1');
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(useConversationUi.getState().editing.general?.id).toBe('m1');
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    expect(useConversationUi.getState().action).toMatchObject({
      chatId: 'general',
      messageId: 'm1',
      mode: 'menu',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add Reaction' }));
    expect(screen.getByRole('dialog', { name: 'Choose a reaction' })).toBeInTheDocument();
  });

  it('is one tab stop (More); arrow keys move along it', () => {
    renderRow(channel(), message());
    const buttons = within(toolbar()).getAllByRole('button');
    expect(
      buttons.filter((b) => b.tabIndex === 0).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['More']);
    const more = screen.getByRole('button', { name: 'More' });
    more.focus();
    fireEvent.keyDown(more, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Create Thread' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    expect(document.activeElement).toBe(buttons[0]);
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(more);
  });

  it('no Create Thread outside Space text channels', () => {
    const group = makeChat({ id: 'general', type: 'group' });
    renderRow(group, message());
    expect(labels()).not.toContain('Create Thread');
    expect(labels()).toContain('Reply');
  });

  it('Shift reveals Pin, Copy Message Link, Mark Unread and Delete; Copy Message ID in Developer Mode', () => {
    renderRow(channel(MOD), message());
    expect(labels()).not.toContain('Delete Message');
    hoverWithShift();
    expect(labels().slice(0, 4)).toEqual([
      'Pin Message',
      'Copy Message Link',
      'Mark Unread',
      'Delete Message',
    ]);
    expect(labels()).not.toContain('Copy Message ID');
    act(() => useUi.getState().setPref('developerMode', true));
    expect(labels().slice(0, 5)).toEqual([
      'Pin Message',
      'Copy Message Link',
      'Mark Unread',
      'Copy Message ID',
      'Delete Message',
    ]);
    fireEvent.keyUp(window, { key: 'Shift', shiftKey: false });
    expect(labels()).not.toContain('Pin Message');
  });

  it('Shift + Delete deletes at once, for everyone, with no question', async () => {
    renderRow(channel(MOD), message());
    hoverWithShift();
    fireEvent.click(screen.getByRole('button', { name: 'Delete Message' }));
    await vi.waitFor(() =>
      expect(api.delete).toHaveBeenCalledWith('/api/messages/m1', undefined, {
        query: { for: 'everyone' },
      }),
    );
    expect(useUi.getState().dialogs).toHaveLength(0);
    expect(useMessages.getState().byChat.general!.items[0]!.deletedAt).toBeTruthy();
  });

  it('respects permissions: no Pin or Delete on someone else’s message without Manage Messages', () => {
    renderRow(channel(MEMBER), message());
    hoverWithShift();
    const shown = labels();
    expect(shown).toContain('Copy Message Link');
    expect(shown).toContain('Mark Unread');
    expect(shown).not.toContain('Pin Message');
    expect(shown).not.toContain('Delete Message');
  });
});
