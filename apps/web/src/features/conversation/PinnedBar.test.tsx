import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import type { Message } from '@enbox/shared';
import { resetSessionState } from '@/lib/session';
import { useChats } from '@/stores/chats';
import { makeChat, makeMessage } from '@/test/factories';

const get = vi.fn();
vi.mock('@/lib/api', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  api: { get: (...a: unknown[]) => get(...a), post: async () => [] },
}));

const { PinnedBar } = await import('./PinnedBar');

const chat = makeChat({ id: 'chat-a' });
const x = makeMessage({ id: 'x', chatId: chat.id, seq: 3, text: 'old pinned X' });
const y = makeMessage({ id: 'y', chatId: chat.id, seq: 5, text: 'new pinned Y' });

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe('PinnedBar', () => {
  afterEach(() => {
    cleanup();
    get.mockReset();
    resetSessionState();
  });

  it('replaces stale cached pins with the server list when the chat opens', async () => {
    useChats.setState({ byId: { [chat.id]: chat }, pins: { [chat.id]: ['x'] } });
    get.mockResolvedValue([y]);
    render(<PinnedBar chat={chat} />);
    expect(await screen.findByText('new pinned Y')).toBeInTheDocument();
    expect(screen.queryByText('old pinned X')).not.toBeInTheDocument();
    expect(useChats.getState().pins[chat.id]).toEqual(['y']);
    expect(get).toHaveBeenCalledWith(`/api/chats/${chat.id}/pins`);
  });

  it('fetches even when the cache says there are no pins', async () => {
    useChats.setState({ byId: { [chat.id]: chat }, pins: { [chat.id]: [] } });
    get.mockResolvedValue([y]);
    render(<PinnedBar chat={chat} />);
    expect(await screen.findByText('new pinned Y')).toBeInTheDocument();
  });

  it('keeps a chat:pins update that arrives while the request is in flight', async () => {
    useChats.setState({ byId: { [chat.id]: chat }, pins: { [chat.id]: ['x'] } });
    const first = deferred<Message[]>();
    get.mockReturnValueOnce(first.promise).mockResolvedValue([x, y]);
    render(<PinnedBar chat={chat} />);
    act(() => useChats.getState().setPins(chat.id, ['x', 'y']));
    await act(async () => first.resolve([x]));
    await waitFor(() => expect(useChats.getState().pins[chat.id]).toEqual(['x', 'y']));
    expect(await screen.findByText(/Pinned message 1 of 2/)).toBeInTheDocument();
  });
});
