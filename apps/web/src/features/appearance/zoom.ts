/**
 * App zoom (Settings ▸ Chats ▸ Zoom level): the browser's zoom steps from 50% to 200% and the
 * Ctrl / Cmd + `=` / `-` / `0` shortcuts, which replace the browser's own zoom while Enbox has
 * focus. `stores/ui.ts` applies the level as CSS `zoom` on <html> (index.css "Zoom" keeps
 * menus, popovers and virtualised lists measuring correctly) and installs the shortcuts from
 * `initTheme`. No store import here, so ui.ts can import this module without a cycle.
 */

/** The levels the slider and the shortcuts step through (the browser's own). */
export const ZOOM_LEVELS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const;
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2;

/** A stored zoom as applied: 0.5..2, 1 for anything unusable. */
export function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(value * 100) / 100));
}

/** Index of the level closest to `value`. */
export function nearestZoomIndex(value: number): number {
  const z = clampZoom(value);
  let best = 0;
  for (let i = 1; i < ZOOM_LEVELS.length; i++)
    if (Math.abs(ZOOM_LEVELS[i]! - z) < Math.abs(ZOOM_LEVELS[best]! - z)) best = i;
  return best;
}

/** The next level above (`1`) or below (`-1`) `value`; the end levels stay put. */
export function stepZoom(value: number, direction: 1 | -1): number {
  const z = clampZoom(value);
  if (direction > 0) return ZOOM_LEVELS.find((l) => l > z + 0.001) ?? MAX_ZOOM;
  return [...ZOOM_LEVELS].reverse().find((l) => l < z - 0.001) ?? MIN_ZOOM;
}

/** "110%". */
export function zoomLabel(value: number): string {
  return `${Math.round(clampZoom(value) * 100)}%`;
}

export type ZoomShortcut = 'in' | 'out' | 'reset';

/** Ctrl / Cmd + `=` or `+` (zoom in), `-` (out), `0` (100%); numpad keys too. */
export function zoomShortcut(
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'metaKey' | 'altKey'>,
): ZoomShortcut | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') return 'in';
  if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') return 'out';
  if (e.key === '0' || e.code === 'Numpad0') return 'reset';
  return null;
}

/** The zoom a shortcut leads to from `current`. */
export function zoomAfter(shortcut: ZoomShortcut, current: number): number {
  if (shortcut === 'reset') return 1;
  return stepZoom(current, shortcut === 'in' ? 1 : -1);
}

/**
 * Listen for the zoom shortcuts on `window` (capture phase, before the page's own keys).
 * `set` receives the new level; returns the uninstall function.
 */
export function installZoomShortcuts(get: () => number, set: (zoom: number) => void): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    const shortcut = zoomShortcut(e);
    if (!shortcut) return;
    e.preventDefault();
    const next = zoomAfter(shortcut, get());
    if (next !== clampZoom(get())) set(next);
  };
  window.addEventListener('keydown', onKey, true);
  return () => window.removeEventListener('keydown', onKey, true);
}
