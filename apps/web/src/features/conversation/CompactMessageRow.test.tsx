/**
 * The Compact message display: the time, name and text of a message on one line, the later
 * messages of a group without a name (their time on hover), optional small avatars, and the
 * cozy row's pieces (system pills, replies, attachments, reactions, toolbar, selection).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { Message } from '@enbox/shared';
import { formatTime } from '@/lib/format';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { DEFAULT_PREFS, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { RowAppearanceContext } from './bubbles/appearance';
import { CompactMessageRow } from './CompactMessageRow';
import type { Row } from './lib/rows';
import { useConversationUi } from './state';

const me = makeMe({ displayName: 'Mia Me' });
const chat = makeChat({ id: 'chat-a', type: 'group' });
const AT = '2025-03-12T15:14:00.000Z';

function row(m: Partial<Message> = {}, r: Partial<Row> = {}): Row {
  const message = makeMessage({
    id: 'm1',
    chatId: chat.id,
    senderId: me.id,
    text: 'hi there',
    createdAt: AT,
    ...m,
  });
  return {
    key: message.id,
    message,
    mine: message.senderId === me.id,
    showDay: false,
    unreadDivider: 0,
    firstInGroup: true,
    lastInGroup: true,
    ...r,
  };
}

function renderRow(r: Row = row()) {
  return render(
    <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
      <CompactMessageRow
        row={r}
        chat={chat}
        onJump={() => undefined}
        onJumpById={() => undefined}
      />
    </RowAppearanceContext.Provider>,
  );
}

const line = () => screen.getByTestId('compact-line');
/** The row's own time (the bubble's hidden inline meta repeats it). */
const lineTime = () => line().querySelector<HTMLElement>(':scope > time')!;
const follows = (a: Node, b: Node) =>
  !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

beforeEach(() => {
  useAuth.setState({ user: me });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, messageDisplay: 'compact' } });
});
afterEach(() => {
  resetSessionState();
  useConversationUi.getState().clearSelect(chat.id);
  useConversationUi.getState().openActions(null);
  useUi.setState({ prefs: { ...DEFAULT_PREFS } });
});

describe('CompactMessageRow', () => {
  it('puts the time, the name and the text on one line', () => {
    renderRow();
    expect(screen.getByTestId('message')).toHaveAttribute('data-compact');
    // The time in the gutter, the name floated into the text's first line, then the text.
    const time = lineTime();
    expect(time).toHaveTextContent(formatTime(AT));
    expect(time).not.toHaveAttribute('aria-hidden');
    const author = within(line()).getByTestId('compact-author');
    expect(author.className).toContain('float-left');
    expect(within(author).getByRole('button', { name: 'Profile of Mia Me' })).toBeInTheDocument();
    const text = within(line()).getByText('hi there');
    expect(follows(time, author)).toBe(true);
    expect(follows(author, text)).toBe(true);
  });

  it('starts the later messages of a group under the name, their time on hover', () => {
    renderRow(row({ id: 'm2', text: 'and another' }, { firstInGroup: false }));
    expect(screen.queryByTestId('compact-author')).not.toBeInTheDocument();
    const time = lineTime();
    expect(time).toHaveTextContent(formatTime(AT));
    expect(time).toHaveAttribute('aria-hidden', 'true');
    expect(time.className).toContain('opacity-0');
    expect(time.className).toContain('group-hover/msg:opacity-100');
    expect(within(line()).getByText('and another')).toBeInTheDocument();
  });

  it('shows small avatars unless they are turned off', () => {
    renderRow();
    // The avatar and the name both open the profile.
    expect(screen.getAllByRole('button', { name: /^Profile of/ })).toHaveLength(2);
  });

  it('without avatars, only the name', () => {
    useUi.getState().setPref('compactShowAvatars', false);
    renderRow();
    expect(screen.getAllByRole('button', { name: /^Profile of/ })).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Profile of Mia Me' })).toBeInTheDocument();
  });

  it('starts attachments and cards under the name instead of after it', () => {
    renderRow(
      row({
        type: 'location',
        text: null,
        location: { latitude: 52.37, longitude: 4.89, name: 'Cafe Noord', address: null },
      }),
    );
    expect(screen.getByTestId('compact-author').className).not.toContain('float-left');
    expect(screen.getByText(/Cafe Noord/)).toBeInTheDocument();
  });

  it('keeps reply quotes above the line and reactions under it', () => {
    renderRow(
      row({
        replyTo: {
          id: 'q1',
          chatId: chat.id,
          seq: 1,
          senderId: me.id,
          type: 'text',
          text: 'the quoted text',
          media: null,
          deleted: false,
        },
        reactions: [{ emoji: '🔥', count: 2, userIds: [] }],
      }),
    );
    const quote = screen.getByText('the quoted text');
    expect(line().contains(quote)).toBe(false);
    expect(follows(quote, line())).toBe(true);
    expect(screen.getAllByText('🔥').length).toBeGreaterThan(0);
  });

  it('renders system messages as pills', () => {
    renderRow(
      row({
        id: 'sys',
        type: 'system',
        senderId: null,
        text: null,
        system: { kind: 'group_created', actorId: me.id, name: 'Weekend' },
      }),
    );
    expect(screen.getByTestId('message')).toHaveAttribute('data-type', 'system');
    expect(screen.queryByTestId('compact-line')).not.toBeInTheDocument();
  });

  it('has the toolbar and menu of the cozy row', () => {
    renderRow();
    expect(screen.getByTestId('message-toolbar')).toBeInTheDocument();
    fireEvent.contextMenu(screen.getByTestId('bubble'));
    expect(useConversationUi.getState().action).toMatchObject({ messageId: 'm1', mode: 'menu' });
  });

  it('selects with a click in select mode', () => {
    useConversationUi.getState().startSelect(chat.id);
    renderRow();
    expect(screen.queryByTestId('message-toolbar')).not.toBeInTheDocument();
    const box = screen.getByRole('checkbox', { name: 'Select message' });
    expect(box).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByText('hi there'));
    expect(useConversationUi.getState().selecting[chat.id]).toEqual(['m1']);
    expect(screen.getByRole('checkbox', { name: 'Select message' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });
});
