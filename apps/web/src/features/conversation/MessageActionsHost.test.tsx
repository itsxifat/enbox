import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { EMPTY_CHAT_MESSAGES, mergePage, useMessages } from '@/stores/messages';
import { makeChat, makeMe, makeMessage } from '@/test/factories';

const put = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: {
    put: (...a: unknown[]) => put(...a),
    delete: async () => undefined,
    get: async () => [],
    post: async () => undefined,
  },
}));

const { MessageActionsHost, QuickReactions } = await import('./MessageActionsHost');

const chat = makeChat({ id: 'chat-1', type: 'group' });
const m = makeMessage({ id: 'm1', chatId: chat.id, reactions: [], myReactions: [] });

describe('reactions in the message actions', () => {
  beforeEach(() => {
    useAuth.setState({ user: makeMe(), status: 'authenticated', token: 't' });
    put.mockResolvedValue(undefined);
  });
  afterEach(() => {
    put.mockReset();
    resetSessionState();
  });

  it('the quick reactions are my three most recent emoji, then the full picker', () => {
    localStorage.setItem('enbox:recent-reactions', JSON.stringify(['🔥', '🎉', '👀', '🤖']));
    render(<QuickReactions chat={chat} m={m} onDone={() => undefined} onMore={() => undefined} />);
    expect(
      screen.getAllByRole('button', { name: /^React / }).map((b) => b.getAttribute('aria-label')),
    ).toEqual(['React 🔥', 'React 🎉', 'React 👀']);
    expect(screen.getByRole('button', { name: 'More reactions' })).toBeInTheDocument();
  });

  it('a double tap on a message bubble adds ❤️, on touch only', () => {
    useChats.getState().upsertChat(chat);
    useMessages.setState({
      byChat: { [chat.id]: { ...EMPTY_CHAT_MESSAGES, items: mergePage([], [m]), loaded: true } },
    });
    render(
      <MemoryRouter>
        <MessageActionsHost chat={chat} />
        <div data-message-id="m1">
          <div data-testid="bubble">
            <span>hello</span>
          </div>
        </div>
      </MemoryRouter>,
    );
    const text = screen.getByText('hello');
    const tap = (pointerType: string) => {
      const e = new Event('pointerup', { bubbles: true });
      Object.defineProperties(e, {
        pointerType: { value: pointerType },
        clientX: { value: 10 },
        clientY: { value: 10 },
      });
      text.dispatchEvent(e);
    };
    tap('mouse');
    tap('mouse');
    expect(put).not.toHaveBeenCalled();
    tap('touch');
    expect(put).not.toHaveBeenCalled();
    tap('touch');
    expect(put).toHaveBeenCalledWith(`/api/messages/m1/reactions/${encodeURIComponent('❤️')}/@me`);
    expect(useMessages.getState().byChat[chat.id]!.items[0]).toMatchObject({
      myReactions: ['❤️'],
      reactions: [{ emoji: '❤️', count: 1 }],
    });
  });
});
