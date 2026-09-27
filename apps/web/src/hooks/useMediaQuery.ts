import { useSyncExternalStore } from 'react';
import { useUi } from '@/stores/ui';

/** Desktop layout breakpoint (Tailwind `lg`). Keep in sync with index.css / layout. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

interface QueryStore {
  subscribe(onChange: () => void): () => void;
  getSnapshot(): boolean;
}

/**
 * One MediaQueryList and one stable subscribe/getSnapshot pair per query: a new `subscribe`
 * identity per render would make useSyncExternalStore unsubscribe and resubscribe (and call
 * matchMedia again) on every render of every consumer.
 */
const stores = new Map<string, QueryStore>();

function storeFor(query: string): QueryStore {
  let store = stores.get(query);
  if (!store) {
    const mql =
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query) : null;
    store = {
      subscribe(onChange) {
        mql?.addEventListener('change', onChange);
        return () => mql?.removeEventListener('change', onChange);
      },
      getSnapshot: () => mql?.matches ?? false,
    };
    stores.set(query, store);
  }
  return store;
}

const serverSnapshot = () => false;

/** Live `matchMedia(query).matches`. */
export function useMediaQuery(query: string): boolean {
  const store = storeFor(query);
  return useSyncExternalStore(store.subscribe, store.getSnapshot, serverSnapshot);
}

/** True at ≥ 1024px: nav rail + list pane + main pane. False: single pane + bottom tabs. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

/** Coarse pointer (touch) devices — prefer long-press over hover affordances. */
export function useIsTouch(): boolean {
  return useMediaQuery('(pointer: coarse)');
}

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Reduced motion: the OS media query OR the device pref `reduceMotion: 'on'`; the pref 'off'
 * overrides the OS setting. Animated avatars/GIFs show their poster and scrolling is instant
 * while this is true (the CSS clamp in index.css covers keyframe animations/transitions).
 */
export function useReducedMotion(): boolean {
  const system = useMediaQuery(REDUCED_MOTION_QUERY);
  const pref = useUi((s) => s.prefs.reduceMotion);
  return pref === 'on' || (pref === 'system' && system);
}
