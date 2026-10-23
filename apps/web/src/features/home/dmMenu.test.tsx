/**
 * The DM list the Discord way: rows by latest activity (pins don't count) and the DM row menu
 * (the person's items, Close DM, Mute @name ▸ with Discord's durations, the ids).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { MUTE_FOREVER_ISO, SPACE_MUTE_DURATIONS, type ChatSummary } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { sortDms } from './dmList';
import { DmRow } from './HomeSidebar';

const ann = makeUser({ id: 'ann', username: 'ann', displayName: 'Ann', isContact: true });

const dm = (p: Partial<ChatSummary> = {}) =>
  makeChat({ id: 'd1', type: 'direct', name: null, peer: ann, memberCount: 2, ...p });

const items = () => screen.getAllByRole('menuitem').map((i) => i.textContent);

function openRow(chat: ChatSummary) {
  useChats.getState().upsertChat(chat);
  render(
    <MemoryRouter initialEntries={['/chats']}>
      <DmRow chat={chat} active={false} />
    </MemoryRouter>,
  );
  fireEvent.contextMenu(screen.getByTestId('dm-row'));
  return screen.getByRole('menu');
}

beforeEach(() => {
  resetSessionState();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.getState().upsertUsers([ann]);
  useSpaces.setState({ byId: { s1: makeSpace({ owner: true }) }, order: ['s1'], members: {} });
  vi.spyOn(api, 'get').mockImplementation(async (path: string) =>
    path === '/api/friends/requests' ? { incoming: [], outgoing: [] } : [],
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useUi.getState().setPref('developerMode', false);
});

describe('the DM row menu', () => {
  it('a friend’s DM: Discord’s items, then the ids in Developer Mode', async () => {
    useUi.getState().setPref('developerMode', true);
    openRow(dm({ unreadCount: 2 }));
    await waitFor(() =>
      expect(items()).toEqual([
        'Mark as Read',
        'Profile',
        'Call',
        'Add Note',
        'Add Friend Nickname',
        'Close DM',
        'Invite to Space',
        'Remove Friend',
        'Ignore',
        'Block',
        'Mute @ann',
        'Copy User ID',
        'Copy Channel ID',
      ]),
    );
    expect(screen.getByRole('menuitem', { name: 'Mark as Read' })).toBeEnabled();
  });

  it('Mark as Read is disabled once read; no pin, archive or delete entries', () => {
    openRow(dm());
    expect(screen.getByRole('menuitem', { name: 'Mark as Read' })).toBeDisabled();
    expect(screen.queryByRole('menuitem', { name: /Pin|Archive|Delete/ })).toBeNull();
  });

  it('Mute @name ▸ offers Discord’s durations', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(undefined as never);
    openRow(dm());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Mute @ann' }));
    const sub = await screen.findByRole('menu', { name: 'Mute @ann' });
    expect(
      within(sub)
        .getAllByRole('menuitem')
        .map((i) => i.textContent),
    ).toEqual(SPACE_MUTE_DURATIONS.map((d) => d.label));
    const t0 = Date.now();
    fireEvent.click(within(sub).getByRole('menuitem', { name: 'For 1 hour' }));
    await waitFor(() => expect(patch).toHaveBeenCalled());
    const [path, body] = patch.mock.calls[0]! as [string, { mutedUntil: string }];
    expect(path).toBe('/api/chats/d1/prefs');
    expect(Date.parse(body.mutedUntil) - t0).toBeGreaterThan(3_600_000 - 2000);
  });

  it('a muted DM offers Unmute with when the mute ends', () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(undefined as never);
    openRow(dm({ mutedUntil: MUTE_FOREVER_ISO }));
    const unmute = screen.getByRole('menuitem', { name: 'Unmute @ann' });
    expect(unmute).toHaveAccessibleDescription('Muted until you turn it back on');
    fireEvent.click(unmute);
    expect(patch).toHaveBeenCalledWith('/api/chats/d1/prefs', { mutedUntil: null });
  });

  it('Close DM hides it from the list (archived)', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue(undefined as never);
    openRow(dm());
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close DM' }));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('/api/chats/d1/prefs', {
        isArchived: true,
        isPinned: false,
      }),
    );
  });

  it('a deleted account’s DM keeps the conversation’s items only', () => {
    const gone = makeUser({ id: 'gone', username: 'gone', isDeleted: true });
    useUsers.getState().upsertUsers([gone]);
    openRow(dm({ peer: gone }));
    expect(items()).toEqual(['Mark as Read', 'Close DM', 'Mute Conversation']);
  });
});

describe('the DM list order', () => {
  it('latest activity first, whatever is pinned', () => {
    const old = makeChat({ id: 'a', isPinned: true, lastActivityAt: '2026-10-01T00:00:00.000Z' });
    const fresh = makeChat({ id: 'b', lastActivityAt: '2026-10-20T00:00:00.000Z' });
    const mid = makeChat({ id: 'c', lastActivityAt: '2026-10-10T00:00:00.000Z' });
    expect(sortDms([old, fresh, mid]).map((c) => c.id)).toEqual(['b', 'c', 'a']);
  });
});
