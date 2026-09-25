import { useSyncExternalStore } from 'react';

/** Desktop layout breakpoint (Tailwind `lg`). Keep in sync with index.css / layout. */
export const DESKTOP_QUERY = '(min-width: 1024px)';

function subscribe(query: string) {
  return (onChange: () => void) => {
    if (typeof window === 'undefined' || !window.matchMedia) return () => undefined;
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  };
}

/** Live `matchMedia(query).matches`. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribe(query),
    () =>
      typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
    () => false,
  );
}

/** True at ≥ 1024px: nav rail + list pane + main pane. False: single pane + bottom tabs. */
export function useIsDesktop(): boolean {
  return useMediaQuery(DESKTOP_QUERY);
}

/** Coarse pointer (touch) devices — prefer long-press over hover affordances. */
export function useIsTouch(): boolean {
  return useMediaQuery('(pointer: coarse)');
}
