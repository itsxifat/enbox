import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import type { UserProfile, UserPublic } from '@enbox/shared';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useUsers } from '@/stores/users';
import { makeChat, makeMe, makeUser } from '@/test/factories';
import { openFullProfile } from './open';
import { ProfileCardHost } from './ProfileCardHost';

/** Flipped per test: desktop + fine pointer → popover, otherwise a modal/sheet. */
let matches = false;
window.matchMedia = (query: string): MediaQueryList =>
  ({
    get matches() {
      return matches;
    },
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList;

const amy = () => makeUser({ id: 'amy', username: 'amychen', displayName: 'Amy Chen' });
const bobUser = (p: Partial<UserPublic> = {}) =>
  makeUser({ id: 'bob', username: 'bobstone', displayName: 'Bob Stone', bio: 'Hi', ...p });

let profiles: Record<string, UserProfile>;

beforeEach(() => {
  resetSessionState();
  matches = false;
  // jsdom: the popover re-places itself on resize.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUsers.getState().upsertUsers([bobUser()]);
  profiles = {
    bob: {
      user: bobUser({ bio: 'Fresh bio' }),
      mutualSpaces: [{ id: 'sp1', name: 'Climbers', iconUrl: null, nickname: 'Boulder Bob' }],
      mutualFriends: [amy()],
      mutualGroupCount: 1,
      note: 'Met at the gym',
    },
    amy: { user: amy(), mutualSpaces: [], mutualFriends: [], mutualGroupCount: 0, note: null },
  };
  vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    const m = /^\/api\/users\/([^/]+)\/profile$/.exec(path);
    if (m) return profiles[m[1]!];
    if (path === '/api/users/bob/common-groups') return [makeChat({ id: 'g1', name: 'Hiking' })];
    return [];
  });
  vi.spyOn(api, 'post').mockResolvedValue([]);
});

function Path() {
  return <p data-testid="path">{useLocation().pathname}</p>;
}

function renderHost() {
  return render(
    <MemoryRouter initialEntries={['/chats']}>
      <Path />
      <ProfileCardHost />
    </MemoryRouter>,
  );
}

const fullProfile = () => screen.getByTestId('full-profile-modal');

