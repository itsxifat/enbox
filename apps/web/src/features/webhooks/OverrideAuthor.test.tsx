/**
 * Rows of messages no user sent (`authorOverride`): the webhook's name and avatar with an APP
 * tag, a crosspost's SERVER tag and "#channel • Space" line, the card the name opens (no
 * profile), the embeds under the text, and the grouping rules (a webhook never groups with a
 * user, and with its neighbours only under the same webhook and name).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { Message, MessageAuthorOverride } from '@enbox/shared';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { RowAppearanceContext } from '@/features/conversation/bubbles/appearance';
import { CozyMessageRow } from '@/features/conversation/CozyMessageRow';
import { buildRows, type Row } from '@/features/conversation/lib/rows';

const me = makeMe({ id: 'me', displayName: 'Mia' });
const chat = makeChat({ id: 'chan-1', type: 'space_text' });

const hookAuthor: MessageAuthorOverride = {
  kind: 'webhook',
  name: 'Deploy Bot',
  avatarUrl: '/uploads/deploy.png',
  webhookId: 'wh-1',
};
const crosspost: MessageAuthorOverride = {
  kind: 'crosspost',
  name: 'Beta #announcements',
  avatarUrl: null,
  webhookId: 'wh-f',
  source: {
    spaceId: 'sp-b',
    spaceName: 'Beta',
    channelId: 'ch-news',
    channelName: 'announcements',
    messageId: 'orig-1',
  },
};

function msg(p: Partial<ClientMessage>): ClientMessage {
  return makeMessage({ chatId: chat.id, ...p }) as ClientMessage;
}

function row(message: ClientMessage, p: Partial<Row> = {}): Row {
  return {
    key: message.id,
    message,
    mine: false,
    showDay: false,
    unreadDivider: 0,
    firstInGroup: true,
    lastInGroup: true,
    ...p,
  };
}

function renderRow(r: Row) {
  return render(
    <RowAppearanceContext.Provider value={{ bubbleStyle: 'cozy', messageAnimation: 'none' }}>
      <CozyMessageRow row={r} chat={chat} onJump={() => undefined} onJumpById={() => undefined} />
    </RowAppearanceContext.Provider>,
  );
}

beforeEach(() => {
  vi.restoreAllMocks();
  // The card is a Popover, which measures itself.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({ user: me, token: 't', status: 'authenticated' });
});
afterEach(() => vi.restoreAllMocks());

describe('override authors in rows', () => {
  it('a webhook message: its name, avatar and APP tag, its embeds, and no profile actions', () => {
    renderRow(
      row(
        msg({
          id: 'w1',
          senderId: null,
          text: 'Build passed',
          authorOverride: hookAuthor,
          embeds: [{ title: 'Build #42', color: 0x57f287 }],
        }),
      ),
    );
    const author = screen.getByTestId('override-author');
    expect(within(author).getByRole('button', { name: 'Deploy Bot' })).toBeInTheDocument();
    expect(within(author).getByTestId('author-tag')).toHaveTextContent('APP');
    expect(screen.getByRole('button', { name: 'About Deploy Bot' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Profile of/ })).toBeNull();
    expect(screen.getByText('Build passed')).toBeInTheDocument();
    expect(screen.getByTestId('rich-embed')).toHaveTextContent('Build #42');
  });

  it('the name opens a card: the name and what it is', () => {
    renderRow(row(msg({ id: 'w2', senderId: null, authorOverride: hookAuthor })));
    fireEvent.click(screen.getByRole('button', { name: 'Deploy Bot' }));
    const card = screen.getByTestId('author-card');
    expect(card).toHaveTextContent('Deploy Bot');
    expect(card).toHaveTextContent('Webhook');
    expect(within(card).queryByRole('button', { name: 'Go to original' })).toBeNull();
  });

  it('an embed-only message renders just its embeds', () => {
    renderRow(
      row(
        msg({
          id: 'w3',
          senderId: null,
          text: null,
          authorOverride: hookAuthor,
          embeds: [{ title: 'Only' }],
        }),
      ),
    );
    expect(screen.getByTestId('rich-embed')).toHaveTextContent('Only');
  });

  it('a crosspost: SERVER tag, the "#channel • Space" line and Go to original', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue({ seq: 17 } as Message);
    const go = vi.fn();
    const off = bus.on('navigate', go);
    renderRow(row(msg({ id: 'x1', senderId: null, text: 'News!', authorOverride: crosspost })));
    expect(screen.getByTestId('author-tag')).toHaveTextContent('SERVER');
    const source = screen.getByRole('button', { name: 'Go to original in #announcements • Beta' });
    expect(source).toHaveTextContent('#announcements • Beta');

    fireEvent.click(screen.getByRole('button', { name: 'Beta #announcements' }));
    const card = screen.getByTestId('author-card');
    expect(card).toHaveTextContent('Followed channel');
    await act(async () => {
      fireEvent.click(within(card).getByRole('button', { name: 'Go to original' }));
    });
    await waitFor(() =>
      expect(go).toHaveBeenCalledWith({ to: '/spaces/sp-b/ch-news?m=17&mid=orig-1' }),
    );
    expect(get).toHaveBeenCalledWith('/api/messages/orig-1');

    // An original I can't see: the channel opens without a jump.
    get.mockRejectedValueOnce(new Error('not found'));
    await act(async () => {
      fireEvent.click(source);
    });
    await waitFor(() => expect(go).toHaveBeenLastCalledWith({ to: '/spaces/sp-b/ch-news' }));
    off();
  });

  it('later messages of the group carry no header', () => {
    renderRow(
      row(msg({ id: 'w4', senderId: null, authorOverride: hookAuthor }), { firstInGroup: false }),
    );
    expect(screen.queryByTestId('override-author')).toBeNull();
  });
});

describe('grouping', () => {
  const at = (min: number) => new Date(2026, 9, 23, 9, min).toISOString();
  const hook = (id: string, min: number, o: Partial<MessageAuthorOverride> = {}) =>
    msg({
      id,
      seq: min,
      senderId: null,
      createdAt: at(min),
      authorOverride: { ...hookAuthor, ...o },
    });

  it('a webhook groups with its own messages under the same name only, never with users', () => {
    const items = [
      hook('a', 1),
      hook('b', 2),
      hook('c', 3, { name: 'Other name' }),
      hook('d', 4, { name: 'Other name', webhookId: 'wh-2' }),
      msg({ id: 'e', seq: 5, senderId: 'bob', createdAt: at(5) }),
      hook('f', 6),
      msg({ id: 'g', seq: 7, senderId: null, createdAt: at(7) }),
      hook('h', 8, { kind: 'crosspost', webhookId: 'wh-1' }),
    ];
    expect(buildRows(items, { meId: 'me' }).map((r) => r.firstInGroup)).toEqual([
      true,
      false,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });
});
