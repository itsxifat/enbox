/**
 * /preview/:spaceId: the Space header and its readable channels by category, the read-only
 * message view (no composer, toolbar or reaction buttons; pages fetched once), the phone list →
 * channel → list flow, the Join bar (the Discover join, landing on the channel being read),
 * members sent to the Space and Spaces that can't be previewed.
 */
import type * as MediaQuery from '@/hooks/useMediaQuery';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { SpaceDetail, SpacePreview, SpacePreviewMessages } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useDiscover } from '@/stores/discover';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { makeMe, makeMessage, makeUser } from '@/test/factories';
import { makeSpace } from '../spaces/testUtils';
import { SpacePreviewPage, channelGroups } from './SpacePreviewPage';

const media = vi.hoisted(() => ({ desktop: true }));
vi.mock('@/hooks/useMediaQuery', async (importOriginal) => ({
  ...(await importOriginal<typeof MediaQuery>()),
  useIsDesktop: () => media.desktop,
}));

const SPACE = 'space-1';

function preview(p: Partial<SpacePreview> = {}): SpacePreview {
  return {
    id: SPACE,
    name: 'Rocket Club',
    description: 'We build model rockets',
    iconUrl: null,
    bannerUrl: null,
    memberCount: 1234,
    onlineCount: 56,
    channels: [
      { id: 'c-welcome', name: 'welcome', topic: 'Say hi', categoryName: null, isNews: false },
      {
        id: 'c-general',
        name: 'general',
        topic: null,
        categoryName: 'Text channels',
        isNews: false,
      },
      { id: 'c-news', name: 'announcements', topic: null, categoryName: 'Info', isNews: true },
    ],
    ...p,
  };
}

const PAGES: Record<string, SpacePreviewMessages> = {
  'c-welcome': {
    messages: [
      makeMessage({
        id: 'm1',
        chatId: 'c-welcome',
        seq: 1,
        senderId: 'u-ann',
        text: 'Welcome aboard!',
      }),
    ],
  },
  'c-general': {
    messages: [
      makeMessage({
        id: 'm2',
        chatId: 'c-general',
        seq: 1,
        senderId: 'u-bob',
        text: 'Launch at noon',
        reactions: [{ emoji: '🚀', count: 3, userIds: [] }],
      }),
    ],
  },
  'c-news': { messages: [] },
};

function mockApi(answer: SpacePreview | Error = preview()) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string) => {
    if (path === `/api/spaces/${SPACE}/preview`) {
      if (answer instanceof Error) throw answer;
      return answer as never;
    }
    const m = /^\/api\/spaces\/space-1\/preview\/channels\/([^/]+)\/messages$/.exec(path);
    if (m && PAGES[m[1]!]) return PAGES[m[1]!] as never;
    throw new Error(`unexpected GET ${path}`);
  });
}
const pageCalls = (get: ReturnType<typeof mockApi>, channelId: string) =>
  get.mock.calls.filter(
    ([p]) => p === `/api/spaces/${SPACE}/preview/channels/${channelId}/messages`,
  ).length;

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{`${loc.pathname}${loc.search}`}</p>;
}

function renderAt(path = `/preview/${SPACE}`) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route
          path="/preview/:spaceId"
          element={
            <>
              <SpacePreviewPage />
              <Where />
            </>
          }
        />
        <Route path="/spaces/:spaceId/:chatId?" element={<Where />} />
        <Route path="/discover" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const bar = () => screen.getByTestId('preview-join-bar');

beforeEach(() => {
  media.desktop = true;
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useSpaces.setState({ byId: {}, order: [], loaded: true, channelsLoaded: {}, members: {} });
  useDiscover.setState({ spaces: [], total: 0, status: 'idle', joining: {} });
  useUsers.setState({
    byId: {
      'u-ann': makeUser({ id: 'u-ann', displayName: 'Ann' }),
      'u-bob': makeUser({ id: 'u-bob', displayName: 'Bob' }),
    },
  });
  useUi.setState({ toasts: [] });
});

describe('channelGroups', () => {
  it('groups consecutive channels of one category, in order', () => {
    const groups = channelGroups([
      ...preview().channels,
      { id: 'c-rules', name: 'rules', topic: null, categoryName: 'Info', isNews: false },
    ]);
    expect(groups.map((g) => [g.name, g.channels.map((c) => c.name)])).toEqual([
      [null, ['welcome']],
      ['Text channels', ['general']],
      ['Info', ['announcements', 'rules']],
    ]);
  });
});

