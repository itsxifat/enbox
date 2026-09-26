import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useUsers } from '@/stores/users';
import { makeMe, makeUser } from '@/test/factories';
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
  useUsers.getState().upsertUsers([makeUser({ id: 'bob', displayName: 'Bob Stone', bio: 'Hi' })]);
  vi.spyOn(api, 'get').mockResolvedValue([]);
  vi.spyOn(api, 'post').mockResolvedValue([]);
});

function renderHost() {
  return render(
    <MemoryRouter>
      <ProfileCardHost />
    </MemoryRouter>,
  );
}

describe('ProfileCardHost', () => {
  it('opens the card from the bus, refetches the profile and closes on Escape', async () => {
    renderHost();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => bus.emit('profile:open', { userId: 'bob', anchor: null }));
    const dialog = screen.getByRole('dialog', { name: 'Profile' });
    expect(dialog).toHaveTextContent('Bob Stone');
    expect(dialog).toHaveTextContent('Hi');
    // A forced refetch on open (bio / colours may have changed since it was cached).
    await waitFor(() =>
      expect(api.post).toHaveBeenCalledWith('/api/users/batch', { userIds: ['bob'] }),
    );
    expect(api.get).toHaveBeenCalledWith('/api/users/bob/common-groups');

    fireEvent.keyDown(window, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('is a popover beside the trigger on desktop with a fine pointer', () => {
    matches = true;
    renderHost();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    act(() => bus.emit('profile:open', { userId: 'bob', anchor: trigger }));
    const dialog = screen.getByRole('dialog', { name: 'Profile' });
    expect(dialog).toHaveAttribute('data-placement');
    expect(dialog).toHaveTextContent('Bob Stone');
    trigger.remove();
  });

  it('a phone gets the sheet even with an anchor; a second open replaces the first', () => {
    renderHost();
    const trigger = document.createElement('button');
    document.body.appendChild(trigger);
    act(() => bus.emit('profile:open', { userId: 'bob', anchor: trigger }));
    expect(screen.getByRole('dialog', { name: 'Profile' })).not.toHaveAttribute('data-placement');
    useUsers.getState().upsertUsers([makeUser({ id: 'amy', displayName: 'Amy Chen' })]);
    act(() => bus.emit('profile:open', { userId: 'amy', anchor: null }));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Profile' })).toHaveTextContent('Amy Chen');
    trigger.remove();
  });

  it('my own id opens the self card; "Set a custom status" swaps it for the dialog', () => {
    renderHost();
    act(() => bus.emit('profile:open', { userId: 'me', anchor: null }));
    expect(screen.getByRole('button', { name: 'Availability: Online' })).toBeInTheDocument();
    expect(api.post).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('set-status'));
    expect(screen.queryByRole('dialog', { name: 'Profile' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Set a custom status' })).toBeInTheDocument();
  });
});
