import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { ChatMember, UserPublic } from '@enbox/shared';
import { useChatMembersStore } from '@/features/conversation/members';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useContacts } from '@/stores/contacts';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { SelectFriendsPopover, type SelectFriendsMode } from './SelectFriendsPopover';

const NAMES = ['Ann', 'Bob', 'Cy', 'Dee', 'Eli', 'Fay', 'Gus', 'Hal', 'Ivy', 'Jo', 'Kit'];
const friends = NAMES.map((name) =>
  makeUser({
    id: name.toLowerCase(),
    username: name.toLowerCase(),
    displayName: name,
    isContact: true,
  }),
);
const [ann, bob, cy, dee] = friends as [UserPublic, UserPublic, UserPublic, UserPublic];
const meUser = makeUser({ id: 'me', displayName: 'Me' });
const member = (user: UserPublic, role: ChatMember['role'] = 'member'): ChatMember => ({
  user,
  role,
  joinedAt: '2026-10-01T00:00:00.000Z',
});

function setFriends(users: UserPublic[]) {
  useUsers.getState().upsertUsers(users);
  useContacts.setState({
    contacts: users.map((u) => ({
      userId: u.id,
      name: null,
      createdAt: '2026-01-01T00:00:00.000Z',
    })),
    loaded: true,
  });
}

function Where() {
  const loc = useLocation();
  return <span data-testid="where">{loc.pathname + loc.search}</span>;
}

function renderPicker(mode: SelectFriendsMode) {
  const onClose = vi.fn();
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  render(
    <MemoryRouter initialEntries={['/chats']}>
      <Routes>
        <Route
          path="*"
          element={
            <>
              <SelectFriendsPopover mode={mode} anchor={anchor} onClose={onClose} />
              <Where />
            </>
          }
        />
      </Routes>
    </MemoryRouter>,
  );
  return { onClose };
}

/** A friend's row: display name then username. */
const option = (name: string) =>
  screen.getByRole('checkbox', { name: new RegExp(`^${name}\\s?${name.toLowerCase()}$`) });
const slots = () => screen.getByTestId('select-friends-slots');
const search = () => screen.getByRole('textbox', { name: 'Search friends' });
const where = () => screen.getByTestId('where');

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetSessionState();
});

describe('Select Friends', () => {
  it('lists my friends; the button says Create DM for one pick and Create Group DM for more', () => {
    setFriends([ann, bob, cy]);
    renderPicker({ kind: 'create' });
    expect(screen.getByRole('heading', { name: 'Select Friends' })).toBeInTheDocument();
    expect(slots()).toHaveTextContent('You can add 9 more friends.');
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(option('Ann')).toHaveTextContent('ann');
    expect(screen.getByRole('button', { name: 'Create DM' })).toBeDisabled();

    fireEvent.click(option('Ann'));
    expect(option('Ann')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('button', { name: 'Create DM' })).toBeEnabled();
    expect(slots()).toHaveTextContent('You can add 8 more friends.');
    fireEvent.click(option('Bob'));
    expect(screen.getByRole('button', { name: 'Create Group DM' })).toBeEnabled();
    expect(screen.getAllByTestId('friend-chip').map((c) => c.textContent)).toEqual(['ann', 'bob']);

    // Backspace in the empty search box drops the last pick; a chip click drops that one.
    fireEvent.keyDown(search(), { key: 'Backspace' });
    expect(option('Bob')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Create DM' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Ann' }));
    expect(screen.queryAllByTestId('friend-chip')).toHaveLength(0);
  });

  it('searches by name or username', () => {
    setFriends([ann, bob, cy]);
    renderPicker({ kind: 'create' });
    fireEvent.change(search(), { target: { value: 'BO' } });
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(option('Bob')).toBeInTheDocument();
    fireEvent.change(search(), { target: { value: 'zed' } });
    expect(screen.getByText('No friends found.')).toBeInTheDocument();
  });

  it('stops at the member limit: 9 friends for a new group DM', () => {
    setFriends(friends);
    renderPicker({ kind: 'create' });
    for (const name of NAMES.slice(0, 9)) fireEvent.click(option(name));
    expect(slots()).toHaveTextContent('This group has a 10 member limit.');
    expect(option('Jo')).toBeDisabled();
    fireEvent.click(option('Jo'));
    expect(option('Jo')).toHaveAttribute('aria-checked', 'false');
    expect(screen.getAllByTestId('friend-chip')).toHaveLength(9);
  });

  it('creates the group DM and opens it', async () => {
    setFriends([ann, bob, cy]);
    const created = makeChat({ id: 'gdm1', name: null, isGroupDm: true, memberCount: 3 });
    const post = vi.spyOn(api, 'post').mockResolvedValue(created as never);
    const { onClose } = renderPicker({ kind: 'create' });
    fireEvent.click(option('Ann'));
    fireEvent.click(option('Bob'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Group DM' }));
    await waitFor(() => expect(where()).toHaveTextContent('/chats/gdm1'));
    expect(post).toHaveBeenCalledWith('/api/chats/group-dm', { userIds: ['ann', 'bob'] });
    expect(onClose).toHaveBeenCalled();
    expect(useChats.getState().byId.gdm1).toMatchObject({ isGroupDm: true });
  });

  it('with no friends, says so and leads to Add Friend', () => {
    setFriends([]);
    renderPicker({ kind: 'create' });
    expect(screen.getByText('You don’t have any friends to add!')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Create DM' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Add Friend' }));
    expect(where()).toHaveTextContent('/chats?friends=add');
  });

  it('in a group DM: only friends who are not in it, up to the slots left; Add posts them', async () => {
    setFriends([ann, bob, cy, dee]);
    const others = Array.from({ length: 5 }, (_, i) => makeUser({ id: `x${i}` }));
    const chat = makeChat({ id: 'g1', name: 'Crew', isGroupDm: true, memberCount: 8 });
    useChatMembersStore.setState({
      byChat: {
        g1: [member(ann, 'owner'), member(meUser), member(bob), ...others.map((u) => member(u))],
      },
    });
    const post = vi.spyOn(api, 'post').mockResolvedValue({ ...chat, memberCount: 9 } as never);
    vi.spyOn(api, 'get').mockResolvedValue([] as never);
    const { onClose } = renderPicker({ kind: 'add', chat });
    expect(screen.getAllByRole('checkbox')).toEqual([option('Cy'), option('Dee')]);
    expect(slots()).toHaveTextContent('You can add 2 more friends.');
    fireEvent.click(option('Cy'));
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(post).toHaveBeenCalledWith('/api/chats/g1/group-dm/members', { userIds: ['cy'] });
    expect(where()).toHaveTextContent(/^\/chats$/);
  });

  it('in a DM: a new group DM with the two of us and the friends picked', async () => {
    setFriends([ann, bob, cy]);
    const dm = makeChat({ id: 'd1', type: 'direct', name: null, peer: ann });
    const post = vi
      .spyOn(api, 'post')
      .mockResolvedValue(makeChat({ id: 'g2', name: null, isGroupDm: true }) as never);
    renderPicker({ kind: 'dm', chat: dm });
    expect(screen.queryByRole('checkbox', { name: /^Ann/ })).toBeNull();
    expect(slots()).toHaveTextContent('You can add 8 more friends.');
    fireEvent.click(option('Bob'));
    fireEvent.click(screen.getByRole('button', { name: 'Create Group DM' }));
    await waitFor(() => expect(where()).toHaveTextContent('/chats/g2'));
    expect(post).toHaveBeenCalledWith('/api/chats/group-dm', { userIds: ['ann', 'bob'] });
  });
});
