/**
 * The desktop User Settings layer over the still-mounted app (background-location pattern),
 * its nav and search, closing (Esc / ✕) back to the exact page, and the unsaved-changes guard.
 */
import type * as MediaQuery from '@/hooks/useMediaQuery';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import {
  RouterProvider,
  createMemoryRouter,
  useLocation,
  useParams,
  type RouteObject,
} from 'react-router';
import { AppShell } from '@/components/layout/AppShell';
import { useAuth } from '@/stores/auth';
import { useQuickSwitcher } from '@/stores/quickSwitcher';
import { makeMe } from '@/test/factories';
import { settingsRoutes } from './routes';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useMediaQuery', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaQuery>()),
  useIsDesktop: () => media.desktop,
}));

// The shell's heavy neighbours; the sidebar reports the params and location it sees.
vi.mock('@/features/spaces/SpaceRail', () => ({ SpaceRail: () => <nav aria-label="Rail" /> }));
vi.mock('@/features/home/HomeSidebar', async () => {
  const { useLocation: useLoc, useParams: useP } = await import('react-router');
  return {
    HomeSidebar: () => {
      const { chatId } = useP();
      const { pathname } = useLoc();
      return <aside data-testid="home-sidebar" data-chat={chatId ?? ''} data-path={pathname} />;
    },
  };
});
vi.mock('@/components/layout/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
vi.mock('@/features/calls/CallOverlay', () => ({ CallOverlay: () => null }));
vi.mock('@/features/profile/ProfileCardHost', () => ({ ProfileCardHost: () => null }));
vi.mock('@/features/quickSwitcher/KeyboardShortcuts', () => ({ KeyboardShortcuts: () => null }));

// Settings → Profiles with unsaved changes: the real guard, a counter for its shakes.
vi.mock('@/features/settings/profile/ProfilePage', async () => {
  const { useState: useS } = await import('react');
  const { UnsavedChangesGuard } = await import('@/features/settings/profile/UnsavedChangesBar');
  return {
    ProfilePage: () => {
      const [shakes, setShakes] = useS(0);
      return (
        <div data-testid="dirty-profile" data-shakes={shakes}>
          <UnsavedChangesGuard when onBlocked={() => setShakes((n) => n + 1)} />
        </div>
      );
    },
  };
});

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

function Counter({ label }: { label: string }) {
  const [n, setN] = useState(0);
  return (
    <button type="button" onClick={() => setN((c) => c + 1)}>
      {label} {n}
    </button>
  );
}

function ChatPage() {
  const { chatId } = useParams();
  const { pathname, search } = useLocation();
  return (
    <div data-testid="chat-page" data-path={pathname + search}>
      <Counter label={`chat ${chatId}`} />
    </div>
  );
}

function renderApp(path: string) {
  const routes: RouteObject[] = [
    {
      element: <AppShell />,
      children: [
        { path: 'chats', element: <Counter label="home" /> },
        { path: 'chats/:chatId', element: <ChatPage /> },
        { path: 'you/friends', element: <p>Phone friends</p> },
        ...settingsRoutes,
      ],
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

const layer = () => screen.queryByRole('dialog', { name: 'User Settings' });
/** The section's title in the layer (lazy chunks: the first one takes a moment). */
const title = (name: string) => screen.findByRole('heading', { name, level: 1 }, { timeout: 5000 });
const escape = () => fireEvent.keyDown(window, { key: 'Escape' });

async function go(router: ReturnType<typeof renderApp>, to: string, state?: unknown) {
  await act(async () => {
    await router.navigate(to, { state });
  });
}

beforeEach(() => {
  vi.stubGlobal('Request', TestRequest);
  media.desktop = true;
  useAuth.setState({
    user: makeMe({ id: 'me', username: 'ada', displayName: 'Ada' }),
    token: 't',
    status: 'authenticated',
  });
});

afterEach(() => {
  useQuickSwitcher.setState({ open: false, shortcutsOpen: false });
});

describe('User Settings layer (desktop)', () => {
  it('opens over the page it came from, which stays mounted, inert and with its state', async () => {
    const router = renderApp('/chats/c1');
    fireEvent.click(screen.getByRole('button', { name: 'chat c1 0' }));
    expect(screen.getByRole('button', { name: 'chat c1 1' })).toBeInTheDocument();

    await go(router, '/settings/account', { backgroundLocation: router.state.location });
    await title('My Account');
    expect(layer()).toBeInTheDocument();

    const base = screen.getByTestId('app-base');
    expect(base).toHaveAttribute('inert');
    expect(base).toHaveAttribute('aria-hidden', 'true');
    // Same instance (the click count survived), still seeing its own location and params.
    expect(within(base).getByText('chat c1 1')).toBeInTheDocument();
    expect(within(base).getByTestId('chat-page')).toHaveAttribute('data-path', '/chats/c1');
    expect(within(base).getByTestId('home-sidebar')).toHaveAttribute('data-chat', 'c1');
    expect(within(base).getByTestId('home-sidebar')).toHaveAttribute('data-path', '/chats/c1');
  });

  it('a link without background state opens over the current page too', async () => {
    const router = renderApp('/chats/c2');
    await go(router, '/settings/help');
    await title('Help');
    expect(within(screen.getByTestId('app-base')).getByText('chat c2 0')).toBeInTheDocument();
  });

  it('Esc returns to the exact previous location, across section switches and sub-pages', async () => {
    const router = renderApp('/chats/c1?m=5');
    fireEvent.click(screen.getByRole('button', { name: 'chat c1 0' }));
    await go(router, '/settings/account');
    await title('My Account');

    // Sections switch in place (replace) …
    fireEvent.click(screen.getByRole('link', { name: 'Help' }));
    await title('Help');
    expect(router.state.historyAction).toBe('REPLACE');
    fireEvent.click(screen.getByRole('link', { name: 'My Account' }));
    await title('My Account');
    // … sub-pages are pushed.
    fireEvent.click(screen.getByRole('link', { name: /Change password/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings/account/password'));
    expect(router.state.historyAction).toBe('PUSH');

    escape();
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c1'));
    expect(router.state.location.search).toBe('?m=5');
    expect(router.state.historyAction).toBe('POP');
    await waitFor(() => expect(layer()).toBeNull());
    expect(screen.getByTestId('app-base')).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'chat c1 1' })).toBeInTheDocument();
  });

  it('/settings opens on My Account; ✕ closes', async () => {
    const router = renderApp('/chats/c1');
    await go(router, '/settings');
    await title('My Account');
    expect(router.state.location.pathname).toBe('/settings/account');
    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats/c1'));
    await waitFor(() => expect(layer()).toBeNull());
  });

  it('a direct load shows the layer over Home, and closing goes Home', async () => {
    const router = renderApp('/settings/account');
    await title('My Account');
    const base = screen.getByTestId('app-base');
    expect(within(base).getByText('home 0')).toBeInTheDocument();
    expect(within(base).getByTestId('home-sidebar')).toHaveAttribute('data-path', '/chats');

    escape();
    await waitFor(() => expect(router.state.location.pathname).toBe('/chats'));
    expect(router.state.historyAction).toBe('REPLACE');
    await waitFor(() => expect(layer()).toBeNull());
  });

  it('gives focus back to what had it when the layer closes', async () => {
    const router = renderApp('/chats/c1');
    const opener = screen.getByRole('button', { name: 'chat c1 0' });
    opener.focus();
    await go(router, '/settings/account');
    await title('My Account');
    escape();
    await waitFor(() => expect(layer()).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it('the unsaved-changes guard blocks closing and switching while the profile is dirty', async () => {
    const router = renderApp('/chats/c1');
    await go(router, '/settings/profile');
    const page = await screen.findByTestId('dirty-profile', {}, { timeout: 5000 });

    escape();
    await waitFor(() => expect(page).toHaveAttribute('data-shakes', '1'));
    expect(router.state.location.pathname).toBe('/settings/profile');

    fireEvent.click(screen.getByRole('button', { name: 'Close settings' }));
    await waitFor(() => expect(page).toHaveAttribute('data-shakes', '2'));

    fireEvent.click(screen.getByRole('link', { name: 'My Account' }));
    await waitFor(() => expect(page).toHaveAttribute('data-shakes', '3'));
    expect(router.state.location.pathname).toBe('/settings/profile');
    expect(layer()).toBeInTheDocument();
  });

  it('groups the nav and filters it with the search box', async () => {
    const router = renderApp('/chats/c1');
    await go(router, '/settings/account');
    await title('My Account');
    const nav = screen.getByRole('navigation', { name: 'Settings' });
    const names = (el: HTMLElement) =>
      within(el)
        .queryAllByRole('link')
        .map((l) => l.textContent);

    expect(names(within(nav).getByRole('group', { name: 'User Settings' }))).toEqual([
      'My Account',
      'Profiles',
      'Privacy & Safety',
      'Devices',
    ]);
    const app = within(nav).getByRole('group', { name: 'App Settings' });
    expect(names(app)).toEqual([
      'Chats',
      'Accessibility',
      'Voice & Video',
      'Notifications',
      'Storage & Data',
      'Streamer Mode',
    ]);
    expect(within(app).getByRole('button', { name: 'Keybinds' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Log Out' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'My Account' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    const search = within(nav).getByRole('searchbox', { name: 'Search settings' });
    fireEvent.change(search, { target: { value: 'wallpaper' } });
    expect(names(nav)).toEqual(['Chats']);
    expect(within(nav).queryByRole('button', { name: 'Log Out' })).toBeNull();
    expect(within(nav).getByRole('status')).toHaveTextContent('1 result');

    // Escape clears the search, and only the next one closes settings.
    fireEvent.keyDown(search, { key: 'Escape' });
    expect(search).toHaveValue('');
    expect(layer()).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'zzz' } });
    expect(within(nav).getByTestId('settings-nav-empty')).toBeInTheDocument();

    // Enter opens the first match.
    fireEvent.change(search, { target: { value: 'help' } });
    fireEvent.keyDown(search, { key: 'Enter' });
    await title('Help');
    expect(router.state.location.pathname).toBe('/settings/help');

    // Keybinds opens the shortcuts list.
    fireEvent.click(within(nav).getByRole('button', { name: 'Keybinds' }));
    expect(useQuickSwitcher.getState().shortcutsOpen).toBe(true);
  });
});

describe('phones', () => {
  it('keep the full-screen settings list: no layer', async () => {
    media.desktop = false;
    renderApp('/settings');
    expect(
      await screen.findByRole('heading', { name: 'Settings' }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(layer()).toBeNull();
    expect(screen.getByTestId('app-base')).not.toHaveAttribute('inert');
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('send ?friends= links to the You tab’s Friends page', async () => {
    media.desktop = false;
    const router = renderApp('/chats?friends=pending');
    await waitFor(() => expect(router.state.location.pathname).toBe('/you/friends'));
    expect(router.state.location.search).toBe('?friends=pending');
    expect(screen.getByText('Phone friends')).toBeInTheDocument();
  });
});
