/**
 * Discord's keys on a focused message, with the message menu's rules: E edits mine, R replies,
 * Backspace / Delete asks to delete, P pins, + opens Add Reaction, Ctrl+C copies the text; a
 * key that can't apply does nothing (and isn't consumed), nor anything in select mode.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { RowAppearanceContext } from '../bubbles/appearance';
import { MessageList } from '../MessageList';
import { useConversationUi } from '../state';

const ann = makeUser({ id: 'ann', displayName: 'Ann' });
const chat = makeChat({ id: 'g1', type: 'group', name: 'Book club' });

function renderList() {
  useMessages.setState({
    byChat: {
      g1: {
        items: [
          makeMessage({ id: 'm1', chatId: 'g1', seq: 1, senderId: 'ann', text: 'theirs', createdAt: new Date(Date.now() - 60_000).toISOString() }),
          makeMessage({ id: 'm2', chatId: 'g1', seq: 2, senderId: 'me', text: 'mine', createdAt: new Date().toISOString() }),
        ],
        loaded: true,
        hasMoreBefore: true,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
  return render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 2000, itemHeight: 60 }}>
      <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
        {/* Opened at the NEW line above the first message: jsdom never scrolls to the bottom. */}
        <MessageList chat={chat} unread={{ afterSeq: 0, count: 2 }} initialTarget={null} />
      </RowAppearanceContext.Provider>
    </VirtuosoMockContext.Provider>,
  );
}

const rowOf = (text: string) => {
  const row = screen.getByRole('article', { name: new RegExp(`, ${text}$`) });
  row.focus();
  return row;
};
/** Press a key on a row; true when it was consumed. */
const press = (row: HTMLElement, key: string, init: KeyboardEventInit = {}) =>
  !fireEvent.keyDown(row, { key, ...init });

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me', displayName: 'Mia' }), token: 't', status: 'authenticated' });
  useUsers.getState().upsertUsers([ann]);
  useUi.setState({ prefs: { ...DEFAULT_PREFS }, dialogs: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
  useMessages.setState({ byChat: {} });
  useUi.setState({ dialogs: [] });
});

describe('keys on a focused message', () => {
  it('E edits my own message only; R replies', () => {
    renderList();
    expect(press(rowOf('theirs'), 'e')).toBe(false);
    expect(useConversationUi.getState().editing.g1).toBeUndefined();
    expect(press(rowOf('mine'), 'e')).toBe(true);
    expect(useConversationUi.getState().editing.g1?.id).toBe('m2');
    expect(press(rowOf('theirs'), 'r')).toBe(true);
    expect(useConversationUi.getState().reply.g1?.id).toBe('m1');
  });

  it('Backspace and Delete ask before deleting', () => {
    renderList();
    expect(press(rowOf('mine'), 'Backspace')).toBe(true);
    expect(useUi.getState().dialogs).toHaveLength(1);
    expect(useUi.getState().dialogs[0]!.title).toBe('Delete message?');
  });

  it('P pins with the rights', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue([] as never);
    renderList();
    await act(async () => {
      press(rowOf('theirs'), 'p');
    });
    expect(post).toHaveBeenCalledWith('/api/chats/g1/pins', { messageId: 'm1' });
  });

  it('+ opens Add Reaction', () => {
    renderList();
    expect(press(rowOf('theirs'), '+', { shiftKey: true })).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Choose a reaction' })).toBeInTheDocument();
  });

  it('Ctrl+C copies the text, unless text is selected', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderList();
    await act(async () => {
      press(rowOf('theirs'), 'c', { ctrlKey: true });
    });
    expect(writeText).toHaveBeenCalledWith('theirs');
    vi.spyOn(window, 'getSelection').mockReturnValue({
      isCollapsed: false,
      toString: () => 'the',
    } as Selection);
    expect(press(rowOf('mine'), 'c', { ctrlKey: true })).toBe(false);
    expect(writeText).toHaveBeenCalledTimes(1);
  });

  it('nothing in select mode', () => {
    renderList();
    act(() => useConversationUi.getState().startSelect('g1'));
    expect(press(rowOf('mine'), 'e')).toBe(false);
    expect(press(rowOf('mine'), 'r')).toBe(false);
    expect(useConversationUi.getState().editing.g1).toBeUndefined();
    expect(useConversationUi.getState().reply.g1).toBeUndefined();
  });
});
