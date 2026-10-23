/**
 * Space stickers: my picker groups and each loaded Space's list (Space Settings ▸ Stickers).
 *
 * State
 * - `groups`   my Spaces that have stickers (`GET /api/me/stickers`), null until loaded (the
 *              picker loads them on first open)
 * - `bySpace`  spaceId → that Space's stickers, oldest first, for the Spaces whose list was
 *              loaded (settings); `space:stickers` keeps them and the groups current
 * - `stale`    the groups must be fetched again on next use (reconnect, joined a Space)
 *
 * Actions
 * - `loadMine({ force })`                  GET /api/me/stickers (deduped; cached unless stale/force)
 * - `loadSpace(spaceId, { force })`        GET /api/spaces/:id/stickers
 * - `create(spaceId, body)`                POST, `update(spaceId, id, patch)` PATCH, `remove(...)`
 *                                          DELETE: the response is applied at once (the event follows)
 * - `applySpaceStickers(spaceId, list)`    the `space:stickers` event (realtime/stickers.ts)
 * - `dropSpace(spaceId)` / `invalidate()`
 *
 * Hooks: `useStickerGroups(enabled)` (auto-loads, Spaces in rail order), `useSpaceStickers(spaceId)`
 * (auto-loads). Helper: `findSticker()`.
 */
