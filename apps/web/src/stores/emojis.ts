/**
 * Custom Space emoji: my picker groups, each loaded Space's list and an id index for
 * rendering tokens (`<:name:id>`, components/emoji/CustomEmoji.tsx).
 *
 * State
 * - `groups`   my Spaces that have emoji (`GET /api/me/emojis`), null until loaded
 * - `bySpace`  spaceId → that Space's emoji in upload order, for the Spaces whose list was
 *              loaded (Space Settings → Emoji); `space:emojis` keeps them and the groups current
 * - `byId`     emojiId → emoji, over both (renderers use the direct image URL when known)
 * - `stale`    the groups must be fetched again on next use (reconnect, joined a Space)
 *
 * Actions
 * - `loadMine({ force })`             GET /api/me/emojis (deduped; cached unless stale/force)
 * - `loadSpace(spaceId, { force })`   GET /api/spaces/:id/emojis
 * - `create(spaceId, name, mediaId)`  POST, `rename(...)` PATCH, `remove(...)` DELETE: the
 *                                     response is applied at once (the event follows)
 * - `applySpaceEmojis(spaceId, list)` the `space:emojis` event (realtime/emojis.ts)
 * - `dropSpace(spaceId)` / `invalidate()`
 *
 * Hooks: `useEmojiGroups()` (auto-loads, Spaces in rail order), `useSpaceEmojis(spaceId)`
 * (auto-loads). Helper: `emojiImageUrl()`.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { ID, SpaceEmoji, SpaceEmojiGroup } from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useRailItems } from './rail';
import { useSpaces } from './spaces';

export interface EmojisState {
  groups: SpaceEmojiGroup[] | null;
  bySpace: Record<ID, SpaceEmoji[]>;
  byId: Record<ID, SpaceEmoji>;
  stale: boolean;

  loadMine(opts?: { force?: boolean }): Promise<void>;
  loadSpace(spaceId: ID, opts?: { force?: boolean }): Promise<SpaceEmoji[]>;
  create(spaceId: ID, name: string, mediaId: ID): Promise<SpaceEmoji>;
  rename(spaceId: ID, emojiId: ID, name: string): Promise<SpaceEmoji>;
  remove(spaceId: ID, emojiId: ID): Promise<void>;
  applySpaceEmojis(spaceId: ID, emojis: SpaceEmoji[]): void;
  dropSpace(spaceId: ID): void;
  invalidate(): void;
}

const initial = {
  groups: null as SpaceEmojiGroup[] | null,
  bySpace: {} as Record<ID, SpaceEmoji[]>,
  byId: {} as Record<ID, SpaceEmoji>,
  stale: false,
};

let minePromise: Promise<void> | null = null;
const spacePromises = new Map<ID, Promise<SpaceEmoji[]>>();

function indexOf(groups: SpaceEmojiGroup[] | null, bySpace: Record<ID, SpaceEmoji[]>): Record<ID, SpaceEmoji> {
  const out: Record<ID, SpaceEmoji> = {};
  for (const g of groups ?? []) for (const e of g.emojis) out[e.id] = e;
  for (const list of Object.values(bySpace)) for (const e of list) out[e.id] = e;
  return out;
}

/** The groups with one Space's list replaced (added when new, removed when empty). */
function withSpace(groups: SpaceEmojiGroup[] | null, spaceId: ID, emojis: SpaceEmoji[]): SpaceEmojiGroup[] | null {
  if (!groups) return groups;
  const i = groups.findIndex((g) => g.spaceId === spaceId);
  if (emojis.length === 0) return i === -1 ? groups : groups.filter((g) => g.spaceId !== spaceId);
  if (i !== -1) return groups.map((g) => (g.spaceId === spaceId ? { ...g, emojis } : g));
  const space = useSpaces.getState().byId[spaceId];
  if (!space) return groups;
  return [...groups, { spaceId, spaceName: space.name, iconUrl: space.iconUrl, emojis }];
}

