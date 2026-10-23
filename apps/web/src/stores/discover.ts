/**
 * Space discovery (`/discover`): the current search (text + category), its pages of
 * `DiscoverableSpace` (GET /api/discover/spaces, DISCOVERY_PAGE_SIZE per page, by offset) and
 * joining (POST /api/discover/spaces/:id/join → SpaceDetail into the spaces and chats stores).
 * A newer search drops the answers of older ones.
 */
import { create } from 'zustand';
import {
  type DiscoverableSpace,
  type DiscoveryCategory,
  type DiscoveryPage,
  type ID,
  type SpaceDetail,
} from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useChats } from './chats';
import { useSpaces } from './spaces';

/** The server pages up to this offset (`discoveryQuerySchema`). */
export const DISCOVERY_MAX_OFFSET = 1000;

export interface DiscoverState {
  query: string;
  category: DiscoveryCategory | null;
  spaces: DiscoverableSpace[];
  total: number;
  status: 'idle' | 'loading' | 'ready' | 'error';
  loadingMore: boolean;
  error: string | null;
  /** Spaces being joined. */
  joining: Record<ID, boolean>;

  /** Run a search (first page); the same search again refreshes it. */
  search(query: string, category: DiscoveryCategory | null): Promise<void>;
  /** The next page of the current search (no-op while loading or at the end). */
  loadMore(): Promise<void>;
  /** Join a listed Space; already a member counts as joined. Resolves with the Space id. */
  join(spaceId: ID): Promise<ID>;
}

const initial = {
  query: '',
  category: null as DiscoveryCategory | null,
  spaces: [] as DiscoverableSpace[],
  total: 0,
  status: 'idle' as DiscoverState['status'],
  loadingMore: false,
  error: null as string | null,
  joining: {} as Record<ID, boolean>,
};

/** Bumped by every search: answers of an older one are dropped. */
let generation = 0;

function fetchPage(query: string, category: DiscoveryCategory | null, offset: number) {
  return api.get<DiscoveryPage>('/api/discover/spaces', {
    query: { q: query.trim() || undefined, category: category ?? undefined, offset: offset || undefined },
  });
}

/** More pages exist for the loaded list. */
export function hasMoreSpaces(s: Pick<DiscoverState, 'spaces' | 'total'>): boolean {
  return s.spaces.length < s.total && s.spaces.length <= DISCOVERY_MAX_OFFSET;
}

export const useDiscover = create<DiscoverState>((set, get) => ({
  ...initial,

  async search(query, category) {
    const gen = ++generation;
    const epoch = sessionEpoch();
    set({ query, category, status: 'loading', error: null, loadingMore: false });
    try {
      const page = await fetchPage(query, category, 0);
      if (gen !== generation || epoch !== sessionEpoch()) return;
      set({ spaces: page.spaces, total: page.total, status: 'ready' });
    } catch (e) {
      if (gen !== generation || epoch !== sessionEpoch()) return;
      set({ status: 'error', error: e instanceof Error ? e.message : 'Could not load Spaces' });
    }
  },

  async loadMore() {
    const s = get();
    if (s.status !== 'ready' || s.loadingMore || !hasMoreSpaces(s)) return;
    const gen = generation;
    const epoch = sessionEpoch();
    set({ loadingMore: true });
    try {
      const page = await fetchPage(s.query, s.category, s.spaces.length);
      if (gen !== generation || epoch !== sessionEpoch()) return;
      // A Space can move between pages while members join: keep the first copy.
      const seen = new Set(get().spaces.map((x) => x.id));
      const fresh = page.spaces.filter((x) => !seen.has(x.id));
      set((cur) => ({
        spaces: [...cur.spaces, ...fresh],
        // A page with nothing new ends the list even if the count moved.
        total: fresh.length ? page.total : cur.spaces.length,
        loadingMore: false,
      }));
    } catch {
      if (gen === generation) set({ loadingMore: false });
    }
  },

  async join(spaceId) {
    if (get().joining[spaceId]) return spaceId;
    set((s) => ({ joining: { ...s.joining, [spaceId]: true } }));
    const markJoined = (bump: boolean) =>
      set((s) => ({
        spaces: s.spaces.map((x) =>
          x.id === spaceId ? { ...x, joined: true, memberCount: x.memberCount + (bump ? 1 : 0) } : x,
        ),
      }));
    try {
      const detail = await api.post<SpaceDetail>(`/api/discover/spaces/${spaceId}/join`);
      useSpaces.getState().upsertSpace(detail.space);
      useChats.getState().upsertChats(detail.channels);
      useSpaces.setState((s) => ({ channelsLoaded: { ...s.channelsLoaded, [spaceId]: true } }));
      markJoined(true);
      return spaceId;
    } catch (e) {
      // Joined on another device meanwhile: just open it.
      if (e instanceof ApiError && e.code === 'conflict') {
        markJoined(false);
        void useSpaces
          .getState()
          .loadSpace(spaceId)
          .catch(() => undefined);
        return spaceId;
      }
      throw e;
    } finally {
      set((s) => {
        const joining = { ...s.joining };
        delete joining[spaceId];
        return { joining };
      });
    }
  },
}));

registerSessionReset(() => {
  generation++;
  useDiscover.setState({ ...initial });
});
