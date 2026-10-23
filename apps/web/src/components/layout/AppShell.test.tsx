/** The shell's frame: the desktop title bar, Home's sidebar in the resizable frame, reopening the last place. */
import type * as MediaQuery from '@/hooks/useMediaQuery';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Navigate, RouterProvider, createMemoryRouter, type RouteObject } from 'react-router';
import { rememberLocation } from '@/features/frame/lastLocation';
import { useNavHistory } from '@/features/titlebar/history';
import { useAuth } from '@/stores/auth';
import { makeMe } from '@/test/factories';
import { AppShell } from './AppShell';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useMediaQuery', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaQuery>()),
  useIsDesktop: () => media.desktop,
}));
vi.mock('@/features/spaces/SpaceRail', () => ({ SpaceRail: () => <nav aria-label="Rail" /> }));
vi.mock('@/features/home/HomeSidebar', () => ({ HomeSidebar: () => <aside aria-label="Home" /> }));
vi.mock('@/components/layout/ConnectionBanner', () => ({ ConnectionBanner: () => null }));
vi.mock('@/features/calls/CallOverlay', () => ({ CallOverlay: () => null }));
vi.mock('@/features/profile/ProfileCardHost', () => ({ ProfileCardHost: () => null }));
vi.mock('@/features/quickSwitcher/KeyboardShortcuts', () => ({ KeyboardShortcuts: () => null }));

class TestRequest {
  url: string;
  signal: AbortSignal | undefined;
  method = 'GET';
  constructor(url: string | URL, init?: { signal?: AbortSignal }) {
    this.url = String(url);
    this.signal = init?.signal;
  }
}

function renderApp(path: string) {
  const routes: RouteObject[] = [
    {
      element: <AppShell />,
      children: [
        { index: true, element: <Navigate to="/chats" replace /> },
        { path: 'chats', element: <p>Friends page</p> },
        { path: 'chats/:chatId', element: <p>A chat</p> },
        { path: 'spaces/*', element: <p>A Space</p> },
      ],
    },
  ];
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('AppShell frame', () => {
  beforeEach(() => {
    vi.stubGlobal('Request', TestRequest);
    media.desktop = true;
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  });
  afterEach(() => {
    useNavHistory.setState({ trail: null });
    sessionStorage.clear();
  });

  it('desktop: the title bar on top, with Back once there is somewhere to go back to', async () => {
    const router = renderApp('/chats/d1');
    const bar = screen.getByTestId('title-bar');
    expect(screen.getByRole('link', { name: 'Skip to content' }).compareDocumentPosition(bar)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();

    await act(async () => {
      await router.navigate('/spaces/s1');
    });
    expect(screen.getByRole('button', { name: 'Back' })).toBeEnabled();
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true });
    });
    expect(router.state.location.pathname).toBe('/chats/d1');
    expect(screen.getByRole('button', { name: 'Forward' })).toBeEnabled();
  });

  it('desktop: Home’s sidebar sits in the resizable frame', () => {
    renderApp('/chats');
    expect(screen.getByTestId('sidebar-frame')).toContainElement(screen.getByRole('complementary', { name: 'Home' }));
    expect(screen.getByRole('separator', { name: 'Resize sidebar' })).toHaveAttribute('aria-valuenow', '264');
  });

  it('phones: no title bar and no frame', () => {
    media.desktop = false;
    renderApp('/chats');
    expect(screen.queryByTestId('title-bar')).toBeNull();
    expect(screen.queryByTestId('sidebar-frame')).toBeNull();
  });

  it('a start on the front door reopens the last place', async () => {
    rememberLocation('me', '/spaces/s1/c1');
    const router = renderApp('/');
    await waitFor(() => expect(router.state.location.pathname).toBe('/spaces/s1/c1'));
    expect(screen.getByText('A Space')).toBeInTheDocument();
  });
});
