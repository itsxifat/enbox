/** Where I was: what is worth reopening, the start redirect, Home's last page. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';
import { Navigate, Outlet, RouterProvider, createMemoryRouter, useLocation } from 'react-router';
import {
  isHomeRoute,
  isRestorable,
  lastRoute,
  rememberLocation,
  startRedirect,
  useLastHome,
  useLastLocation,
} from './lastLocation';

class TestRequest {
  url: string;
  signal: AbortSignal | undefined;
  method = 'GET';
  constructor(url: string | URL, init?: { signal?: AbortSignal }) {
    this.url = String(url);
    this.signal = init?.signal;
  }
}

const at = (pathname: string, search = '', hash = '') => ({ pathname, search, hash });

describe('what is worth reopening', () => {
  it('conversations, Spaces and their channels and pages, the main pages; not settings or one-offs', () => {
    for (const p of ['/chats', '/chats/d1', '/starred/d1', '/spaces', '/spaces/s1', '/spaces/s1/c1', '/spaces/s1/guide', '/discover', '/message-requests'])
      expect(isRestorable(p)).toBe(true);
    for (const p of ['/', '/settings/help', '/spaces/s1/settings', '/spaces/s1/settings/roles', '/join/abc', '/preview/s1', '/new', '/users/u1'])
      expect(isRestorable(p)).toBe(false);
    expect(isHomeRoute('/chats/d1')).toBe(true);
    expect(isHomeRoute('/spaces/s1')).toBe(false);
  });
});

describe('rememberLocation and startRedirect', () => {
  afterEach(() => useLastHome.setState({ userId: null, path: null }));

  it('keeps the last route per account, and Home’s last page live', () => {
    rememberLocation('me', '/chats/d1');
    rememberLocation('me', '/spaces/s1/c1');
    rememberLocation('me', '/settings/account');
    expect(lastRoute('me')).toBe('/spaces/s1/c1');
    expect(lastRoute('someone')).toBeNull();
    expect(useLastHome.getState()).toEqual({ userId: 'me', path: '/chats/d1' });
  });

  it('reopens it from the front door only: `/` or a plain `/chats`', () => {
    rememberLocation('me', '/spaces/s1/c1');
    expect(startRedirect('me', at('/'))).toEqual({ from: '/', to: '/spaces/s1/c1' });
    expect(startRedirect('me', at('/chats'))).toEqual({ from: '/chats', to: '/spaces/s1/c1' });
    expect(startRedirect('me', at('/chats', '?friends=pending'))).toBeNull();
    expect(startRedirect('me', at('/chats/d2'))).toBeNull();
    expect(startRedirect('someone', at('/'))).toBeNull();
    expect(startRedirect(null, at('/'))).toBeNull();
    rememberLocation('me', '/chats');
    expect(startRedirect('me', at('/chats'))).toBeNull();
  });
});

describe('useLastLocation', () => {
  beforeEach(() => {
    vi.stubGlobal('Request', TestRequest);
    sessionStorage.clear();
  });

  function Shell() {
    const to = useLastLocation('me', useLocation());
    return to ? <Navigate to={to} replace /> : <Outlet />;
  }

  function renderApp(path: string) {
    const router = createMemoryRouter(
      [{ element: <Shell />, children: [{ path: '*', element: <p data-testid="page" /> }] }],
      { initialEntries: [path] },
    );
    render(<RouterProvider router={router} />);
    return router;
  }

  it('starts on the last place, then remembers where I go; the front door later stays put', async () => {
    rememberLocation('me', '/spaces/s1/c1');
    const router = renderApp('/chats');
    await waitFor(() => expect(router.state.location.pathname).toBe('/spaces/s1/c1'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.getByTestId('page')).toBeInTheDocument();

    await act(async () => {
      await router.navigate('/spaces/s2/c9');
    });
    expect(lastRoute('me')).toBe('/spaces/s2/c9');
    await act(async () => {
      await router.navigate('/chats');
    });
    expect(router.state.location.pathname).toBe('/chats');
    expect(lastRoute('me')).toBe('/chats');
  });

  it('restores only on the first start in a tab, not on a reload of the front door', async () => {
    rememberLocation('me', '/spaces/s1/c1');
    renderApp('/spaces/s1/c1').dispose();
    const router = renderApp('/chats');
    await act(async () => {});
    expect(router.state.location.pathname).toBe('/chats');
  });

  it('a deep link opens where it points', () => {
    rememberLocation('me', '/spaces/s1/c1');
    const router = renderApp('/chats/d7');
    expect(router.state.location.pathname).toBe('/chats/d7');
    expect(lastRoute('me')).toBe('/chats/d7');
  });
});