describe('SpacePreviewPage', () => {
  it('desktop: the Space, its channels by category and the first channel, read-only', async () => {
    mockApi();
    renderAt();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Rocket Club' }),
    ).toBeInTheDocument();
    expect(screen.getByText('56 Online')).toBeInTheDocument();
    expect(screen.getByText('1,234 Members')).toBeInTheDocument();
    expect(screen.getByText('We build model rockets')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Discover' })).toHaveAttribute(
      'href',
      '/discover',
    );

    const nav = screen.getByRole('navigation', { name: 'Rocket Club channels' });
    expect(
      within(nav)
        .getAllByTestId('preview-channel-row')
        .map((a) => a.textContent),
    ).toEqual(['welcome', 'general', 'announcements']);
    expect(within(nav).getByRole('button', { name: 'Text channels' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(within(nav).getByRole('button', { name: 'Info' })).toBeInTheDocument();
    expect(within(nav).getByRole('link', { name: 'welcome' })).toHaveAttribute(
      'aria-current',
      'page',
    );

    // The first channel, read-only: its messages, no composer or message actions.
    expect(await screen.findByText('Welcome aboard!')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'welcome' })).toBeInTheDocument();
    expect(screen.getByText('Say hi')).toBeInTheDocument();
    // The author's avatar and name (profile cards still open).
    expect(screen.getAllByRole('button', { name: 'Profile of Ann' })).toHaveLength(2);
    expect(screen.getByText('Welcome to #welcome!')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('toolbar', { name: 'Message actions' })).toBeNull();
    expect(screen.queryByTestId('message-toolbar')).toBeNull();

    expect(bar()).toHaveTextContent(
      'You’re viewing Rocket Club. Join this Space to start chatting.',
    );
    expect(within(bar()).getByRole('button', { name: 'Join Space' })).toBeEnabled();
  });

  it('a picked channel is read once; reactions are counts, not buttons', async () => {
    const get = mockApi();
    renderAt();
    await screen.findByText('Welcome aboard!');
    fireEvent.click(screen.getByRole('link', { name: 'general' }));
    expect(await screen.findByText('Launch at noon')).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent('/preview/space-1?c=c-general');
    expect(screen.getByRole('link', { name: 'general' })).toHaveAttribute('aria-current', 'page');
    const reactions = screen.getByRole('list', { name: 'Reactions' });
    expect(within(reactions).getByLabelText('🚀 3')).toBeInTheDocument();
    expect(within(reactions).queryByRole('button')).toBeNull();

    fireEvent.click(screen.getByRole('link', { name: 'welcome' }));
    expect(await screen.findByText('Welcome aboard!')).toBeInTheDocument();
    expect(pageCalls(get, 'c-welcome')).toBe(1);
    expect(pageCalls(get, 'c-general')).toBe(1);

    // An empty channel: its beginning.
    fireEvent.click(screen.getByRole('link', { name: 'announcements' }));
    expect(await screen.findByText('Welcome to #announcements!')).toBeInTheDocument();
  });

  it('a collapsed category keeps only the open channel', async () => {
    mockApi();
    renderAt(`/preview/${SPACE}?c=c-general`);
    const nav = await screen.findByRole('navigation', { name: 'Rocket Club channels' });
    fireEvent.click(within(nav).getByRole('button', { name: 'Info' }));
    expect(within(nav).queryByRole('link', { name: 'announcements' })).toBeNull();
    fireEvent.click(within(nav).getByRole('button', { name: 'Text channels' }));
    expect(within(nav).getByRole('link', { name: 'general' })).toBeInTheDocument();
    expect(within(nav).getByRole('button', { name: 'Text channels' })).toHaveAttribute(
      'aria-expanded',
      'false',
    );
  });

  it('phones: the channel list, then a channel full screen with Back to the list', async () => {
    media.desktop = false;
    const get = mockApi();
    renderAt();
    expect(
      await screen.findByRole('navigation', { name: 'Rocket Club channels' }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('preview-messages')).toBeNull();
    expect(bar()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('link', { name: 'general' }));
    expect(await screen.findByText('Launch at noon')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Rocket Club channels' })).toBeNull();
    expect(bar()).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to channels' }));
    expect(
      await screen.findByRole('navigation', { name: 'Rocket Club channels' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/preview\/space-1$/);
    expect(pageCalls(get, 'c-welcome')).toBe(0);
  });

  it('Join joins like Discover and opens the channel being read', async () => {
    mockApi();
    const detail: SpaceDetail = {
      space: makeSpace({ id: SPACE, name: 'Rocket Club' }),
      channels: [],
    };
    const post = vi.spyOn(api, 'post').mockResolvedValue(detail as never);
    renderAt(`/preview/${SPACE}?c=c-general`);
    await screen.findByText('Launch at noon');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Join Space' }));
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent('/spaces/space-1/c-general'),
    );
    expect(post).toHaveBeenCalledWith('/api/discover/spaces/space-1/join');
    expect(useSpaces.getState().byId[SPACE]?.name).toBe('Rocket Club');
  });

  it('a failed join says why and stays', async () => {
    mockApi();
    vi.spyOn(api, 'post').mockRejectedValue(
      new ApiError('forbidden', 'You are banned from this Space', 403),
    );
    renderAt();
    await screen.findByText('Welcome aboard!');
    fireEvent.click(within(bar()).getByRole('button', { name: 'Join Space' }));
    await waitFor(() =>
      expect(useUi.getState().toasts.map((t) => t.message)).toContain(
        'You are banned from this Space',
      ),
    );
    expect(screen.getByTestId('where')).toHaveTextContent('/preview/space-1');
  });

  it('members open the Space itself', async () => {
    const get = mockApi();
    useSpaces.setState({ byId: { [SPACE]: makeSpace({ id: SPACE }) } });
    renderAt();
    await waitFor(() =>
      expect(screen.getByTestId('where')).toHaveTextContent(/^\/spaces\/space-1$/),
    );
    expect(pageCalls(get, 'c-welcome')).toBe(0);
  });

  it('a Space that is not listed (404) cannot be previewed', async () => {
    mockApi(new ApiError('not_found', 'Space not found', 404));
    renderAt();
    expect(await screen.findByText('This Space can’t be previewed')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to Discover' })).toHaveAttribute(
      'href',
      '/discover',
    );
    expect(screen.queryByTestId('preview-join-bar')).toBeNull();
  });
});
