/**
 * Status (stories) store — agent 4.
 *
 * State
 * - `feed`      `GET /api/status/feed` (`mine` oldest first; `updates` per user, statuses oldest
 *               first), kept live by realtime/status.ts (`status:new/deleted/viewed`)
 * - `posting`   statuses being uploaded/posted (the "My status" row shows progress)
 * - `viewers`   viewers of my statuses (`GET /api/status/:id/viewers`, author only)
 *
 * Actions: `loadFeed`, `applyNew`, `applyDeleted`, `applyViewed`, `markViewed` (optimistic +
 * `POST …/view`, once per status), `postText`, `postMedia` (upload + post), `deleteStatus`,
 * `react`, `loadViewers`, `pruneExpired`.
 * Hooks: `useHasUnseenStatus()` (Updates tab dot), `useStatusLists()` (recent/viewed split).
 */
import { useEffect, useMemo, useState } from 'react';
import { create } from 'zustand';
import type {
  CreateStatusRequest,
  ID,
  Status,
  StatusFeedItem,
  StatusViewer,
  UserPublic,
} from '@enbox/shared';
import { api, type ApiResponse, type UploadMeta } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useAuth } from './auth';

export type StatusFeed = ApiResponse<'GET /api/status/feed'>;

/** The counters of a `status:viewed` event. */
export interface StatusViewedInfo {
  firstView: boolean;
  viewCount: number;
}

export interface PostingStatus {
  id: string;
  type: Status['type'];
  /** Upload progress 0..1 (text statuses jump to 1). */
  progress: number;
}

export interface ViewersState {
  items: StatusViewer[];
  loading: boolean;
  loaded: boolean;
  error: string | null;
}

export interface StatusState {
  feed: StatusFeed | null;
  loaded: boolean;
  loading: boolean;
  error: string | null;
  posting: PostingStatus[];
  viewers: Record<ID, ViewersState>;

  loadFeed(): Promise<void>;
  applyNew(status: Status, user: UserPublic): void;
  applyDeleted(statusId: ID, userId: ID): void;
  /**
   * `status:viewed` (author only): `firstView` → a new viewer (added), else an updated
   * reaction of a known view (replaced in place); `viewCount` is the server's current count.
   */
  applyViewed(statusId: ID, viewer: StatusViewer, info?: StatusViewedInfo): void;
  markViewed(statusId: ID): void;
  postText(input: { text: string; backgroundColor: string; font: number }): Promise<Status>;
  postMedia(input: {
    file: Blob;
    meta: UploadMeta & { kind: 'image' | 'video' };
    fileName?: string;
    caption?: string;
  }): Promise<Status>;
  deleteStatus(statusId: ID): Promise<void>;
  react(statusId: ID, emoji: string): Promise<void>;
  loadViewers(statusId: ID): Promise<void>;
  /** Drop statuses whose `expiresAt` passed (the server purges them on its own schedule). */
  pruneExpired(now?: number): void;
}

const EMPTY_FEED: StatusFeed = { mine: [], updates: [] };

const myId = () => useAuth.getState().user?.id ?? null;

function byCreated(a: Status, b: Status): number {
  return a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0;
}

/** Recompute derived fields of a feed item after its statuses changed. */
export function normalizeItem(item: StatusFeedItem): StatusFeedItem {
  const statuses = [...item.statuses].sort(byCreated);
  const last = statuses[statuses.length - 1];
  return {
    ...item,
    statuses,
    allViewed: statuses.every((s) => s.viewed),
    lastUpdatedAt: last?.createdAt ?? item.lastUpdatedAt,
  };
}

/** Unviewed first (newest first), then viewed (newest first) — like the server. */
export function sortUpdates(updates: StatusFeedItem[]): StatusFeedItem[] {
  return [...updates].sort((a, b) => {
    if (a.allViewed !== b.allViewed) return a.allViewed ? 1 : -1;
    return a.lastUpdatedAt < b.lastUpdatedAt ? 1 : a.lastUpdatedAt > b.lastUpdatedAt ? -1 : 0;
  });
}

function isLive(s: Pick<Status, 'expiresAt'>, now: number): boolean {
  return Date.parse(s.expiresAt) > now;
}

/** status ids whose view we already POSTed (or are posting). */
const viewedSent = new Set<ID>();

