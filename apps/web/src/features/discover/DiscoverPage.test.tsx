/** /discover: hero and search, category chips, the card grid with Join / Joined, paging, empty state. */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import type { DiscoverableSpace, DiscoveryPage, SpaceDetail } from '@enbox/shared';
import { api, type RequestOptions } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useDiscover } from '@/stores/discover';
import { useSpaces } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { makeMe } from '@/test/factories';
import { makeSpace } from '../spaces/testUtils';
import { DiscoverPage } from './DiscoverPage';

const card = (id: string, name: string, p: Partial<DiscoverableSpace> = {}): DiscoverableSpace => ({
  id,
  name,
  description: `${name} description`,
  iconUrl: null,
  bannerUrl: null,
  memberCount: 10,
  category: 'gaming',
  tags: [],
  joined: false,
  ...p,
});

type Query = { q?: string; category?: string; offset?: number };
function mockDiscovery(answer: (q: Query) => DiscoveryPage) {
  return vi.spyOn(api, 'get').mockImplementation(async (path: string, opts?: RequestOptions) => {
    if (path !== '/api/discover/spaces') throw new Error(`unexpected GET ${path}`);
    return answer((opts?.query ?? {}) as Query) as never;
  });
}
const lastQuery = (get: ReturnType<typeof mockDiscovery>) => get.mock.calls.at(-1)?.[1]?.query as Query;

function Where() {
  const loc = useLocation();
  return <p data-testid="where">{loc.pathname}</p>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/discover']}>
      <Routes>
        <Route path="/discover" element={<DiscoverPage />} />
        <Route path="/spaces/:spaceId" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
  useDiscover.setState({ query: '', category: null, spaces: [], total: 0, status: 'idle', loadingMore: false, error: null, joining: {} });
  useSpaces.setState({ byId: {}, order: [], loaded: true, channelsLoaded: {}, members: {} });
  useUi.setState({ toasts: [] });
});

describe('DiscoverPage', () => {
  it('shows the hero, the categories and the biggest Spaces; a chip filters by category', async () => {
    const get = mockDiscovery((q) =>
      q.category === 'music'
        ? { spaces: [card('m1', 'Jazz Hands', { category: 'music' })], total: 1 }
        : { spaces: [card('s1', 'Rocket Club', { memberCount: 1234 }), card('s2', 'Pixel Painters')], total: 2 },
    );
    renderPage();
    expect(screen.getByRole('heading', { name: 'Find your community on Enbox' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Rocket Club' })).toBeInTheDocument();
    expect(screen.getAllByTestId('discover-card')).toHaveLength(2);
    expect(screen.getByText('1,234 Members')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Featured Spaces' })).toBeInTheDocument();

    const chips = screen.getByRole('group', { name: 'Categories' });
    expect(within(chips).getByRole('button', { name: 'All' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(within(chips).getByRole('button', { name: 'Music' }));
    expect(await screen.findByRole('heading', { name: 'Jazz Hands' })).toBeInTheDocument();
    expect(lastQuery(get)).toMatchObject({ category: 'music' });
    expect(within(chips).getByRole('button', { name: 'Music' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('heading', { name: 'Rocket Club' })).toBeNull();
  });

  it('searches as you type (debounced) and says when nothing matches', async () => {
    const get = mockDiscovery((q) =>
      q.q ? { spaces: [], total: 0 } : { spaces: [card('s1', 'Rocket Club')], total: 1 },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Rocket Club' });
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search Spaces' }), { target: { value: 'zebra' } });
    expect(await screen.findByText('No Spaces found')).toBeInTheDocument();
    expect(lastQuery(get)).toMatchObject({ q: 'zebra' });
    expect(screen.getByRole('heading', { name: '0 results for “zebra”' })).toBeInTheDocument();
  });

  it('shows an empty state when no Space is listed', async () => {
    mockDiscovery(() => ({ spaces: [], total: 0 }));
    renderPage();
    expect(await screen.findByText('No Spaces to explore yet')).toBeInTheDocument();
  });

  it('Join joins and opens the Space; Joined opens it', async () => {
    mockDiscovery(() => ({ spaces: [card('s1', 'Rocket Club'), card('s2', 'Pixel Painters', { joined: true })], total: 2 }));
    const detail: SpaceDetail = { space: makeSpace({ id: 's1', name: 'Rocket Club' }), channels: [] };
    const post = vi.spyOn(api, 'post').mockResolvedValue(detail as never);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Join Rocket Club' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s1'));
    expect(post).toHaveBeenCalledWith('/api/discover/spaces/s1/join');
    expect(useSpaces.getState().byId.s1?.name).toBe('Rocket Club');
    expect(useSpaces.getState().channelsLoaded.s1).toBe(true);
    expect(useDiscover.getState().spaces.find((s) => s.id === 's1')).toMatchObject({ joined: true, memberCount: 11 });
  });

  it('a joined Space opens without joining again', async () => {
    mockDiscovery(() => ({ spaces: [card('s2', 'Pixel Painters', { joined: true })], total: 1 }));
    const post = vi.spyOn(api, 'post');
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Joined, open Pixel Painters' }));
    await waitFor(() => expect(screen.getByTestId('where')).toHaveTextContent('/spaces/s2'));
    expect(post).not.toHaveBeenCalled();
  });

  it('Preview links to the Space preview next to Join (joined Spaces have none)', async () => {
    mockDiscovery(() => ({ spaces: [card('s1', 'Rocket Club'), card('s2', 'Pixel Painters', { joined: true })], total: 2 }));
    renderPage();
    expect(await screen.findByRole('link', { name: 'Preview Rocket Club' })).toHaveAttribute('href', '/preview/s1');
    expect(screen.getByRole('button', { name: 'Join Rocket Club' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Preview Pixel Painters' })).toBeNull();
  });

  it('pages in more Spaces when the end of the grid comes into view', async () => {
    let seen: ((entries: { isIntersecting: boolean }[]) => void) | null = null;
    vi.stubGlobal(
      'IntersectionObserver',
      class {
        constructor(cb: (entries: { isIntersecting: boolean }[]) => void) {
          seen = cb;
        }
        observe() {}
        disconnect() {}
      },
    );
    const first = Array.from({ length: 24 }, (_, i) => card(`a${i}`, `Space ${i}`));
    const get = mockDiscovery((q) =>
      q.offset === 24 ? { spaces: [card('b1', 'Late Bloomers')], total: 25 } : { spaces: first, total: 25 },
    );
    renderPage();
    await screen.findByRole('heading', { name: 'Space 23' });
    act(() => seen?.([{ isIntersecting: true }]));
    expect(await screen.findByRole('heading', { name: 'Late Bloomers' })).toBeInTheDocument();
    expect(lastQuery(get)).toMatchObject({ offset: 24 });
    expect(screen.getAllByTestId('discover-card')).toHaveLength(25);
  });
});