import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type {
  CreateSpaceStickerRequest,
  ID,
  SpaceSticker,
  SpaceStickerGroup,
  UpdateSpaceStickerRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { useRailItems } from './rail';
import { useSpaces } from './spaces';

export interface StickersState {
  groups: SpaceStickerGroup[] | null;
  bySpace: Record<ID, SpaceSticker[]>;
  stale: boolean;

  loadMine(opts?: { force?: boolean }): Promise<void>;
  loadSpace(spaceId: ID, opts?: { force?: boolean }): Promise<SpaceSticker[]>;
  create(spaceId: ID, body: CreateSpaceStickerRequest): Promise<SpaceSticker>;
  update(spaceId: ID, stickerId: ID, patch: UpdateSpaceStickerRequest): Promise<SpaceSticker>;
  remove(spaceId: ID, stickerId: ID): Promise<void>;
  applySpaceStickers(spaceId: ID, stickers: SpaceSticker[]): void;
  dropSpace(spaceId: ID): void;
  invalidate(): void;
}

const initial = {
  groups: null as SpaceStickerGroup[] | null,
  bySpace: {} as Record<ID, SpaceSticker[]>,
  stale: false,
};

let minePromise: Promise<void> | null = null;
const spacePromises = new Map<ID, Promise<SpaceSticker[]>>();

/** The groups with one Space's list replaced (added when new, removed when empty). */
function withSpace(
  groups: SpaceStickerGroup[] | null,
  spaceId: ID,
  stickers: SpaceSticker[],
): SpaceStickerGroup[] | null {
  if (!groups) return groups;
  const i = groups.findIndex((g) => g.spaceId === spaceId);
  if (stickers.length === 0) return i === -1 ? groups : groups.filter((g) => g.spaceId !== spaceId);
  if (i !== -1) return groups.map((g) => (g.spaceId === spaceId ? { ...g, stickers } : g));
  const space = useSpaces.getState().byId[spaceId];
  if (!space) return groups;
  return [...groups, { spaceId, spaceName: space.name, iconUrl: space.iconUrl, stickers }];
}

export const useStickers = create<StickersState>((set, get) => {
  /** Replace one Space's list in the groups, and in `bySpace` when loaded there (or `list`). */
  const put = (spaceId: ID, stickers: SpaceSticker[], list = false) =>
    set((s) => ({
      bySpace: list || s.bySpace[spaceId] ? { ...s.bySpace, [spaceId]: stickers } : s.bySpace,
      groups: withSpace(s.groups, spaceId, stickers),
    }));
  const listOf = (spaceId: ID) =>
    get().bySpace[spaceId] ?? get().groups?.find((g) => g.spaceId === spaceId)?.stickers ?? null;

  return {
    ...initial,

    loadMine({ force = false } = {}) {
      if (get().groups && !get().stale && !force) return Promise.resolve();
      if (minePromise) return minePromise;
      const epoch = sessionEpoch();
      minePromise = api
        .get<SpaceStickerGroup[]>('/api/me/stickers')
        .then((groups) => {
          if (epoch !== sessionEpoch()) return;
          set((s) => ({
            // Lists loaded on their own (settings) stay authoritative for their Space.
            groups: groups.map((g) =>
              s.bySpace[g.spaceId] ? { ...g, stickers: s.bySpace[g.spaceId]! } : g,
            ),
            stale: false,
          }));
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
        .get<SpaceSticker[]>(`/api/spaces/${spaceId}/stickers`)
        .then((list) => {
          if (epoch === sessionEpoch()) put(spaceId, list, true);
          return list;
        })
        .finally(() => spacePromises.delete(spaceId));
      spacePromises.set(spaceId, p);
      return p;
    },

    async create(spaceId, body) {
      const sticker = await api.post<SpaceSticker>(`/api/spaces/${spaceId}/stickers`, body);
      const list = listOf(spaceId) ?? [];
      put(spaceId, [...list.filter((x) => x.id !== sticker.id), sticker]);
      return sticker;
    },

    async update(spaceId, stickerId, patch) {
      const sticker = await api.patch<SpaceSticker>(
        `/api/spaces/${spaceId}/stickers/${stickerId}`,
        patch,
      );
      const list = listOf(spaceId);
      if (list)
        put(
          spaceId,
          list.map((x) => (x.id === sticker.id ? sticker : x)),
        );
      return sticker;
    },

    async remove(spaceId, stickerId) {
      await api.delete(`/api/spaces/${spaceId}/stickers/${stickerId}`);
      const list = listOf(spaceId);
      if (list)
        put(
          spaceId,
          list.filter((x) => x.id !== stickerId),
        );
    },

    applySpaceStickers(spaceId, stickers) {
      put(spaceId, stickers);
    },

    dropSpace(spaceId) {
      set((s) => {
        const { [spaceId]: _gone, ...bySpace } = s.bySpace;
        return { bySpace, groups: s.groups?.filter((g) => g.spaceId !== spaceId) ?? null };
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
  useStickers.setState(initial);
});

/** A sticker known to the store (picker groups or a loaded Space list), else null. */
export function findSticker(
  s: Pick<StickersState, 'groups' | 'bySpace'>,
  stickerId: ID,
  spaceId?: ID | null,
): SpaceSticker | null {
  const inList = spaceId ? s.bySpace[spaceId]?.find((x) => x.id === stickerId) : undefined;
  if (inList) return inList;
  for (const g of s.groups ?? []) {
    if (spaceId && g.spaceId !== spaceId) continue;
    const hit = g.stickers.find((x) => x.id === stickerId);
    if (hit) return hit;
  }
  return null;
}

/**
 * My picker groups (loads on first use and after `invalidate`), Spaces in rail order.
 * `enabled: false` neither loads nor returns them.
 */
export function useStickerGroups(enabled = true): SpaceStickerGroup[] | null {
  const loaded = useStickers((s) => s.groups);
  const groups = enabled ? loaded : null;
  const stale = useStickers((s) => s.stale);
  const items = useRailItems();
  useEffect(() => {
    if (enabled && (!loaded || stale))
      void useStickers
        .getState()
        .loadMine()
        .catch(() => undefined);
  }, [enabled, loaded, stale]);
  return useMemo(() => {
    if (!groups) return null;
    const order = items.flatMap((i) =>
      i.kind === 'space' ? [i.space.id] : i.spaces.map((s) => s.id),
    );
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...groups].sort(
      (a, b) => (rank.get(a.spaceId) ?? Infinity) - (rank.get(b.spaceId) ?? Infinity),
    );
  }, [groups, items]);
}

/** One Space's stickers (loads it on first use); null while loading. */
export function useSpaceStickers(spaceId: ID): SpaceSticker[] | null {
  const list = useStickers((s) => s.bySpace[spaceId] ?? null);
  useEffect(() => {
    void useStickers
      .getState()
      .loadSpace(spaceId)
      .catch(() => undefined);
  }, [spaceId]);
  return list;
}