describe('ProfileCardHost: popout', () => {
  it('opens the card from the bus, loads the full profile and closes on Escape', async () => {
    renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => bus.emit('profile:open', { userId: 'bob', anchor: null }));
    const dialog = screen.getByRole('dialog', { name: 'Profile' });
    expect(dialog).toHaveTextContent('Bob Stone');
    expect(dialog).toHaveTextContent('Hi');
    // Fresh profile on open: bio into the users store, mutuals and my note.
    await waitFor(() => expect(dialog).toHaveTextContent('Fresh bio'));
    expect(api.get).toHaveBeenCalledWith('/api/users/bob/profile');
    expect(within(dialog).getByTestId('card-mutuals')).toHaveTextContent('1 Mutual Friend');
    expect(within(dialog).getByRole('textbox', { name: 'Note' })).toHaveValue('Met at the gym');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is a ~300px popover beside the trigger on desktop with a fine pointer', () => {
    matches = true;
    renderHost();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    act(() => bus.emit('profile:open', { userId: 'bob', anchor: trigger }));
    const dialog = screen.getByRole('dialog', { name: 'Profile' });
    expect(dialog).toHaveAttribute('data-placement');
    expect(dialog.className).toContain('w-[300px]');
    expect(dialog).toHaveTextContent('Bob Stone');
    trigger.remove();
  });

  it('a phone gets the sheet even with an anchor; a second open replaces the first', () => {
    renderHost();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    act(() => bus.emit('profile:open', { userId: 'bob', anchor: trigger }));
    expect(screen.getByRole('dialog', { name: 'Profile' })).not.toHaveAttribute('data-placement');
    useUsers.getState().upsertUsers([amy()]);
    act(() => bus.emit('profile:open', { userId: 'amy', anchor: null }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Profile' })).toHaveTextContent('Amy Chen');
    trigger.remove();
  });

  it('the self popover survives a pointer in its availability menu and asks for a duration', async () => {
    matches = true;
    vi.spyOn(api, 'put').mockResolvedValue(makeMe({ id: 'me', availability: 'dnd' }));
    renderHost();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    act(() => bus.emit('profile:open', { userId: 'me', anchor: trigger }));
    fireEvent.click(screen.getByRole('button', { name: 'Availability: Online' }));
    // Menus are portals outside the popover: a real click starts with a pointerdown there.
    const dnd = screen.getByRole('menuitem', { name: 'Do not disturb' });
    fireEvent.pointerDown(dnd);
    fireEvent.click(dnd);
    expect(screen.getByRole('dialog', { name: 'Profile' })).toBeInTheDocument();
    const until = screen.getByRole('menuitem', { name: 'Until I change it' });
    fireEvent.pointerDown(until);
    fireEvent.click(until);
    await waitFor(() =>
      expect(api.put).toHaveBeenCalledWith('/api/me/presence', {
        availability: 'dnd',
        until: null,
      }),
    );
    expect(
      await screen.findByRole('button', { name: 'Availability: Do not disturb' }),
    ).toBeInTheDocument();
    trigger.remove();
  });

  it('my own id opens the self card; "Set a custom status" swaps it for the dialog', () => {
    renderHost();
    act(() => bus.emit('profile:open', { userId: 'me', anchor: null }));
    expect(screen.getByRole('button', { name: 'Availability: Online' })).toBeInTheDocument();
    expect(api.get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('set-status'));
    expect(screen.queryByRole('dialog', { name: 'Profile' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Set a custom status' })).toBeInTheDocument();
  });
});

describe('ProfileCardHost: full profile', () => {
  it('opens from the popout avatar in place of the popout, labelled by the name', async () => {
    renderHost();
    act(() => bus.emit('profile:open', { userId: 'bob', anchor: null }));
    fireEvent.click(screen.getByRole('button', { name: 'View full profile of Bob Stone' }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    const modal = screen.getByRole('dialog', { name: 'Bob Stone' });
    expect(modal).toBe(fullProfile());
    expect(modal).toHaveAttribute('aria-modal', 'true');
    await waitFor(() => expect(within(modal).getByTestId('full-profile-bio')).toHaveTextContent('Fresh bio'));
    expect(within(modal).getByTestId('card-member-since')).toBeInTheDocument();
    expect(within(modal).getByRole('textbox', { name: 'Note' })).toHaveValue('Met at the gym');
    // Escape closes it.
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByTestId('full-profile-modal')).toBeNull());
  });

  it('"View Full Profile" and the mutuals line open it on the right tab', async () => {
    renderHost();
    act(() => bus.emit('profile:open', { userId: 'bob', anchor: null }));
    await waitFor(() => expect(screen.getByTestId('card-mutuals')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '1 Mutual Space' }));
    const tab = within(fullProfile()).getByRole('tab', { name: 'Mutual Spaces (1)' });
    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(within(fullProfile()).getByRole('tabpanel')).toHaveTextContent('Climbers');
  });

  it('tabs: About Me, Mutual Spaces (opens the Space), Mutual Friends (opens their popout), Groups', async () => {
    renderHost();
    act(() => openFullProfile('bob'));
    const modal = fullProfile();
    await waitFor(() => expect(within(modal).getByRole('tab', { name: 'Mutual Friends (1)' })).toBeInTheDocument());
    expect(within(modal).getByRole('tab', { name: 'About Me' })).toHaveAttribute('aria-selected', 'true');

    fireEvent.click(within(modal).getByRole('tab', { name: 'Mutual Friends (1)' }));
    fireEvent.click(within(modal).getByRole('button', { name: /Amy Chen/ }));
    // Their popout stacks above the full profile.
    expect(screen.getByRole('dialog', { name: 'Profile' })).toHaveTextContent('Amy Chen');
    expect(screen.getByTestId('full-profile-modal')).toBeInTheDocument();
    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Profile' })).toBeNull());
    expect(screen.getByTestId('full-profile-modal')).toBeInTheDocument();

    fireEvent.click(within(modal).getByRole('tab', { name: 'Groups (1)' }));
    expect(await within(modal).findByRole('button', { name: 'Hiking' })).toBeInTheDocument();

    fireEvent.click(within(modal).getByRole('tab', { name: 'Mutual Spaces (1)' }));
    expect(within(modal).getByText('Boulder Bob')).toBeInTheDocument();
    fireEvent.click(within(modal).getByRole('button', { name: /Climbers/ }));
    // Navigating closes it.
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/spaces/sp1'));
    expect(screen.queryByTestId('full-profile-modal')).toBeNull();
  });

  it('my own full profile: no mutual tabs, Edit Profile', async () => {
    renderHost();
    act(() => openFullProfile('me'));
    const modal = fullProfile();
    expect(within(modal).queryByRole('tab')).toBeNull();
    expect(within(modal).queryByRole('textbox', { name: 'Note' })).toBeNull();
    fireEvent.click(within(modal).getByRole('button', { name: 'Edit Profile' }));
    await waitFor(() => expect(screen.getByTestId('path')).toHaveTextContent('/settings/profile'));
    expect(screen.queryByTestId('full-profile-modal')).toBeNull();
  });

  it('the close button closes it; an unknown user shows "No one found"', async () => {
    const { ApiError } = await import('@/lib/api');
    vi.mocked(api.get).mockImplementation(async () => {
      throw new ApiError('not_found', 'User not found', 404);
    });
    renderHost();
    act(() => openFullProfile('ghost'));
    expect(await within(fullProfile()).findByText('No one found')).toBeInTheDocument();
    fireEvent.click(within(fullProfile()).getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('full-profile-modal')).toBeNull();
  });
});
