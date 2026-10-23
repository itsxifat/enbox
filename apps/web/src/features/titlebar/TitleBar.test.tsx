/** The desktop title bar: Back / Forward along this tab's history (buttons and keys), the place, Help, What's New. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Outlet, RouterProvider, createMemoryRouter, useLocation, useNavigationType } from 'react-router';
import type { ChatSummary } from '@enbox/shared';
import { useChats } from '@/stores/chats';
import { useSpaces } from '@/stores/spaces';
import { makeChat, makeUser } from '@/test/factories';
import { makeSpace } from '@/features/spaces/testUtils';
import { useWhatsNew } from '@/features/whatsNew/store';
import { useHistoryKeys, useNavHistory, useNavHistoryTracking } from './history';
import { TitleBar } from './TitleBar';

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

/** What AppShell does for the bar. */
function Shell() {
  const location = useLocation();
  useNavHistoryTracking(location.key, useNavigationType());
  useHistoryKeys();
  return (
    <>
      <TitleBar location={location} />
      <Outlet />
    </>
  );
}

function renderBar(path: string) {
  const router = createMemoryRouter([{ element: <Shell />, children: [{ path: '*', element: <main /> }] }], {
    initialEntries: [path],
  });
  render(<RouterProvider router={router} />);
  return router;
}

const go = (router: ReturnType<typeof renderBar>, to: string | number) =>
  act(async () => {
    await (typeof to === 'number' ? router.navigate(to) : router.navigate(to));
  });

const button = (name: string) => screen.getByRole('button', { name });
const place = () => screen.getByTestId('title-bar-place');

describe('TitleBar', () => {
  beforeEach(() => {
    vi.stubGlobal('Request', TestRequest);
    const channel: ChatSummary = {
      ...makeChat({ id: 'c1', type: 'space_text', name: 'general' }),
      space: {
        spaceId: 's1',
        categoryId: null,
        position: 0,
        topic: null,
        slowmodeSeconds: 0,
        nsfw: false,
        userLimit: null,
        bitrate: null,
        permissionsSynced: true,
        overwrites: [],
      },
    };
    const dm = makeChat({ id: 'd1', type: 'direct', name: null, peer: makeUser({ id: 'ann', displayName: 'Ann Rivers' }) });
    useSpaces.setState({ byId: { s1: makeSpace({ id: 's1', name: 'Night Owls' }) }, order: ['s1'] });
    useChats.setState({ byId: { c1: channel, d1: dm } });
  });
  afterEach(() => {
    useNavHistory.setState({ trail: null });
    sessionStorage.clear();
    useWhatsNew.setState({ open: false, since: null });
    useSpaces.setState({ byId: {}, order: [] });
    useChats.setState({ byId: {} });
  });

  it('Back and Forward follow the history, disabled when there is nowhere to go', async () => {
    const router = renderBar('/chats');
    expect(button('Back')).toBeDisabled();
    expect(button('Forward')).toBeDisabled();

    await go(router, '/spaces/s1/c1');
    expect(button('Back')).toBeEnabled();
    expect(button('Forward')).toBeDisabled();

    await act(async () => fireEvent.click(button('Back')));
    expect(router.state.location.pathname).toBe('/chats');
    expect(button('Back')).toBeDisabled();
    expect(button('Forward')).toBeEnabled();

    await act(async () => fireEvent.click(button('Forward')));
    expect(router.state.location.pathname).toBe('/spaces/s1/c1');
    expect(button('Back')).toHaveAttribute('aria-keyshortcuts', 'Alt+ArrowLeft');
  });

  it('Alt+← and Alt+→ go back and forward; with nowhere to go the key is left alone', async () => {
    const router = renderBar('/chats');
    expect(fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })).toBe(true);

    await go(router, '/message-requests');
    await act(async () => {
      expect(fireEvent.keyDown(window, { key: 'ArrowLeft', altKey: true })).toBe(false);
    });
    expect(router.state.location.pathname).toBe('/chats');
    await act(async () => {
      fireEvent.keyDown(window, { key: 'ArrowRight', altKey: true });
    });
    expect(router.state.location.pathname).toBe('/message-requests');
  });

  it('shows where I am: the channel and its Space, a DM, Home’s Friends', async () => {
    const router = renderBar('/spaces/s1/c1');
    expect(place()).toHaveTextContent('#general · Night Owls');
    await go(router, '/spaces/s1/guide');
    expect(place()).toHaveTextContent('Server Guide · Night Owls');
    await go(router, '/chats/d1');
    expect(place()).toHaveTextContent('Ann Rivers');
    await go(router, '/chats');
    expect(place()).toHaveTextContent('Friends');
  });

  it('Help opens the Help page over this page; What’s New opens the changelog', async () => {
    const router = renderBar('/chats/d1');
    fireEvent.click(button('What’s New'));
    expect(useWhatsNew.getState()).toMatchObject({ open: true, since: null });

    await act(async () => fireEvent.click(button('Help')));
    expect(router.state.location.pathname).toBe('/settings/help');
    expect(router.state.location.state).toMatchObject({ backgroundLocation: { pathname: '/chats/d1' } });
  });
});
