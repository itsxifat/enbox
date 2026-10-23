/** The phone You tab: my profile card and the rows to Friends, Collectibles, Updates, Calls, Settings. */
import type * as MediaQuery from '@/hooks/useMediaQuery';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { RouterProvider, createMemoryRouter } from 'react-router';
import { useAuth } from '@/stores/auth';
import { useFriends } from '@/stores/friends';
import { makeMe } from '@/test/factories';
import { YouPage } from './YouPage';

const media = vi.hoisted(() => ({ desktop: false }));
vi.mock('@/hooks/useMediaQuery', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaQuery>()),
  useIsDesktop: () => media.desktop,
}));

/** jsdom's AbortSignal is not the one Node's fetch `Request` accepts; the router needs only these. */
class TestRequest {
  url: string;
  signal: AbortSignal | undefined;
  method = 'GET';
  constructor(url: string | URL, init?: { signal?: AbortSignal }) {
    this.url = String(url);
    this.signal = init?.signal;
  }
}

function renderPage() {
  const target = (name: string) => <p>{name} route</p>;
  const router = createMemoryRouter(
    [
      { path: '/you', element: <YouPage /> },
      { path: '/you/friends', element: target('Friends') },
      { path: '/collectibles', element: target('Collectibles') },
      { path: '/updates', element: target('Updates') },
      { path: '/calls', element: target('Calls') },
      { path: '/settings', element: target('Settings') },
      { path: '/settings/profile', element: target('Edit profile') },
      { path: '/chats', element: target('Home') },
    ],
    { initialEntries: ['/you'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

beforeEach(() => {
  vi.stubGlobal('Request', TestRequest);
  media.desktop = false;
  useAuth.setState({
    user: makeMe({ id: 'me', username: 'ada', displayName: 'Ada Lovelace' }),
    token: 't',
    status: 'authenticated',
  });
  useFriends.setState({ incoming: [], outgoing: [], loaded: true });
});

describe('You page', () => {
  it('shows my profile card with its status controls', () => {
    renderPage();
    const card = screen.getByTestId('profile-card');
    expect(card).toHaveTextContent('Ada Lovelace');
    expect(within(card).getByTestId('availability-picker')).toBeInTheDocument();
    expect(within(card).getByTestId('set-status')).toBeInTheDocument();
  });

  it.each([
    ['Friends', '/you/friends'],
    ['Collectibles', '/collectibles'],
    ['Updates', '/updates'],
    ['Calls', '/calls'],
    ['Settings', '/settings'],
  ])('the %s row opens %s', async (label, path) => {
    const router = renderPage();
    fireEvent.click(screen.getByTestId(`you-row-${label.toLowerCase()}`));
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    expect(screen.getByText(`${label} route`)).toBeInTheDocument();
    // In-app state: the page's Back arrow returns to You.
    expect(router.state.location.state).toEqual({ fromApp: true });
  });

  it('Edit profile and the header gear lead to settings', async () => {
    const router = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/profile'));

    await act(async () => {
      await router.navigate('/you');
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('badges Friends with my pending requests', () => {
    useFriends.setState({
      incoming: [
        { userId: 'u2', createdAt: '2026-01-01T00:00:00.000Z' },
        { userId: 'u3', createdAt: '2026-01-01T00:00:00.000Z' },
      ],
    });
    renderPage();
    expect(
      within(screen.getByTestId('you-row-friends')).getByLabelText('2 friend requests'),
    ).toHaveTextContent('2');
  });

  it('goes Home on desktop (no You tab there)', async () => {
    media.desktop = true;
    const router = renderPage();
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
  });
});
