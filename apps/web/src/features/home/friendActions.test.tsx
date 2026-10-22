/** Friend actions where they live outside the Friends page: the profile "..." menu and Settings → Privacy. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import type { UserPublic } from '@enbox/shared';
import { ProfileMoreMenu } from '@/features/profile/ProfileMoreMenu';
import { FriendRequestSettings } from '@/features/settings/privacy/FriendRequestSettings';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useFriends } from '@/stores/friends';
import { useUi } from '@/stores/ui';
import { makeMe, makeUser } from '@/test/factories';

beforeEach(() => {
  resetSessionState();
  vi.restoreAllMocks();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
  // Refetches after a send (not under test here).
  vi.spyOn(api, 'get').mockResolvedValue({ incoming: [], outgoing: [] });
});

function openMenu(user: UserPublic) {
  const view = render(
    <MemoryRouter>
      <ProfileMoreMenu user={user} />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  return view;
}

const item = (name: string) => screen.getByRole('menuitem', { name });

describe('profile menu friend actions', () => {
  it('Add Friend sends a request by id', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ status: 'sent' });
    openMenu(makeUser({ id: 'zoe', displayName: 'Zoe' }));
    fireEvent.click(item('Add Friend'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/friends/requests', { userId: 'zoe' }));
    await waitFor(() =>
      expect(useUi.getState().toasts.at(-1)?.message).toBe('Friend request sent to Zoe'),
    );
  });

  it('Cancel Request for mine, Accept / Ignore for theirs', async () => {
    useFriends.setState({ outgoing: [{ userId: 'out', createdAt: '' }], incoming: [{ userId: 'in', createdAt: '' }], loaded: true });
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    const post = vi.spyOn(api, 'post').mockResolvedValue(undefined);
    const first = openMenu(makeUser({ id: 'out' }));
    expect(screen.queryByRole('menuitem', { name: 'Add Friend' })).toBeNull();
    fireEvent.click(item('Cancel Request'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/friends/requests/out'));
    first.unmount();

    openMenu(makeUser({ id: 'in' }));
    expect(item('Ignore Friend Request')).toBeInTheDocument();
    fireEvent.click(item('Accept Friend Request'));
    await waitFor(() => expect(post).toHaveBeenCalledWith('/api/friends/requests/in/accept'));
  });

  it('Remove Friend for a friend (after a confirm); nothing to add for someone I blocked', async () => {
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    const first = openMenu(makeUser({ id: 'pal', displayName: 'Pal', isContact: true }));
    expect(screen.queryByRole('menuitem', { name: 'Add Friend' })).toBeNull();
    fireEvent.click(item('Remove Friend'));
    const dialog = useUi.getState().dialogs[0]!;
    act(() => useUi.getState().closeDialog(dialog.id, 'confirm'));
    await waitFor(() => expect(del).toHaveBeenCalledWith('/api/friends/pal'));
    first.unmount();

    openMenu(makeUser({ id: 'bad', isBlocked: true }));
    expect(screen.queryByRole('menuitem', { name: 'Add Friend' })).toBeNull();
    expect(item('Unblock')).toBeInTheDocument();
  });
});

describe('Settings → Privacy → Friend requests', () => {
  it('shows my choice and saves a new one', async () => {
    const patch = vi
      .spyOn(api, 'patch')
      .mockImplementation(async (_path: string, body?: unknown) => ({ ...makeMe().settings, ...(body as object) }) as never);
    render(<FriendRequestSettings />);
    const select = screen.getByLabelText('Friend requests');
    expect(select).toHaveValue('everyone');
    fireEvent.change(select, { target: { value: 'spaces' } });
    await waitFor(() => expect(patch).toHaveBeenCalledWith('/api/me/settings', { friendRequestsFrom: 'spaces' }));
    expect(useAuth.getState().user?.settings.friendRequestsFrom).toBe('spaces');
    expect(screen.getByLabelText('Friend requests')).toHaveValue('spaces');
  });
});
