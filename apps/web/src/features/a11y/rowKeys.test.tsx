/**
 * The message list for screen readers and the keyboard: a list named for the chat, rows in list
 * items; ↑/↓ and Home/End move between rows, Enter / Tab enter the toolbar, Escape goes back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import { RowAppearanceContext } from '@/features/conversation/bubbles/appearance';
import { MessageList } from '@/features/conversation/MessageList';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { focusRow, rowActionOf } from './rowKeys';

const ann = makeUser({ id: 'ann', displayName: 'Ann' });
const chat = makeChat({ id: 'd1', type: 'direct', peer: ann, name: null });
const TEXTS = ['first', 'second', 'third', 'fourth'];

function renderList() {
  useMessages.setState({
    byChat: {
      d1: {
        items: TEXTS.map((text, i) =>
          makeMessage({
            id: `m${i + 1}`,
            chatId: 'd1',
            seq: i + 1,
            senderId: i % 2 ? 'me' : 'ann',
            text,
            createdAt: new Date(2026, 9, 23, 10, i * 10).toISOString(),
          }),
        ),
        loaded: true,
        hasMoreBefore: false,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
  return render(
    <div>
      <button type="button">Chat header</button>
      <VirtuosoMockContext.Provider value={{ viewportHeight: 2000, itemHeight: 60 }}>
        <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
          {/* Opened at the NEW line above the first message: jsdom never scrolls to the bottom. */}
          <MessageList
            chat={chat}
            unread={{ afterSeq: 0, count: TEXTS.length }}
            initialTarget={null}
          />
        </RowAppearanceContext.Provider>
      </VirtuosoMockContext.Provider>
      <textarea aria-label="Message" />
    </div>,
  );
}

const rowOf = (text: string) => screen.getByRole('article', { name: new RegExp(`, ${text}$`) });

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({
    user: makeMe({ id: 'me', displayName: 'Mia' }),
    token: 't',
    status: 'authenticated',
  });
  useUsers.getState().upsertUsers([ann]);
});

afterEach(() => {
  resetSessionState();
  useMessages.setState({ byChat: {} });
});

describe('message list semantics', () => {
  it('the scroller is a list named for the chat; each row an article in a list item', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'Messages with Ann' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(TEXTS.length);
    expect(
      within(list)
        .getAllByRole('article')
        .map((a) => a.getAttribute('aria-label')),
    ).toEqual([
      expect.stringMatching(/^Ann, .+, first$/),
      expect.stringMatching(/^Mia, .+, second$/),
      expect.stringMatching(/^Ann, .+, third$/),
      expect.stringMatching(/^Mia, .+, fourth$/),
    ]);
    // The polite announcer for new messages stays outside the list.
    expect(within(list).queryByTestId('message-announcer')).toBeNull();
    expect(screen.getByTestId('message-announcer')).toHaveAttribute('aria-live', 'polite');
  });
});

describe('keyboard', () => {
  it('↑ / ↓ move between rows, Home / End to the first / last loaded one', () => {
    renderList();
    rowOf('third').focus();
    fireEvent.keyDown(rowOf('third'), { key: 'ArrowUp' });
    expect(rowOf('second')).toHaveFocus();
    fireEvent.keyDown(rowOf('second'), { key: 'ArrowDown' });
    fireEvent.keyDown(rowOf('third'), { key: 'ArrowDown' });
    expect(rowOf('fourth')).toHaveFocus();
    // The last row stays focused at the end.
    fireEvent.keyDown(rowOf('fourth'), { key: 'ArrowDown' });
    expect(rowOf('fourth')).toHaveFocus();
    fireEvent.keyDown(rowOf('fourth'), { key: 'Home' });
    expect(rowOf('first')).toHaveFocus();
    fireEvent.keyDown(rowOf('first'), { key: 'End' });
    expect(rowOf('fourth')).toHaveFocus();
  });

  it('Enter or Tab enter the row toolbar; Escape there returns to the row, on the row to the composer', () => {
    renderList();
    const row = rowOf('second');
    row.focus();
    fireEvent.keyDown(row, { key: 'Enter' });
    const more = within(row).getByRole('button', { name: 'More' });
    expect(more).toHaveFocus();
    fireEvent.keyDown(more, { key: 'Escape' });
    expect(row).toHaveFocus();
    fireEvent.keyDown(row, { key: 'Tab' });
    expect(more).toHaveFocus();
    fireEvent.keyDown(more, { key: 'Escape' });
    fireEvent.keyDown(row, { key: 'Escape' });
    expect(screen.getByRole('textbox', { name: 'Message' })).toHaveFocus();
  });

  it('tabbing into the list lands on the last row; a click or Shift+Tab from a row leaves the focus', () => {
    renderList();
    const list = screen.getByRole('list', { name: 'Messages with Ann' });
    fireEvent.focus(list, { relatedTarget: screen.getByRole('button', { name: 'Chat header' }) });
    expect(rowOf('fourth')).toHaveFocus();

    rowOf('second').focus();
    fireEvent.focus(list, { relatedTarget: rowOf('second') });
    expect(rowOf('second')).toHaveFocus();

    screen.getByRole('button', { name: 'Chat header' }).focus();
    fireEvent.pointerDown(list);
    fireEvent.focus(list, { relatedTarget: screen.getByRole('button', { name: 'Chat header' }) });
    expect(rowOf('fourth')).not.toHaveFocus();
  });

  it('Discord’s action keys: E, R, Backspace / Delete, P, + / =, Ctrl+C (⌘C on a Mac)', () => {
    const key = (k: string, mods: { ctrl?: boolean; meta?: boolean; alt?: boolean } = {}, mac = false) =>
      rowActionOf({ key: k, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, altKey: !!mods.alt }, mac);
    expect(['e', 'E', 'r', 'Backspace', 'Delete', 'p', '+', '='].map((k) => key(k))).toEqual([
      'edit',
      'edit',
      'reply',
      'delete',
      'delete',
      'pin',
      'react',
      'react',
    ]);
    expect(key('c', { ctrl: true })).toBe('copy');
    expect(key('c', { meta: true }, true)).toBe('copy');
    expect(key('c', { meta: true })).toBeNull();
    expect(key('e', { ctrl: true })).toBeNull();
    expect(key('e', { alt: true })).toBeNull();
    expect(key('c')).toBeNull();
    expect(key('ArrowUp')).toBeNull();
  });

  it('a loaded row outside the rendered window is scrolled in, then focused', () => {
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => frames.push(cb));
    const list = document.createElement('div');
    document.body.append(list);
    const reveal = vi.fn((id: string) => {
      const row = document.createElement('div');
      row.setAttribute('role', 'article');
      row.dataset.messageId = id;
      row.tabIndex = -1;
      list.append(row);
    });
    focusRow(list, 'm9', { reveal }, 'start');
    expect(reveal).toHaveBeenCalledWith('m9', 'start');
    frames.shift()!(0);
    expect(document.activeElement).toBe(list.querySelector('[data-message-id="m9"]'));
    list.remove();
  });
});
