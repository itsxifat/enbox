/**
 * Go Live in my voice room: whose streams I watch, who watches each stream and the tile in
 * focus. The voice engine follows `watching` (it subscribes to a stream's screen and tab audio
 * only while I watch it) and keeps `viewers` from the room's data messages (viewers.ts).
 *
 * - `watching`  remote streamers I watch, by identity (= user id). Watching focuses the stream.
 * - `viewers`   streamer → who watches their stream (me included when I do; my own stream's
 *               viewers are the others)
 * - `focus`     the tile in focus (`tileKey`), or null for the grid
 *
 * A stream that ends (`streamEnded`) or a participant who leaves (`participantLeft`) takes its
 * watching, viewers and focus along; leaving the room (`reset`) clears everything.
 */
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { registerSessionReset } from '@/lib/session';

export type TileKind = 'camera' | 'screen';

/** A tile of the voice grid: someone's camera (or avatar) or their stream. */
export function tileKey(identity: ID, kind: TileKind): string {
  return `${identity}:${kind}`;
}

export interface StreamsState {
  watching: Record<ID, true>;
  viewers: Record<ID, Record<ID, true>>;
  focus: string | null;

  /** Watch a stream (and focus it). */
  watch(streamer: ID): void;
  stopWatching(streamer: ID): void;
  setFocus(key: string | null): void;
  /** Focus a tile, or go back to the grid when it is the one in focus. */
  toggleFocus(key: string): void;
  /** `viewer` watches exactly `streams` now (their data message). */
  setViewing(viewer: ID, streams: readonly ID[]): void;
  streamEnded(streamer: ID): void;
  participantLeft(identity: ID): void;
  reset(): void;
}

const initial = {
  watching: {} as Record<ID, true>,
  viewers: {} as Record<ID, Record<ID, true>>,
  focus: null as string | null,
};

function without<T>(rec: Record<ID, T>, key: ID): Record<ID, T> {
  if (!(key in rec)) return rec;
  const next = { ...rec };
  delete next[key];
  return next;
}

/** Focus stays unless it showed one of `keys`. */
function focusWithout(focus: string | null, ...keys: string[]): string | null {
  return focus && keys.includes(focus) ? null : focus;
}

export const useStreams = create<StreamsState>((set) => ({
  ...initial,

  watch(streamer) {
    set((s) => ({
      watching: s.watching[streamer] ? s.watching : { ...s.watching, [streamer]: true },
      focus: tileKey(streamer, 'screen'),
    }));
  },

  stopWatching(streamer) {
    set((s) => ({ watching: without(s.watching, streamer) }));
  },

  setFocus(focus) {
    set({ focus });
  },

  toggleFocus(key) {
    set((s) => ({ focus: s.focus === key ? null : key }));
  },

  setViewing(viewer, streams) {
    set((s) => {
      const want = new Set(streams);
      let changed = false;
      const viewers = { ...s.viewers };
      for (const [streamer, who] of Object.entries(s.viewers)) {
        if (who[viewer] && !want.has(streamer)) {
          viewers[streamer] = without(who, viewer);
          changed = true;
        }
      }
      for (const streamer of want) {
        if (viewers[streamer]?.[viewer]) continue;
        viewers[streamer] = { ...viewers[streamer], [viewer]: true };
        changed = true;
      }
      return changed ? { viewers } : s;
    });
  },

  streamEnded(streamer) {
    set((s) => ({
      watching: without(s.watching, streamer),
      viewers: without(s.viewers, streamer),
      focus: focusWithout(s.focus, tileKey(streamer, 'screen')),
    }));
  },

  participantLeft(identity) {
    set((s) => {
      const viewers: Record<ID, Record<ID, true>> = {};
      for (const [streamer, who] of Object.entries(s.viewers))
        if (streamer !== identity) viewers[streamer] = without(who, identity);
      return {
        watching: without(s.watching, identity),
        viewers,
        focus: focusWithout(s.focus, tileKey(identity, 'screen'), tileKey(identity, 'camera')),
      };
    });
  },

  reset() {
    set({ ...initial });
  },
}));

registerSessionReset(() => useStreams.setState({ ...initial }));

/** How many watch `streamer`'s stream. */
export function useViewerCount(streamer: ID): number {
  return useStreams((s) => Object.keys(s.viewers[streamer] ?? {}).length);
}