export const useEmojis = create<EmojisState>((set, get) => {
  /** Replace one Space's list in the groups, and in `bySpace` when loaded there (or `list`). */
  const put = (spaceId: ID, emojis: SpaceEmoji[], list = false) =>
    set((s) => {
      const bySpace = list || s.bySpace[spaceId] ? { ...s.bySpace, [spaceId]: emojis } : s.bySpace;
      const groups = withSpace(s.groups, spaceId, emojis);
      return { bySpace, groups, byId: indexOf(groups, bySpace) };
    });
  const listOf = (spaceId: ID) =>
    get().bySpace[spaceId] ?? get().groups?.find((g) => g.spaceId === spaceId)?.emojis ?? null;

  return {
    ...initial,

    loadMine({ force = false } = {}) {
      if (get().groups && !get().stale && !force) return Promise.resolve();
      if (minePromise) return minePromise;
      const epoch = sessionEpoch();
      minePromise = api
        .get<SpaceEmojiGroup[]>('/api/me/emojis')
        .then((groups) => {
          if (epoch !== sessionEpoch()) return;
          set((s) => {
            // Lists loaded on their own (settings) stay authoritative for their Space.
            const merged = groups.map((g) => (s.bySpace[g.spaceId] ? { ...g, emojis: s.bySpace[g.spaceId]! } : g));
            return { groups: merged, stale: false, byId: indexOf(merged, s.bySpace) };
          });
        })
        .finally(() => {
          minePromise = null;
        });
      return minePromise;
    },

    loadSpace(spaceId, { force = false } = {}) {
      const have = get().bySpace[spaceId];
      if (have && !force) return Promise.resolve(have);
      const pending = spacePromises.get(spaceId);
      if (pending) return pending;
      const epoch = sessionEpoch();
      const p = api
        .get<SpaceEmoji[]>(`/api/spaces/${spaceId}/emojis`)
        .then((list) => {
          if (epoch === sessionEpoch()) put(spaceId, list, true);
          return list;
        })
        .finally(() => spacePromises.delete(spaceId));
      spacePromises.set(spaceId, p);
      return p;
    },

    async create(spaceId, name, mediaId) {
      const emoji = await api.post<SpaceEmoji>(`/api/spaces/${spaceId}/emojis`, { name, mediaId });
      const list = listOf(spaceId) ?? [];
      put(spaceId, [...list.filter((e) => e.id !== emoji.id), emoji]);
      return emoji;
    },

    async rename(spaceId, emojiId, name) {
      const emoji = await api.patch<SpaceEmoji>(`/api/spaces/${spaceId}/emojis/${emojiId}`, { name });
      const list = listOf(spaceId);
      if (list) put(spaceId, list.map((e) => (e.id === emoji.id ? emoji : e)));
      return emoji;
    },

    async remove(spaceId, emojiId) {
      await api.delete(`/api/spaces/${spaceId}/emojis/${emojiId}`);
      const list = listOf(spaceId);
      if (list) put(spaceId, list.filter((e) => e.id !== emojiId));
    },

    applySpaceEmojis(spaceId, emojis) {
      put(spaceId, emojis);
    },

    dropSpace(spaceId) {
      set((s) => {
        const { [spaceId]: _gone, ...bySpace } = s.bySpace;
        const groups = s.groups?.filter((g) => g.spaceId !== spaceId) ?? null;
        return { bySpace, groups, byId: indexOf(groups, bySpace) };
      });
    },

    invalidate() {
      set({ stale: true });
    },
  };
});

registerSessionReset(() => {
  minePromise = null;
  spacePromises.clear();
  useEmojis.setState(initial);
});

/**
 * My picker groups (loads on first use and after `invalidate`), Spaces in rail order.
 * `enabled: false` neither loads nor returns them.
 */
export function useEmojiGroups(enabled = true): SpaceEmojiGroup[] | null {
  const loaded = useEmojis((s) => s.groups);
  const groups = enabled ? loaded : null;
  const stale = useEmojis((s) => s.stale);
  const items = useRailItems();
  useEffect(() => {
    if (enabled && (!loaded || stale)) void useEmojis.getState().loadMine().catch(() => undefined);
  }, [enabled, loaded, stale]);
  return useMemo(() => {
    if (!groups) return null;
    const order = items.flatMap((i) => (i.kind === 'space' ? [i.space.id] : i.spaces.map((s) => s.id)));
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...groups].sort((a, b) => (rank.get(a.spaceId) ?? Infinity) - (rank.get(b.spaceId) ?? Infinity));
  }, [groups, items]);
}

/** One Space's emoji (loads it on first use); null while loading. */
export function useSpaceEmojis(spaceId: ID): SpaceEmoji[] | null {
  const list = useEmojis((s) => s.bySpace[spaceId] ?? null);
  useEffect(() => {
    void useEmojis.getState().loadSpace(spaceId).catch(() => undefined);
  }, [spaceId]);
  return list;
}

/**
 * The image of an emoji for `<img src>` (relative: pass it through `mediaUrl`). A known
 * emoji's own file when it plays; otherwise the public redirect, which also serves emoji of
 * Spaces I am not in and, with `still`, the poster of an animated one.
 */
export function emojiImageUrl(
  emoji: { id: ID; animated: boolean },
  opts: { still?: boolean; known?: SpaceEmoji | null } = {},
): string {
  const still = !!opts.still && emoji.animated;
  if (opts.known && !still) return opts.known.url;
  return `/api/emojis/${emoji.id}${still ? '?static=1' : ''}`;
}
