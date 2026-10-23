import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useAuth } from '@/stores/auth';
import { useIgnores } from '@/stores/ignores';
import { useUi } from '@/stores/ui';
import { makeMe, makeUser } from '@/test/factories';
import { IgnoredPage } from './IgnoredPage';
import { IgnoredUsersRow } from './IgnoredUsersRow';

const alpha = makeUser({ id: 'a', displayName: 'Alpha', username: 'alpha' });
const beta = makeUser({ id: 'b', displayName: 'Beta', username: 'beta' });

beforeEach(() => {
  resetSessionState();
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useUi.setState({ toasts: [], dialogs: [] });
});
afterEach(() => vi.restoreAllMocks());

describe('Settings ▸ Privacy ▸ Ignored users', () => {
  it('loads the list, searches it and unignores', async () => {
    const get = vi.spyOn(api, 'get').mockResolvedValue([beta, alpha]);
    const del = vi.spyOn(api, 'delete').mockResolvedValue(undefined);
    render(<IgnoredPage />);
    const list = await screen.findByRole('list', { name: 'Ignored users' });
    expect(get).toHaveBeenCalledWith('/api/me/ignores');
    expect(
      within(list)
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual([expect.stringContaining('Beta'), expect.stringContaining('Alpha')]);
    expect(screen.getByText('Ignored (2)')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search ignored users' }), {
      target: { value: 'alp' },
    });
    expect(within(list).getAllByRole('listitem')).toHaveLength(1);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search ignored users' }), {
      target: { value: 'zzz' },
    });
    expect(screen.getByText('No one matches “zzz”.')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search ignored users' }), {
      target: { value: '' },
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Unignore Alpha' }));
    });
    expect(del).toHaveBeenCalledWith('/api/users/a/ignore');
    expect(useIgnores.getState().ids).toEqual(['b']);
    expect(screen.queryByText('Alpha')).not.toBeInTheDocument();
    expect(useUi.getState().toasts.map((t) => t.message)).toContain('Alpha is no longer ignored');
  });

  it('shows an empty state, and the Privacy row counts them', async () => {
    vi.spyOn(api, 'get').mockResolvedValue([]);
    render(
      <MemoryRouter>
        <IgnoredUsersRow />
        <IgnoredPage />
      </MemoryRouter>,
    );
    expect(await screen.findByText('No ignored users')).toBeInTheDocument();
    expect(screen.getByTestId('privacy-ignored')).toHaveTextContent('None');
    act(() => useIgnores.getState().apply(['a', 'b']));
    expect(screen.getByTestId('privacy-ignored')).toHaveTextContent('2');
    expect(screen.getByTestId('privacy-ignored')).toHaveAttribute(
      'href',
      '/settings/privacy/ignored',
    );
  });
});
