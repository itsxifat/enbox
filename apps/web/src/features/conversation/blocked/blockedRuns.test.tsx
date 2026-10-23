/**
 * Messages of people I blocked: each run of consecutive ones folds into "N blocked messages —
 * Show messages", which opens them in place; a day separator or the NEW line starts a new run,
 * my own messages and system rows never fold.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { VirtuosoMockContext } from 'react-virtuoso';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages, type ClientMessage } from '@/stores/messages';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';
import { RowAppearanceContext } from '../bubbles/appearance';
import { buildRows } from '../lib/rows';
import { MessageList } from '../MessageList';
import { collapseBlocked } from './blockedRuns';

const at = (day: number, m: number) => new Date(2026, 9, day, 10, m).toISOString();
const msg = (id: string, senderId: string, day = 23, m = 0, p: Partial<ClientMessage> = {}) =>
  makeMessage({ id, chatId: 'g1', seq: Number(id.slice(1)), senderId, text: `text ${id}`, createdAt: at(day, m), ...p }) as ClientMessage;

const BLOCKED = new Set(['bob']);
const rowsOf = (items: ClientMessage[]) => buildRows(items, { meId: 'me' });

describe('collapseBlocked', () => {
  it('folds each run of blocked messages into one row', () => {
    const rows = rowsOf([msg('m1', 'ann'), msg('m2', 'bob', 23, 1), msg('m3', 'bob', 23, 2), msg('m4', 'ann', 23, 3)]);
    const out = collapseBlocked(rows, BLOCKED, new Set());
    expect(out.map((r) => r.key)).toEqual(['m1', 'blocked:m2', 'm4']);
    expect(out[1]!.blocked).toEqual({ key: 'm2', count: 2, expanded: false });
  });

  it('opens a run in place under its fold', () => {
    const rows = rowsOf([msg('m1', 'bob'), msg('m2', 'bob', 23, 1), msg('m3', 'ann', 23, 2)]);
    const out = collapseBlocked(rows, BLOCKED, new Set(['m1']));
    expect(out.map((r) => r.key)).toEqual(['blocked:m1', 'm1', 'm2', 'm3']);
    // The fold shows the day separator; the first message under it doesn't repeat it.
    expect(out[0]!.showDay).toBe(true);
    expect(out[1]!.showDay).toBe(false);
  });

  it('a day separator or the NEW line starts a new run; mine and system rows never fold', () => {
    const rows = rowsOf([
      msg('m1', 'bob', 22),
      msg('m2', 'bob', 23),
      msg('m3', 'me', 23, 1),
      msg('m4', 'bob', 23, 2, { type: 'system', senderId: null }),
    ]);
    const out = collapseBlocked(rows, BLOCKED, new Set());
    expect(out.map((r) => r.key)).toEqual(['blocked:m1', 'blocked:m2', 'm3', 'm4']);
    const unreadRows = rows.slice(0, 2).map((r, i) => (i === 1 ? { ...r, unreadDivider: 1, showDay: false } : r));
    expect(collapseBlocked(unreadRows, BLOCKED, new Set()).map((r) => r.blocked?.count)).toEqual([1, 1]);
  });

  it('leaves the rows as they are when no one is blocked', () => {
    const rows = rowsOf([msg('m1', 'ann'), msg('m2', 'bob')]);
    expect(collapseBlocked(rows, new Set(), new Set())).toBe(rows);
    expect(collapseBlocked(rows, new Set(['zed']), new Set())).toBe(rows);
  });
});

describe('in the message list', () => {
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
    useUsers
      .getState()
      .upsertUsers([
        makeUser({ id: 'ann', displayName: 'Ann' }),
        makeUser({ id: 'bob', displayName: 'Bob', isBlocked: true }),
      ]);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    resetSessionState();
    useMessages.setState({ byChat: {} });
  });

  it('shows "2 blocked messages — Show messages" and opens them in place', () => {
    useMessages.setState({
      byChat: {
        g1: {
          items: [msg('m1', 'ann'), msg('m2', 'bob', 23, 1), msg('m3', 'bob', 23, 2)],
          loaded: true,
          hasMoreBefore: true,
          hasMoreAfter: false,
        } as unknown as ChatMessages,
      },
    });
    render(
      <VirtuosoMockContext.Provider value={{ viewportHeight: 2000, itemHeight: 60 }}>
        <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
          {/* Opened at the NEW line above the first message: jsdom never scrolls to the bottom. */}
          <MessageList
            chat={makeChat({ id: 'g1', type: 'group' })}
            unread={{ afterSeq: 0, count: 3 }}
            initialTarget={null}
          />
        </RowAppearanceContext.Provider>
      </VirtuosoMockContext.Provider>,
    );
    const fold = screen.getByTestId('blocked-messages');
    expect(fold).toHaveTextContent(/^2 blocked messages\s*—\s*Show messages$/);
    expect(screen.queryByText('text m2')).toBeNull();
    fireEvent.click(within(fold).getByRole('button', { name: 'Show messages' }));
    expect(screen.getByText('text m2')).toBeInTheDocument();
    expect(screen.getByText('text m3')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hide messages' }));
    expect(screen.queryByText('text m2')).toBeNull();
  });
});
