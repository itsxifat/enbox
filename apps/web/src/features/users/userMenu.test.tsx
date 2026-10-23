/**
 * The user context menu: Discord's items for a friend and a stranger, the member's Space items
 * (Roles ▸ as checkboxes, kick through its dialog), Copy User ID in Developer Mode, my own
 * menu, and the dialogs it opens (Add Note, friend nickname) and Invite to Space ▸.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { SpaceMember, UserProfile } from '@enbox/shared';
import { makeSpace } from '@/features/spaces/testUtils';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useContacts } from '@/stores/contacts';
import { useFriends } from '@/stores/friends';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { UserMenuHost } from './UserMenuHost';
import { openUserMenu, useUserMenu } from './userMenu';

const outbox = vi.hoisted(() => ({ sendQueued: vi.fn(async () => null) }));
vi.mock('@/features/conversation/lib/outbox', () => outbox);

const ann = makeUser({ id: 'ann', username: 'ann', displayName: 'Ann', isContact: true });
const zed = makeUser({ id: 'zed', username: 'zed', displayName: 'Zed' });
const zedMember: SpaceMember = {
  userId: 'zed',
  nickname: null,
  roleIds: [],
  joinedAt: '2026-01-01T00:00:00.000Z',
  timedOutUntil: null,
  serverMute: false,
  serverDeaf: false,
} as SpaceMember;

const items = () => screen.getAllByRole('menuitem').map((i) => i.textContent);

function renderHost() {
  return render(
    <MemoryRouter>
      <UserMenuHost />
    </MemoryRouter>,
  );
}

function openFor(userId: string, opts = {}) {
  act(() => void openUserMenu(userId, { x: 10, y: 10 }, opts));
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
  useUi.setState({ toasts: [], dialogs: [] });
  useUsers
    .getState()
    .upsertUsers([ann, zed, makeUser({ id: 'me', username: 'me', displayName: 'Me' })]);
  useContacts.setState({ contacts: [{ userId: 'ann', name: null, createdAt: '' }], loaded: true });
  const base = makeSpace({ owner: true, name: 'Climbers' });
  const mods = { ...base.roles[0]!, id: 'mods', name: 'Mods', position: 1, isDefault: false };
  useSpaces.setState({
    byId: { s1: { ...base, roles: [...base.roles, mods] } },
    order: ['s1'],
    members: { s1: { zed: zedMember } },
  });
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/friends/requests') return { incoming: [], outgoing: [] };
    if (path === '/api/users/ann/profile')
      return {
        user: ann,
        mutualSpaces: [],
        mutualFriends: [],
        mutualGroupCount: 0,
        note: null,
      } satisfies UserProfile;
    return [];
  });
  outbox.sendQueued.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  useUi.getState().setPref('developerMode', false);
});

describe('the user menu', () => {
  it('opens at the point with Discord’s items for a friend', async () => {
    renderHost();
    openFor('ann');
    expect(await screen.findByRole('menu', { name: 'Ann menu' })).toBeInTheDocument();
    expect(items()).toEqual([
      'Profile',
      'Message',
      'Call',
      'Add Note',
      'Add Friend Nickname',
      'Invite to Space',
      'Remove Friend',
      'Ignore',
      'Block',
    ]);
    // Escape / an outside click closes it.
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(useUserMenu.getState().menu).toBeNull());
  });

  it('a stranger in my Space: Add Friend, the member items with Roles ▸, then Copy User ID', async () => {
    useUi.getState().setPref('developerMode', true);
    renderHost();
    openFor('zed', { spaceId: 's1' });
    await screen.findByRole('menu', { name: 'Zed menu' });
    expect(items()).toEqual([
      'Profile',
      'Message',
      'Call',
      'Add Note',
      'Invite to Space',
      'Add Friend',
      'Ignore',
      'Block',
      'Mod View',
      'Change nickname',
      'Time out Zed',
      'Kick Zed',
      'Ban Zed',
      'Roles',
      'Transfer Ownership',
      'Copy User ID',
    ]);
  });

  it('Roles ▸ toggles a role and stays open', async () => {
    const put = vi
      .spyOn(api, 'put')
      .mockResolvedValue({ ...zedMember, roleIds: ['mods'] } as never);
    renderHost();
    openFor('zed', { spaceId: 's1' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Roles' }));
    const sub = await screen.findByRole('menu', { name: 'Roles' });
    const mods = within(sub).getByRole('menuitemcheckbox', { name: 'Mods' });
    expect(mods).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(mods);
    await waitFor(() => expect(put).toHaveBeenCalledWith('/api/spaces/s1/members/zed/roles/mods'));
    await waitFor(() =>
      expect(
        within(screen.getByRole('menu', { name: 'Roles' })).getByRole('menuitemcheckbox', {
          name: 'Mods',
        }),
      ).toHaveAttribute('aria-checked', 'true'),
    );
  });

  it('Kick opens its dialog, which outlives the menu', async () => {
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined as never);
    renderHost();
    openFor('zed', { spaceId: 's1' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Kick Zed' }));
    const dialog = await screen.findByRole('dialog', { name: 'Kick Zed?' });
    expect(useUserMenu.getState().menu).toBeNull();
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Kick' }));
    });
    expect(del).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/spaces\/s1\/members\/zed/));
    await waitFor(() => expect(useUserMenu.getState().dialog).toBeNull());
  });

  it('my own menu keeps Profile and the id', async () => {
    useUi.getState().setPref('developerMode', true);
    renderHost();
    openFor('me');
    await screen.findByRole('menu');
    expect(items()).toEqual(['Profile', 'Copy User ID']);
  });

  it('Add Note edits my private note', async () => {
    const put = vi.spyOn(api, 'put').mockResolvedValue({ note: 'Climbing buddy' } as never);
    renderHost();
    openFor('ann');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add Note' }));
    const dialog = await screen.findByRole('dialog', { name: 'Note' });
    const field = within(dialog).getByTestId('user-note-input');
    await waitFor(() => expect(field).toBeEnabled());
    fireEvent.change(field, { target: { value: 'Climbing buddy' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(put).toHaveBeenCalledWith('/api/users/ann/note', { note: 'Climbing buddy' }),
    );
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Note' })).toBeNull());
  });

  it('Add Friend Nickname saves the contact name', async () => {
    const patch = vi.spyOn(api, 'patch').mockResolvedValue({
      user: { ...ann, contactName: 'Annie' },
      name: 'Annie',
      createdAt: '',
    } as never);
    renderHost();
    openFor('ann');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Add Friend Nickname' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add Friend Nickname' });
    fireEvent.change(within(dialog).getByLabelText('Friend Nickname'), {
      target: { value: ' Annie ' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/contacts/ann', { name: 'Annie' }));
    await waitFor(() => expect(useUsers.getState().byId.ann?.contactName).toBe('Annie'));
  });

  it('Invite to Space ▸ sends a fresh invite link in our DM', async () => {
    const dm = makeChat({ id: 'd1', type: 'direct', name: null, peer: ann, memberCount: 2 });
    const post = vi.spyOn(api, 'post').mockImplementation(async (path: string) => {
      if (path === '/api/chats/direct') return dm;
      if (path === '/api/spaces/s1/invites') return { code: 'INVITECODE' };
      throw new Error(`unexpected POST ${path}`);
    });
    renderHost();
    openFor('ann');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Invite to Space' }));
    fireEvent.click(
      within(await screen.findByRole('menu', { name: 'Invite to Space' })).getByRole('menuitem', {
        name: 'Climbers',
      }),
    );
    await waitFor(() => expect(outbox.sendQueued).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/spaces/s1/invites', {});
    expect(outbox.sendQueued).toHaveBeenCalledWith('d1', {
      type: 'text',
      text: expect.stringMatching(/\/join\/INVITECODE$/),
    });
    expect(useUi.getState().toasts.at(-1)?.message).toBe('Invite to Climbers sent to Ann');
  });

  it('Message opens our DM', async () => {
    const dm = makeChat({ id: 'd1', type: 'direct', name: null, peer: ann, memberCount: 2 });
    vi.spyOn(api, 'post').mockResolvedValue(dm as never);
    const to: string[] = [];
    const off = bus.on('navigate', (e) => void to.push(e.to));
    renderHost();
    openFor('ann');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Message' }));
    await waitFor(() => expect(to).toEqual(['/chats/d1']));
    off();
  });

  it('the friend item follows pending requests', async () => {
    useFriends.setState({ outgoing: [{ userId: 'zed', createdAt: '' }], loaded: true });
    renderHost();
    openFor('zed');
    await screen.findByRole('menu');
    expect(items()).toContain('Cancel Request');
    expect(items()).not.toContain('Add Friend');
  });
});
