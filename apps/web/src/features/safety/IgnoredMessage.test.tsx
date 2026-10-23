import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import type { ServerToClientEvents } from '@enbox/shared';
import { CozyMessageRow } from '@/features/conversation/CozyMessageRow';
import { RowAppearanceContext } from '@/features/conversation/bubbles/appearance';
import type { Row } from '@/features/conversation/lib/rows';
import { MessageRow } from '@/features/conversation/MessageRow';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import type { AppSocket } from '@/lib/socket';
import { registerIgnoresHandlers, resyncIgnores } from '@/realtime/ignores';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { isIgnored, useIgnores } from '@/stores/ignores';
import { makeChat, makeMe, makeMessage, makeUser } from '@/test/factories';

const me = makeMe({ id: 'me', displayName: 'Mia' });
const chat = makeChat({ id: 'chat-a', type: 'group' });

function row(senderId: string, id: string, text: string): Row {
  return {
    key: id,
    message: makeMessage({ id, chatId: chat.id, senderId, text }),
    mine: senderId === me.id,
    showDay: false,
    unreadDivider: 0,
    firstInGroup: true,
    lastInGroup: true,
  };
}

function renderRow(r: Row, Component: typeof MessageRow = MessageRow) {
  return render(
    <RowAppearanceContext.Provider value={{ bubbleStyle: 'rounded', messageAnimation: 'none' }}>
      <Component row={r} chat={chat} onJump={() => undefined} onJumpById={() => undefined} />
    </RowAppearanceContext.Provider>,
  );
}

function fakeSocket() {
  const handlers = new Map<string, (payload: unknown) => void>();
  const socket = {
    on(event: string, fn: (payload: unknown) => void) {
      handlers.set(event, fn);
      return socket;
    },
  } as unknown as AppSocket;
  const fire = <E extends keyof ServerToClientEvents>(
    event: E,
    payload: Parameters<ServerToClientEvents[E]>[0],
  ) => handlers.get(event)!(payload);
  return { socket, fire };
}

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: me, token: 't', status: 'authenticated' });
  useIgnores.getState().apply(['pest']);
});
afterEach(() => vi.restoreAllMocks());

describe('ignored messages', () => {
  it('collapse to "Ignored message — Show" until shown, in both row styles', () => {
    renderRow(row('pest', 'm1', 'buy my stuff'));
    expect(screen.getByTestId('ignored-message')).toHaveTextContent('Ignored message');
    expect(screen.queryByText('buy my stuff')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Show ignored message' }));
    expect(screen.getByText('buy my stuff')).toBeInTheDocument();
    expect(screen.queryByTestId('ignored-message')).not.toBeInTheDocument();

    // Revealed per message: the next one from them is still collapsed (cozy rows too).
    renderRow(row('pest', 'm2', 'still selling'), CozyMessageRow);
    expect(screen.queryByText('still selling')).not.toBeInTheDocument();
    expect(screen.getByTestId('ignored-message')).toBeInTheDocument();
  });

  it('never collapses other people or me', () => {
    renderRow(row('friend', 'm3', 'hi there'));
    renderRow(row('me', 'm4', 'my words'));
    expect(screen.getByText('hi there')).toBeInTheDocument();
    expect(screen.getByText('my words')).toBeInTheDocument();
    expect(screen.queryByTestId('ignored-message')).not.toBeInTheDocument();
  });

  it('follows ignores:changed and reloads on ready', async () => {
    const { socket, fire } = fakeSocket();
    registerIgnoresHandlers(socket);
    renderRow(row('newpest', 'm5', 'hello'));
    expect(screen.getByText('hello')).toBeInTheDocument();
    act(() => fire('ignores:changed', { userIds: ['newpest'] }));
    expect(screen.queryByText('hello')).not.toBeInTheDocument();
    expect(isIgnored('pest')).toBe(false);

    const get = vi.spyOn(api, 'get').mockResolvedValue([makeUser({ id: 'pest' })]);
    await act(() => resyncIgnores({ userId: 'me', sessionId: 's', reconnect: true } as never));
    expect(get).toHaveBeenCalledWith('/api/me/ignores');
    expect(isIgnored('pest')).toBe(true);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('ignoring someone clears their typing at once; unignoring rolls back on failure', async () => {
    useChats.getState().setTyping('chat-a', 'talker', 'typing');
    vi.spyOn(api, 'put').mockResolvedValue(undefined);
    await act(() => useIgnores.getState().ignore('talker'));
    expect(useChats.getState().typing['chat-a']?.talker).toBeUndefined();
    expect(useIgnores.getState().ids).toEqual(['talker', 'pest']);

    vi.spyOn(api, 'delete').mockRejectedValue(new Error('offline'));
    await expect(useIgnores.getState().unignore('talker')).rejects.toThrow('offline');
    expect(isIgnored('talker')).toBe(true);
  });
});