export const useStatus = create<StatusState>((set, get) => {
  const patchFeed = (fn: (feed: StatusFeed) => StatusFeed) => {
    set({ feed: fn(get().feed ?? EMPTY_FEED) });
  };

  const patchMine = (statusId: ID, fn: (s: Status) => Status) =>
    patchFeed((feed) => ({ ...feed, mine: feed.mine.map((s) => (s.id === statusId ? fn(s) : s)) }));

  return {
    feed: null,
    loaded: false,
    loading: false,
    error: null,
    posting: [],
    viewers: {},

    async loadFeed() {
      if (get().loading) return;
      set({ loading: true, error: null });
      const epoch = sessionEpoch();
      try {
        const feed = await api.get<StatusFeed>('/api/status/feed');
        // Logged out meanwhile: the previous account's feed must not reach the next one.
        if (epoch !== sessionEpoch()) return;
        const now = Date.now();
        set({
          feed: {
            mine: feed.mine.filter((s) => isLive(s, now)).sort(byCreated),
            updates: sortUpdates(
              feed.updates
                .map((u) =>
                  normalizeItem({ ...u, statuses: u.statuses.filter((s) => isLive(s, now)) }),
                )
                .filter((u) => u.statuses.length > 0),
            ),
          },
          loaded: true,
          loading: false,
        });
      } catch (e) {
        if (epoch !== sessionEpoch()) return;
        set({ loading: false, error: e instanceof Error ? e.message : 'Error' });
        throw e;
      }
    },

    applyNew(status, user) {
      if (user.id === myId()) {
        patchFeed((feed) => ({
          ...feed,
          mine: [...feed.mine.filter((s) => s.id !== status.id), status].sort(byCreated),
        }));
        return;
      }
      patchFeed((feed) => {
        const existing = feed.updates.find((u) => u.user.id === user.id);
        const item = normalizeItem(
          existing
            ? {
                ...existing,
                user,
                statuses: [...existing.statuses.filter((s) => s.id !== status.id), status],
              }
            : {
                user,
                statuses: [status],
                allViewed: status.viewed,
                lastUpdatedAt: status.createdAt,
              },
        );
        return {
          ...feed,
          updates: sortUpdates([item, ...feed.updates.filter((u) => u.user.id !== user.id)]),
        };
      });
    },

    applyDeleted(statusId, userId) {
      const feed = get().feed;
      if (!feed) return;
      const updates = feed.updates
        .map((u) =>
          u.user.id === userId
            ? normalizeItem({ ...u, statuses: u.statuses.filter((s) => s.id !== statusId) })
            : u,
        )
        .filter((u) => u.statuses.length > 0);
      const viewers = { ...get().viewers };
      delete viewers[statusId];
      set({ feed: { mine: feed.mine.filter((s) => s.id !== statusId), updates }, viewers });
    },

    applyViewed(statusId, viewer, info) {
      const current = get().viewers[statusId];
      const same = (v: StatusViewer) => v.user.id === viewer.user.id;
      const known = current?.items.some(same) ?? false;
      // Without the server's flag (older payloads), a viewer we don't list yet is a new view.
      const firstView = info?.firstView ?? !known;
      if (current) {
        // Replace a known entry in place (a reaction keeps its view time), add a new one first.
        const items = known
          ? current.items.map((v) => (same(v) ? viewer : v))
          : [viewer, ...current.items];
        set({ viewers: { ...get().viewers, [statusId]: { ...current, items } } });
      }
      patchMine(statusId, (s) => ({
        ...s,
        viewCount: info ? info.viewCount : firstView ? (s.viewCount ?? 0) + 1 : s.viewCount,
      }));
    },

    markViewed(statusId) {
      const me = myId();
      const feed = get().feed;
      if (!feed || viewedSent.has(statusId)) return;
      const item = feed.updates.find((u) => u.statuses.some((s) => s.id === statusId));
      if (!item || item.user.id === me) return;
      const status = item.statuses.find((s) => s.id === statusId)!;
      viewedSent.add(statusId);
      if (!status.viewed) {
        patchFeed((f) => ({
          ...f,
          updates: f.updates.map((u) =>
            u.user.id === item.user.id
              ? normalizeItem({
                  ...u,
                  statuses: u.statuses.map((s) => (s.id === statusId ? { ...s, viewed: true } : s)),
                })
              : u,
          ),
        }));
      }
      void api.post(`/api/status/${statusId}/view`).catch(() => {
        viewedSent.delete(statusId);
      });
    },

    async postText({ text, backgroundColor, font }) {
      const id = newClientId();
      set({ posting: [...get().posting, { id, type: 'text', progress: 1 }] });
      try {
        const body: CreateStatusRequest = { type: 'text', text, backgroundColor, font };
        const status = await api.post<Status>('/api/status', body);
        const me = useAuth.getState().user;
        if (me) get().applyNew(status, selfPublic(me));
        return status;
      } finally {
        set({ posting: get().posting.filter((p) => p.id !== id) });
      }
    },

    async postMedia({ file, meta, fileName, caption }) {
      const id = newClientId();
      set({ posting: [...get().posting, { id, type: meta.kind, progress: 0 }] });
      const progress = (p: number) =>
        set({ posting: get().posting.map((x) => (x.id === id ? { ...x, progress: p } : x)) });
      try {
        const media = await api.upload(file, meta, progress, { fileName });
        const text = caption?.trim();
        const body: CreateStatusRequest = {
          type: meta.kind,
          mediaId: media.id,
          ...(text ? { text } : {}),
        };
        const status = await api.post<Status>('/api/status', body);
        const me = useAuth.getState().user;
        if (me) get().applyNew(status, selfPublic(me));
        return status;
      } finally {
        set({ posting: get().posting.filter((p) => p.id !== id) });
      }
    },

    async deleteStatus(statusId) {
      const me = myId();
      await api.delete(`/api/status/${statusId}`);
      if (me) get().applyDeleted(statusId, me);
    },

    async react(statusId, emoji) {
      await api.put(`/api/status/${statusId}/reaction`, { emoji });
      // A reaction also records a view.
      viewedSent.add(statusId);
    },

    async loadViewers(statusId) {
      const cur = get().viewers[statusId];
      set({
        viewers: {
          ...get().viewers,
          [statusId]: {
            items: cur?.items ?? [],
            loading: true,
            loaded: cur?.loaded ?? false,
            error: null,
          },
        },
      });
      try {
        const items = await api.get<StatusViewer[]>(`/api/status/${statusId}/viewers`);
        set({
          viewers: {
            ...get().viewers,
            [statusId]: { items, loading: false, loaded: true, error: null },
          },
        });
        patchMine(statusId, (s) => ({ ...s, viewCount: items.length }));
      } catch (e) {
        set({
          viewers: {
            ...get().viewers,
            [statusId]: {
              items: cur?.items ?? [],
              loading: false,
              loaded: cur?.loaded ?? false,
              error: e instanceof Error ? e.message : 'Error',
            },
          },
        });
        throw e;
      }
    },

    pruneExpired(now = Date.now()) {
      const feed = get().feed;
      if (!feed) return;
      const expired = (s: Status) => !isLive(s, now);
      if (!feed.mine.some(expired) && !feed.updates.some((u) => u.statuses.some(expired))) return;
      set({
        feed: {
          mine: feed.mine.filter((s) => !expired(s)),
          updates: feed.updates
            .map((u) => normalizeItem({ ...u, statuses: u.statuses.filter((s) => !expired(s)) }))
            .filter((u) => u.statuses.length > 0),
        },
      });
    },
  };
});

