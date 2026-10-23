/**
 * App chrome: the tab title and the favicon / app badges follow the unread counts and the
 * open chat; Streamer Mode's banner (with Disable) and its automatic switch on screen share.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { ChatMember, ChatSummary } from '@enbox/shared';
import { useChatMembersStore } from '@/features/conversation/members';
import { makeSpace } from '@/features/spaces/testUtils';
import { useAuth } from '@/stores/auth';
import { useCalls, type ActiveCall } from '@/stores/calls';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { DEFAULT_STREAMER, useStreamer } from '@/stores/streamer';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { AppChrome } from './AppChrome';
import { setAppBadge, setFaviconBadge } from './badges';

vi.mock('./badges', () => ({ setAppBadge: vi.fn(), setFaviconBadge: vi.fn() }));

const general = makeChat({
  id: 'general',
  type: 'space_text',
  name: 'general',
  space: {
    spaceId: 's1',
    categoryId: null,
    position: 0,
    topic: null,
    slowmodeSeconds: 0,
    nsfw: false,
    userLimit: null,
    bitrate: null,
    permissionsSynced: true,
    overwrites: [],
  },
});
const dm = (p: Partial<ChatSummary> = {}) =>
  makeChat({
    id: 'dm',
    type: 'direct',
    name: null,
    peer: makeUser({ displayName: 'Alice' }),
    ...p,
  });

function renderChrome(at = '/spaces/s1/general') {
  return render(
    <MemoryRouter initialEntries={[at]}>
      <AppChrome />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useSpaces.setState({
    byId: { s1: makeSpace({ id: 's1', name: 'Gaming' }) },
    order: ['s1'],
    channelsLoaded: { s1: true },
  });
});

afterEach(() => {
  useChats.setState({ byId: {}, openChatId: null });
  useSpaces.setState({ byId: {}, order: [], channelsLoaded: {} });
  useCalls.setState({ active: null });
  useStreamer.setState({ ...DEFAULT_STREAMER, auto: false });
  document.title = 'Enbox';
});

describe('tab title and badges', () => {
  it('counts unread DMs and mentions, names the open channel, and resets on sign-out', () => {
    useChats.setState({ byId: { general, dm: dm({ unreadCount: 2 }) }, openChatId: 'general' });
    const { unmount } = renderChrome();
    expect(document.title).toBe('(2) Enbox | #general | Gaming');
    expect(setFaviconBadge).toHaveBeenLastCalledWith('2');
    expect(setAppBadge).toHaveBeenLastCalledWith(2);

    // Read: no count; a group with unread messages but no mention leaves the dot.
    act(() =>
      useChats.setState({
        byId: { general, dm: dm(), g: makeChat({ id: 'g', type: 'group', unreadCount: 4 }) },
      }),
    );
    expect(document.title).toBe('• Enbox | #general | Gaming');
    expect(setFaviconBadge).toHaveBeenLastCalledWith('');
    expect(setAppBadge).toHaveBeenLastCalledWith(0);

    // A DM open: "@name".
    act(() => useChats.setState({ openChatId: 'dm' }));
    expect(document.title).toBe('• Enbox | @Alice');

    unmount();
    expect(document.title).toBe('Enbox');
  });

  it('twelve mentions: (12) in the title, 9+ on the favicon', () => {
    useChats.setState({ byId: { dm: dm({ unreadCount: 12 }) } });
    renderChrome('/chats');
    expect(document.title).toBe('(12) Enbox');
    expect(setFaviconBadge).toHaveBeenLastCalledWith('9+');
    expect(setAppBadge).toHaveBeenLastCalledWith(12);
  });

  it('an unnamed group DM: its unreads count like a DM’s, its members’ names in the title', () => {
    const member = (id: string, displayName: string): ChatMember => ({
      user: makeUser({ id, displayName }),
      role: 'member',
      joinedAt: '2026-01-01T00:00:00.000Z',
    });
    useChatMembersStore.setState({
      byChat: { gdm: [member('me', 'Me'), member('alice', 'Alice'), member('bob', 'Bob')] },
    });
    const gdm = makeChat({
      id: 'gdm',
      type: 'group',
      isGroupDm: true,
      name: null,
      memberCount: 3,
      unreadCount: 3,
    });
    useChats.setState({ byId: { gdm }, openChatId: 'gdm' });
    renderChrome('/chats/gdm');
    expect(document.title).toBe('(3) Enbox | Alice, Bob');
    useChatMembersStore.setState({ byChat: {} });
  });
});

describe('Streamer Mode chrome', () => {
  it('a violet bar says it is on; Disable turns it off', () => {
    renderChrome('/chats');
    expect(screen.queryByTestId('streamer-banner')).toBeNull();
    act(() => useStreamer.getState().setEnabled(true));
    const bar = screen.getByTestId('streamer-banner');
    expect(bar).toHaveTextContent('Streamer Mode is on');
    expect(bar).toHaveClass('bg-brand');
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }));
    expect(useStreamer.getState().enabled).toBe(false);
    expect(screen.queryByTestId('streamer-banner')).toBeNull();
  });

  it('turns on while I share my screen when asked to, and off again when I stop', () => {
    renderChrome('/chats');
    const share = (on: boolean) =>
      act(() => useCalls.setState({ active: on ? ({ screenSharing: true } as ActiveCall) : null }));

    share(true);
    expect(useStreamer.getState().enabled).toBe(false); // not asked to
    share(false);

    act(() => useStreamer.getState().setOption('autoOnScreenShare', true));
    share(true);
    expect(useStreamer.getState()).toMatchObject({ enabled: true, auto: true });
    expect(screen.getByTestId('streamer-banner')).toBeInTheDocument();
    share(false);
    expect(useStreamer.getState().enabled).toBe(false);

    // Turned on by hand: it stays on after the share.
    act(() => useStreamer.getState().setEnabled(true));
    share(true);
    share(false);
    expect(useStreamer.getState().enabled).toBe(true);
  });
});
