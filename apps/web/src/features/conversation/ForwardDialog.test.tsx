/** The forward dialog sends its optional message with the copies (`comment`). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { FORWARD_COMMENT_MAX_LENGTH } from '@enbox/shared';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { useConversationUi } from './state';

const post = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: async () => [], post: (...a: unknown[]) => post(...a) },
}));

const { ForwardDialog } = await import('./ForwardDialog');

const source = makeChat({ id: 'src', name: 'Source' });
const club = makeChat({ id: 'club', name: 'Book club' });
const m = makeMessage({ id: 'm1', chatId: source.id });

function open() {
  act(() => useConversationUi.getState().openForward([m]));
  render(
    <MemoryRouter>
      <ForwardDialog />
    </MemoryRouter>,
  );
}

const field = () => screen.getByRole('textbox', { name: 'Add an optional message' });

beforeEach(() => {
  useAuth.setState({ user: makeMe(), token: 't', status: 'authenticated' });
  useChats.setState({ byId: { [source.id]: source, [club.id]: club } });
  post.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  post.mockReset();
  act(() => useConversationUi.getState().openForward(null));
});

describe('ForwardDialog', () => {
  it('sends the optional message, trimmed, with the forward', async () => {
    open();
    expect(field()).toHaveAttribute('maxLength', String(FORWARD_COMMENT_MAX_LENGTH));
    fireEvent.click(screen.getByText('Book club'));
    fireEvent.change(field(), { target: { value: '  you will like this  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post).toHaveBeenCalledWith(
      '/api/messages/forward',
      expect.objectContaining({
        messageIds: ['m1'],
        chatIds: ['club'],
        comment: 'you will like this',
      }),
    );
    await waitFor(() => expect(useConversationUi.getState().forward).toBeNull());
  });

  it('leaves the message out when it is blank; Enter in it forwards', async () => {
    open();
    fireEvent.click(screen.getByText('Book club'));
    fireEvent.change(field(), { target: { value: '   ' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    await waitFor(() => expect(post).toHaveBeenCalledTimes(1));
    expect(post.mock.calls[0]![1]).not.toHaveProperty('comment');
  });

  it('Enter does nothing until a chat is picked', () => {
    open();
    fireEvent.change(field(), { target: { value: 'hello' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(post).not.toHaveBeenCalled();
  });
});