/** My own profile as a UserPublic (for my feed entries). */
export function selfPublic(
  me: NonNullable<ReturnType<typeof useAuth.getState>['user']>,
): UserPublic {
  return {
    id: me.id,
    username: me.username,
    displayName: me.displayName,
    avatarUrl: me.avatarUrl,
    about: me.about,
    phone: me.phone,
    online: true,
    lastSeenAt: null,
    isContact: false,
    contactName: null,
    isBlocked: false,
    isDeleted: false,
  };
}

registerSessionReset(() => {
  viewedSent.clear();
  useStatus.setState({
    feed: null,
    loaded: false,
    loading: false,
    error: null,
    posting: [],
    viewers: {},
  });
});

/** Someone has status updates I haven't seen (Updates tab dot). */
/** Earliest future expiry among unseen statuses (ms epoch), null when none. */
export function nextUnseenExpiry(feed: StatusFeed | null, now: number): number | null {
  let next: number | null = null;
  for (const u of feed?.updates ?? [])
    for (const s of u.statuses) {
      if (s.viewed) continue;
      const t = Date.parse(s.expiresAt);
      if (t > now && (next === null || t < next)) next = t;
    }
  return next;
}

/**
 * Updates tab dot: an unseen status that hasn't expired. Statuses expire without an event
 * (the server just deletes them), so re-check — and prune the feed — at the next expiry even
 * when the status list isn't mounted.
 */
export function useHasUnseenStatus(): boolean {
  const [now, setNow] = useState(() => Date.now());
  const has = useStatus(
    (s) =>
      !!s.feed?.updates.some((u) => u.statuses.some((st) => !st.viewed && isLive(st, now))),
  );
  const next = useStatus((s) => nextUnseenExpiry(s.feed, now));
  useEffect(() => {
    if (next === null) return;
    const t = setTimeout(
      () => {
        useStatus.getState().pruneExpired();
        setNow(Date.now());
      },
      Math.min(2 ** 31 - 1, Math.max(0, next - Date.now()) + 50),
    );
    return () => clearTimeout(t);
  }, [next]);
  return has;
}

/** Feed split for the Updates tab: recent (unseen) and viewed, each newest first. */
export function useStatusLists(): {
  mine: Status[];
  recent: StatusFeedItem[];
  viewed: StatusFeedItem[];
} {
  const feed = useStatus((s) => s.feed);
  return useMemo(() => {
    const updates = sortUpdates(feed?.updates ?? []);
    return {
      mine: feed?.mine ?? [],
      recent: updates.filter((u) => !u.allViewed),
      viewed: updates.filter((u) => u.allViewed),
    };
  }, [feed]);
}
