/**
 * Slowmode in the composer: the timer shows in Space chats with slowmode unless I may bypass
 * it (MANAGE_MESSAGES / MANAGE_CHANNELS); after I send, a countdown until the next message
 * (from my last message there too) while Enter refuses; a slowmode 429 starts it from the
 * server's wait and gives the text back.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PERM, type SpaceChannelInfo } from '@enbox/shared';
import { ApiError } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useMessages, type ChatMessages, type ClientMessage } from '@/stores/messages';
import { DEFAULT_PREFS, toast, useUi } from '@/stores/ui';
import { makeChat, makeMe, makeMessage } from '@/test/factories';
import { useChatMembersStore } from '../members';
import { Composer } from './Composer';
import {
  formatCooldown,
  lastSentAt,
  slowmodeSecondsFor,
  slowmodeWait,
  useSlowmode,
} from './slowmode';

const BASE = PERM.VIEW_CHANNEL | PERM.SEND_MESSAGES;

function info(slowmodeSeconds: number): SpaceChannelInfo {
  return {
    spaceId: 's1',
    categoryId: null,
    position: 0,
    topic: null,
    slowmodeSeconds,
    nsfw: false,
    userLimit: null,
    bitrate: null,
    permissionsSynced: true,
    overwrites: [],
  };
}

const channel = (slowmodeSeconds: number, perms = BASE) =>
  makeChat({
    id: 'c1',
    type: 'space_text',
    name: 'general',
    space: info(slowmodeSeconds),
    spacePermissions: perms,
  });

const refusal = (wait: number) =>
  new ApiError('rate_limited', `Slowmode is on: wait ${wait}s before sending again`, 429);

const textarea = () => screen.getByRole('textbox', { name: 'Message' });
const type = (value: string) => fireEvent.change(textarea(), { target: { value } });
const enter = () => fireEvent.keyDown(textarea(), { key: 'Enter' });
const timer = () => screen.queryByTestId('slowmode');

let send: ReturnType<typeof vi.fn>;

function seed(items: ClientMessage[] = []) {
  useMessages.setState({
    byChat: {
      c1: {
        items,
        loaded: true,
        hasMoreBefore: false,
        hasMoreAfter: false,
      } as unknown as ChatMessages,
    },
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date', 'setInterval', 'clearInterval'] });
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ prefs: { ...DEFAULT_PREFS, sounds: false } });
  useChatMembersStore.setState({ byChat: {} });
  seed();
  send = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(useMessages.getState(), 'sendMessage').mockImplementation(send as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  resetSessionState();
  useSlowmode.setState({ until: {} });
  useMessages.setState({ byChat: {} });
});

describe('slowmode helpers', () => {
  it('reads the wait of a slowmode refusal only', () => {
    expect(slowmodeWait(refusal(12))).toBe(12);
    expect(
      slowmodeWait(new ApiError('rate_limited', 'Too many requests, slow down', 429)),
    ).toBeNull();
    expect(slowmodeWait(new ApiError('forbidden', 'Slowmode is on: wait 3s', 403))).toBeNull();
    expect(slowmodeWait(new Error('Slowmode is on: wait 3s'))).toBeNull();
  });

  it('formats the countdown like a clock', () => {
    expect(formatCooldown(42)).toBe('0:42');
    expect(formatCooldown(41.2)).toBe('0:42');
    expect(formatCooldown(60)).toBe('1:00');
    expect(formatCooldown(600)).toBe('10:00');
    expect(formatCooldown(3725)).toBe('1:02:05');
    expect(formatCooldown(0)).toBe('0:00');
  });

  it('my latest confirmed message counts (not pending, failed or others’)', () => {
    const at = (s: number) => new Date(Date.UTC(2026, 0, 1, 0, 0, s)).toISOString();
    const items: ClientMessage[] = [
      makeMessage({ id: 'a', senderId: 'me', createdAt: at(1) }),
      makeMessage({ id: 'b', senderId: 'me', createdAt: at(5) }),
      makeMessage({ id: 'c', senderId: 'bob', createdAt: at(9) }),
      { ...makeMessage({ id: 'd', senderId: 'me', createdAt: at(10) }), pending: true },
      { ...makeMessage({ id: 'e', senderId: 'me', createdAt: at(11) }), failed: true },
    ];
    expect(lastSentAt(items, 'me')).toBe(Date.parse(at(5)));
    expect(lastSentAt(items, 'carol')).toBe(0);
    expect(lastSentAt(undefined, 'me')).toBe(0);
  });

  it('applies unless I may manage messages or channels', () => {
    expect(slowmodeSecondsFor(channel(30))).toBe(30);
    expect(slowmodeSecondsFor(channel(0))).toBe(0);
    expect(slowmodeSecondsFor(channel(30, BASE | PERM.MANAGE_MESSAGES))).toBe(0);
    expect(slowmodeSecondsFor(channel(30, BASE | PERM.MANAGE_CHANNELS))).toBe(0);
  });
});

describe('slowmode in the composer', () => {
  it('shows the timer only where slowmode applies to me', () => {
    const { unmount } = render(<Composer chat={channel(30)} />);
    expect(timer()).toHaveAttribute('title', 'Slowmode is enabled');
    expect(timer()).toHaveTextContent('Slowmode is enabled');
    unmount();
    const { unmount: again } = render(<Composer chat={channel(30, BASE | PERM.MANAGE_MESSAGES)} />);
    expect(timer()).toBeNull();
    again();
    render(<Composer chat={channel(0)} />);
    expect(timer()).toBeNull();
  });

  it('after I send: a countdown, and Enter refuses until it ends', () => {
    render(<Composer chat={channel(30)} />);
    type('one');
    enter();
    expect(send).toHaveBeenCalledTimes(1);
    expect(timer()).toHaveTextContent('0:30');
    type('two');
    enter();
    expect(send).toHaveBeenCalledTimes(1);
    expect(textarea()).toHaveValue('two');
    act(() => vi.advanceTimersByTime(10_000));
    expect(timer()).toHaveTextContent('0:20');
    act(() => vi.advanceTimersByTime(20_000));
    expect(timer()).not.toHaveTextContent(/\d:\d\d/);
    enter();
    expect(send).toHaveBeenCalledTimes(2);
    expect((send.mock.calls[1]![1] as { text: string }).text).toBe('two');
  });

  it('mirrors the server from my last message there', () => {
    seed([
      makeMessage({
        id: 'm1',
        chatId: 'c1',
        senderId: 'me',
        createdAt: new Date(Date.now() - 20_000).toISOString(),
      }),
    ]);
    render(<Composer chat={channel(60)} />);
    expect(timer()).toHaveTextContent('0:40');
    type('too soon');
    enter();
    expect(send).not.toHaveBeenCalled();
  });

  it('a slowmode refusal: the countdown from the server’s wait, the text back in the box', async () => {
    const error = vi.spyOn(toast, 'error');
    const remove = vi.spyOn(useMessages.getState(), 'removeOptimistic');
    send.mockRejectedValueOnce(refusal(12));
    render(<Composer chat={channel(5)} />);
    type('hello');
    enter();
    expect(textarea()).toHaveValue('');
    await act(async () => undefined);
    expect(timer()).toHaveTextContent('0:12');
    expect(textarea()).toHaveValue('hello');
    expect(remove).toHaveBeenCalledWith(
      'c1',
      (send.mock.calls[0]![1] as { clientId: string }).clientId,
    );
    expect(error).toHaveBeenCalledWith(expect.any(ApiError), { id: 'slowmode' });
  });
});
