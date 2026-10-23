/**
 * The new messages bar: "12 new messages since 3:14 PM" while the NEW line is above the view
 * (or its first unread message isn't loaded yet); a click jumps there, Mark As Read (or Escape,
 * `markConversationRead`) clears the bar and the line; a NEW line in view needs no bar.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ChatMessages } from '@/stores/messages';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { RowAppearanceContext } from '../bubbles/appearance';
import { MessageList, type UnreadSnapshot } from '../MessageList';
import { formatSinceTime } from '../time/timeFormat';
import { NewMessagesBar, newMessagesText } from './NewMessagesBar';
import { markConversationRead } from './readSignal';

const chat = makeChat({ id: 'g1', type: 'group', name: 'Book club', lastSeq: 40, lastReadSeq: 10 });

function renderList(hasMoreBefore: boolean, firstSeq: number, unread: UnreadSnapshot) {
  useChats.setState({ byId: { g1: chat } });
  useMessages.setState({
    byChat: {
      g1: {
        items: [0, 1, 2].map((i) =>
          makeMessage({
            id: `m${firstSeq + i}`,
            chatId: 'g1',
            seq: firstSeq + i,
            senderId: 'ann',
            text: `message ${firstSeq + i}`,
            createdAt: new Date(2026, 9, 23, 10, i).toISOString(),
          }),
        ),
        loaded: true,
        hasMoreBefore,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
  return render(
    <VirtuosoMockContext.Provider value={{ viewportHeight: 2000, itemHeight: 60 }}>
      <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
        <MessageList chat={chat} unread={unread} initialTarget={null} />
      </RowAppearanceContext.Provider>
    </VirtuosoMockContext.Provider>,
  );
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
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
  useMessages.setState({ byChat: {} });
});

describe('new messages bar', () => {
  it('says how many and since when', () => {
    const at = new Date();
    at.setHours(0, 5, 0, 0);
    const iso = at.toISOString();
    expect(newMessagesText(12, iso)).toBe(`12 new messages since ${formatSinceTime(iso)}`);
    expect(newMessagesText(1, null)).toBe('1 new message');
  });

  it('jumps on a click; Mark As Read is its own action', () => {
    const onJump = vi.fn();
    const onMarkRead = vi.fn();
    render(<NewMessagesBar count={3} since={null} onJump={onJump} onMarkRead={onMarkRead} />);
    fireEvent.click(screen.getByRole('button', { name: '3 new messages' }));
    expect(onJump).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Mark As Read' }));
    expect(onMarkRead).toHaveBeenCalledTimes(1);
  });

  it('shows while the first unread message isn’t loaded; a click loads around it', () => {
    const loadAround = vi.spyOn(useMessages.getState(), 'loadAround').mockResolvedValue();
    // Unread from seq 11, the window starts at 30 with older messages left.
    renderList(true, 30, { afterSeq: 10, count: 30 });
    const bar = screen.getByTestId('new-messages-bar');
    // When the first of them came is not known yet.
    fireEvent.click(screen.getByRole('button', { name: '30 new messages' }));
    expect(loadAround).toHaveBeenCalledWith('g1', 11);
    expect(bar).toBeInTheDocument();
  });

  it('Mark As Read clears the bar and the NEW line', () => {
    renderList(true, 30, { afterSeq: 10, count: 30 });
    expect(screen.getByTestId('unread-divider')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mark As Read' }));
    expect(screen.queryByTestId('new-messages-bar')).toBeNull();
    expect(screen.queryByTestId('unread-divider')).toBeNull();
    // The chat itself was read.
    expect(useChats.getState().byId.g1!.lastReadSeq).toBe(40);
  });

  it('Escape (markConversationRead) does the same', () => {
    renderList(true, 30, { afterSeq: 10, count: 30 });
    act(() => markConversationRead('g1'));
    expect(screen.queryByTestId('new-messages-bar')).toBeNull();
    expect(screen.queryByTestId('unread-divider')).toBeNull();
  });

  it('no bar when the NEW line itself is loaded and in view', () => {
    // The whole history is loaded: the line stands on the first unread message.
    renderList(false, 11, { afterSeq: 10, count: 3 });
    expect(screen.getByTestId('unread-divider')).toBeInTheDocument();
    expect(screen.queryByTestId('new-messages-bar')).toBeNull();
  });
});
