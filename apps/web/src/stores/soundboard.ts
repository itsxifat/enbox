/**
 * The soundboard: the sounds of the Spaces I looked at, my soundboard volume (per device) and
 * the emoji shown over someone's tile while the sound they played is on.
 *
 * State
 * - `bySpace`  spaceId → that Space's sounds in upload order (`GET /api/spaces/:id/sounds`);
 *              `space:sounds` (realtime/soundboard.ts) keeps them current
 * - `fresh`    the lists known to be current (a reconnect clears it: next use refetches)
 * - `generation` bumps with each `invalidate` (the open picker reloads)
 * - `volume`   my soundboard volume, 0..1 (Settings → Voice; stored on this device; default 1)
 * - `flashes`  userId → the sound they just played (cleared after FLASH_MS)
 *
 * Actions
 * - `loadSpace(spaceId, { force })` / `loadSpaces(spaceIds)` (the picker: a few at a time)
 * - `create` / `update` / `remove`: the response is applied at once (the event follows)
 * - `applySpaceSounds` (`space:sounds`), `dropSpace`, `invalidate`, `setVolume`, `flash`
 *
 * Hooks: `useSpaceSounds(spaceId)` (auto-loads), `useSoundFlash(userId)`.
 */
import { useEffect } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  CreateSpaceSoundRequest,
  ID,
  SpaceSound,
  UpdateSpaceSoundRequest,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';

/** How long a played sound's emoji shows over the player's tile. */
export const FLASH_MS = 2_500;
/** Lists fetched at once when the picker opens. */
const LOAD_CONCURRENCY = 4;

export interface SoundFlash {
  emoji: string | null;
  name: string;
  /** Distinguishes two plays of the same sound. */
  key: number;
}

export interface SoundboardState {
  bySpace: Record<ID, SpaceSound[]>;
  fresh: Record<ID, true>;
  /** Bumps on `invalidate` (views that load lists reload). */
  generation: number;
  volume: number;
  flashes: Record<ID, SoundFlash>;

  loadSpace(spaceId: ID, opts?: { force?: boolean }): Promise<SpaceSound[]>;
  loadSpaces(spaceIds: readonly ID[]): Promise<void>;
  create(spaceId: ID, body: CreateSpaceSoundRequest): Promise<SpaceSound>;
  update(spaceId: ID, soundId: ID, body: UpdateSpaceSoundRequest): Promise<SpaceSound>;
  remove(spaceId: ID, soundId: ID): Promise<void>;
  applySpaceSounds(spaceId: ID, sounds: SpaceSound[]): void;
  dropSpace(spaceId: ID): void;
  invalidate(): void;
  setVolume(volume: number): void;
  flash(userId: ID, sound: Pick<SpaceSound, 'emoji' | 'name'>): void;
}

const initial = {
  bySpace: {} as Record<ID, SpaceSound[]>,
  fresh: {} as Record<ID, true>,
  generation: 0,
  flashes: {} as Record<ID, SoundFlash>,
};

const pending = new Map<ID, Promise<SpaceSound[]>>();
let flashSeq = 0;

export const useSoundboard = create<SoundboardState>()(
  persist(
    (set, get) => {
      const put = (spaceId: ID, sounds: SpaceSound[]) =>
        set((s) => ({ bySpace: { ...s.bySpace, [spaceId]: sounds }, fresh: { ...s.fresh, [spaceId]: true } }));
      const listOf = (spaceId: ID) => get().bySpace[spaceId] ?? [];

      return {
        ...initial,
        volume: 1,

        loadSpace(spaceId, { force = false } = {}) {
          const have = get().bySpace[spaceId];
          if (have && get().fresh[spaceId] && !force) return Promise.resolve(have);
          const running = pending.get(spaceId);
          if (running) return running;
          const epoch = sessionEpoch();
          const p = api
            .get<SpaceSound[]>(`/api/spaces/${spaceId}/sounds`)
            .then((list) => {
              if (epoch === sessionEpoch()) put(spaceId, list);
              return list;
            })
            .finally(() => pending.delete(spaceId));
          pending.set(spaceId, p);
          return p;
        },

        async loadSpaces(spaceIds) {
          const queue = spaceIds.filter((id) => !get().fresh[id]);
          const worker = async () => {
            for (let id = queue.shift(); id; id = queue.shift())
              await get()
                .loadSpace(id)
                .catch(() => undefined);
          };
          await Promise.all(Array.from({ length: Math.min(LOAD_CONCURRENCY, queue.length) }, worker));
        },

        async create(spaceId, body) {
          const sound = await api.post<SpaceSound>(`/api/spaces/${spaceId}/sounds`, body);
          put(spaceId, [...listOf(spaceId).filter((x) => x.id !== sound.id), sound]);
          return sound;
        },

        async update(spaceId, soundId, body) {
          const sound = await api.patch<SpaceSound>(`/api/spaces/${spaceId}/sounds/${soundId}`, body);
          put(spaceId, listOf(spaceId).map((x) => (x.id === sound.id ? sound : x)));
          return sound;
        },

        async remove(spaceId, soundId) {
          await api.delete(`/api/spaces/${spaceId}/sounds/${soundId}`);
          put(spaceId, listOf(spaceId).filter((x) => x.id !== soundId));
        },

        applySpaceSounds(spaceId, sounds) {
          put(spaceId, sounds);
        },

        dropSpace(spaceId) {
          set((s) => {
            const { [spaceId]: _list, ...bySpace } = s.bySpace;
            const { [spaceId]: _fresh, ...fresh } = s.fresh;
            return { bySpace, fresh };
          });
        },

        invalidate() {
          set((s) => ({ fresh: {}, generation: s.generation + 1 }));
        },

        setVolume(volume) {
          set({ volume: Math.min(1, Math.max(0, volume)) });
        },

        flash(userId, sound) {
          const key = ++flashSeq;
          set((s) => ({ flashes: { ...s.flashes, [userId]: { emoji: sound.emoji, name: sound.name, key } } }));
          setTimeout(() => {
            if (get().flashes[userId]?.key !== key) return;
            set((s) => {
              const { [userId]: _gone, ...flashes } = s.flashes;
              return { flashes };
            });
          }, FLASH_MS);
        },
      };
    },
    { name: 'enbox.soundboard', partialize: (s) => ({ volume: s.volume }) },
  ),
);

// The volume is this device's; the lists belong to the account.
registerSessionReset(() => {
  pending.clear();
  useSoundboard.setState({ ...initial });
});

/** One Space's sounds (loads them on first use and after a reconnect); null while loading. */
export function useSpaceSounds(spaceId: ID | null | undefined): SpaceSound[] | null {
  const list = useSoundboard((s) => (spaceId ? (s.bySpace[spaceId] ?? null) : null));
  const fresh = useSoundboard((s) => (spaceId ? !!s.fresh[spaceId] : true));
  useEffect(() => {
    if (spaceId && !fresh)
      void useSoundboard
        .getState()
        .loadSpace(spaceId)
        .catch(() => undefined);
  }, [spaceId, fresh]);
  return list;
}

/** The sound `userId` is playing right now (its emoji shows over their tile). */
export function useSoundFlash(userId: ID): SoundFlash | null {
  return useSoundboard((s) => s.flashes[userId] ?? null);
}
