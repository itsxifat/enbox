/**
 * Communities store — SKELETON owned by feature agent 3 (groups / communities / channels).
 *
 * Foundation behaviour: `loadCommunities()` (GET /api/communities), and realtime
 * `community:upsert` / `community:removed` → `upsertCommunity` / `removeCommunity`.
 *
 * TODO(agent 3): members, linking groups, invites, community admin actions.
 */
import { useMemo } from 'react';
import { create } from 'zustand';
import type { Community, ID } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';

export interface CommunitiesState {
  byId: Record<ID, Community>;
  loaded: boolean;
  loading: boolean;

  loadCommunities(): Promise<void>;
  refreshCommunity(id: ID): Promise<Community | null>;
  upsertCommunity(community: Community): void;
  removeCommunity(id: ID): void;
}

export const useCommunities = create<CommunitiesState>((set, get) => ({
  byId: {},
  loaded: false,
  loading: false,

  async loadCommunities() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const list = await api.get<Community[]>('/api/communities');
      set({ byId: Object.fromEntries(list.map((c) => [c.id, c])), loaded: true, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  async refreshCommunity(id) {
    try {
      const c = await api.get<Community>(`/api/communities/${id}`);
      get().upsertCommunity(c);
      return c;
    } catch (e) {
      if (e instanceof ApiError && (e.status === 404 || e.status === 403))
        get().removeCommunity(id);
      throw e;
    }
  },

  upsertCommunity(community) {
    set((s) => ({
      byId: { ...s.byId, [community.id]: { ...s.byId[community.id], ...community } },
    }));
  },

  removeCommunity(id) {
    if (!get().byId[id]) return;
    set((s) => {
      const byId = { ...s.byId };
      delete byId[id];
      return { byId };
    });
  },
}));

registerSessionReset(() => useCommunities.setState({ byId: {}, loaded: false, loading: false }));

export function useSortedCommunities(): Community[] {
  const byId = useCommunities((s) => s.byId);
  return useMemo(() => Object.values(byId).sort((a, b) => a.name.localeCompare(b.name)), [byId]);
}
