import { useSyncExternalStore } from 'react';

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
