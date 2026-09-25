/**
 * Status (stories) store — SKELETON owned by feature agent 4.
 *
 * Foundation behaviour: `loadFeed()` fetches GET /api/status/feed; realtime/status.ts
 * applies `status:new`, `status:deleted`, `status:viewed`. Agent 4 owns this file and
 * may reshape it (keep `useHasUnseenStatus()` — the Updates tab dot uses it).
 *
 * TODO(agent 4): posting, viewing (mark viewed), viewers list, reactions, muted updates.
 */
import { create } from 'zustand';
import type { ID, Status, StatusViewer, UserPublic } from '@enbox/shared';
import { api, type ApiResponse } from '@/lib/api';
import { registerSessionReset } from '@/lib/session';
import { useAuth } from './auth';

export type StatusFeed = ApiResponse<'GET /api/status/feed'>;

export interface StatusState {
  feed: StatusFeed | null;
  loaded: boolean;
  loading: boolean;

  loadFeed(): Promise<void>;
  applyNew(status: Status, user: UserPublic): void;
  applyDeleted(statusId: ID, userId: ID): void;
  applyViewed(statusId: ID, viewer: StatusViewer): void;
}

const EMPTY_FEED: StatusFeed = { mine: [], updates: [] };

export const useStatus = create<StatusState>((set, get) => ({
  feed: null,
  loaded: false,
  loading: false,

  async loadFeed() {
    if (get().loading) return;
    set({ loading: true });
    try {
      const feed = await api.get<StatusFeed>('/api/status/feed');
      set({ feed, loaded: true, loading: false });
    } catch (e) {
      set({ loading: false });
      throw e;
    }
  },

  applyNew(status, user) {
    const feed = get().feed ?? EMPTY_FEED;
    if (user.id === useAuth.getState().user?.id) {
      set({ feed: { ...feed, mine: [...feed.mine.filter((s) => s.id !== status.id), status] } });
      return;
    }
    const existing = feed.updates.find((u) => u.user.id === user.id);
    const item = existing
      ? {
          ...existing,
          user,
          statuses: [...existing.statuses.filter((s) => s.id !== status.id), status],
          allViewed: existing.allViewed && status.viewed,
          lastUpdatedAt: status.createdAt,
        }
      : { user, statuses: [status], allViewed: status.viewed, lastUpdatedAt: status.createdAt };
    set({
      feed: { ...feed, updates: [item, ...feed.updates.filter((u) => u.user.id !== user.id)] },
    });
  },

  applyDeleted(statusId, userId) {
    const feed = get().feed;
    if (!feed) return;
    const updates = feed.updates
      .map((u) =>
        u.user.id === userId ? { ...u, statuses: u.statuses.filter((s) => s.id !== statusId) } : u,
      )
      .filter((u) => u.statuses.length > 0);
    set({ feed: { mine: feed.mine.filter((s) => s.id !== statusId), updates } });
  },

  applyViewed(statusId) {
    const feed = get().feed;
    if (!feed) return;
    set({
      feed: {
        ...feed,
        mine: feed.mine.map((s) =>
          s.id === statusId ? { ...s, viewCount: (s.viewCount ?? 0) + 1 } : s,
        ),
      },
    });
  },
}));

registerSessionReset(() => useStatus.setState({ feed: null, loaded: false, loading: false }));

/** Someone has status updates I haven't seen (Updates tab dot). */
export function useHasUnseenStatus(): boolean {
  return useStatus((s) => !!s.feed?.updates.some((u) => !u.allViewed));
}
