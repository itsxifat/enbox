import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import type { UserProfile } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { makeMe, makeUser } from '@/test/factories';
import { UserProfilePage } from './UserProfilePage';

const bob = makeUser({ id: 'bob', username: 'bobstone', displayName: 'Bob Stone', bio: 'Climber' });
const profile: UserProfile = {
  user: bob,
  mutualSpaces: [{ id: 'sp1', name: 'Climbers', iconUrl: null, nickname: null }],
  mutualFriends: [],
  mutualGroupCount: 0,
  note: null,
};

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/u/:username" element={<UserProfilePage />} />
        <Route path="/users/:userId" element={<UserProfilePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  vi.spyOn(api, 'post').mockResolvedValue([]);
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === '/api/users/by-username/bobstone') return bob;
    if (path === '/api/users/bob/profile') return profile;
    throw new ApiError('not_found', 'User not found', 404);
  });
});

describe('UserProfilePage', () => {
  it('/u/:username looks the user up and shows the full profile', async () => {
    renderAt('/u/BobStone');
    const view = await screen.findByTestId('full-profile');
    expect(api.get).toHaveBeenCalledWith('/api/users/by-username/bobstone');
    expect(within(view).getByTestId('full-profile-name')).toHaveTextContent('Bob Stone');
    expect(within(view).getByTestId('full-profile-bio')).toHaveTextContent('Climber');
    await waitFor(() =>
      expect(within(view).getByRole('tab', { name: 'Mutual Spaces (1)' })).toBeInTheDocument(),
    );
    expect(within(view).getByRole('button', { name: 'Message' })).toBeInTheDocument();
    // A page, not a dialog: no close button on the banner.
    expect(within(view).queryByRole('button', { name: 'Close' })).toBeNull();
  });

  it('/users/:userId takes the id directly', async () => {
    renderAt('/users/bob');
    expect(await screen.findByTestId('full-profile-name')).toHaveTextContent('Bob Stone');
    expect(api.get).not.toHaveBeenCalledWith(expect.stringContaining('by-username'));
    expect(api.get).toHaveBeenCalledWith('/api/users/bob/profile');
  });

  it('an unknown username says so', async () => {
    renderAt('/u/nobody');
    expect(await screen.findByText('No one found')).toBeInTheDocument();
    expect(screen.getByText(/no Enbox account with the username @nobody/)).toBeInTheDocument();
  });
});
