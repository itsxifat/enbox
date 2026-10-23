/**
 * Back and Forward for the title bar: the trail of history entries this tab went through (by
 * location key) and where it stands in it, so the arrows know when there is somewhere to go.
 * React Router keeps the browser's index in `history.state.idx`: entries before the first one
 * the trail saw (a reload deep into the history) still count for Back. The trail is kept in
 * sessionStorage, so a reload keeps Forward too.
 *
 * Keys: Alt+← / Alt+→, ⌘[ / ⌘] on macOS (`historyKey`), registered by `useHistoryKeys`.
 */
import { useEffect, useLayoutEffect } from 'react';
import { create } from 'zustand';
import { useNavigate, type NavigationType } from 'react-router';

export interface HistoryTrail {
  /** Location keys of the entries, oldest first. */
  keys: string[];
  /** Index of the current entry in `keys`. */
  pos: number;
  /** Browser history index of `keys[0]`. */
  base: number;
}

/** Entries kept; older ones fold into `base`. */
const MAX_KEYS = 200;
const SESSION_KEY = 'enbox.titlebar.trail';

function capped(t: HistoryTrail): HistoryTrail {
  const drop = t.keys.length - MAX_KEYS;
  return drop > 0 ? { keys: t.keys.slice(drop), pos: t.pos - drop, base: t.base + drop } : t;
}

/**
 * The trail after the router committed `action` on the entry `key` (`idx`: its browser index
 * when known). A pop to an entry the trail never saw starts a new trail there, or extends it
 * by one when it is the entry right before.
 */
export function stepTrail(
  t: HistoryTrail | null,
  action: NavigationType | `${NavigationType}`,
  key: string,
  idx: number | null,
): HistoryTrail {
  if (!t) return { keys: [key], pos: 0, base: idx ?? 0 };
  if (t.keys[t.pos] === key) return t;
  if (action === 'PUSH') return capped({ keys: [...t.keys.slice(0, t.pos + 1), key], pos: t.pos + 1, base: t.base });
  if (action === 'REPLACE') return { ...t, keys: t.keys.map((k, i) => (i === t.pos ? key : k)) };
  const at = t.keys.indexOf(key);
  if (at >= 0) return { ...t, pos: at };
  if (idx !== null && idx === t.base - 1) return capped({ keys: [key, ...t.keys], pos: 0, base: idx });
  return { keys: [key], pos: 0, base: idx ?? 0 };
}

export const canGoBack = (t: HistoryTrail | null): boolean => !!t && t.base + t.pos > 0;
export const canGoForward = (t: HistoryTrail | null): boolean => !!t && t.pos < t.keys.length - 1;

function readSaved(): HistoryTrail | null {
  try {
    const t = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? 'null') as HistoryTrail | null;
    return t && Array.isArray(t.keys) && typeof t.pos === 'number' && typeof t.base === 'number' ? t : null;
  } catch {
    return null;
  }
}

function save(t: HistoryTrail): void {
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(t));
  } catch {
    /* quota / disabled */
  }
}

/** The browser index of the current entry (React Router's `history.state.idx`), if any. */
function browserIndex(): number | null {
  const idx = (window.history.state as { idx?: unknown } | null)?.idx;
  return typeof idx === 'number' ? idx : null;
}

export const useNavHistory = create<{ trail: HistoryTrail | null }>(() => ({ trail: null }));

/**
 * Record a committed navigation. The first one picks up the trail saved before a reload, unless
 * this is a fresh page (React Router's "default" key: no history state yet).
 */
export function recordNavigation(action: NavigationType | `${NavigationType}`, key: string): void {
  const cur = useNavHistory.getState().trail;
  const idx = browserIndex();
  let next: HistoryTrail;
  if (cur) next = stepTrail(cur, action, key, idx);
  else {
    const saved = key === 'default' ? null : readSaved();
    const at = saved ? saved.keys.indexOf(key) : -1;
    next = saved && at >= 0 ? { ...saved, pos: at } : stepTrail(null, action, key, idx);
  }
  if (next === cur) return;
  useNavHistory.setState({ trail: next });
  save(next);
}

/** Follow the shell's live location (AppShell): every committed entry moves the trail. */
export function useNavHistoryTracking(key: string, action: NavigationType): void {
  useLayoutEffect(() => {
    recordNavigation(action, key);
    // A new key is a new entry; the action is read with it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);

/** Shown in the arrows' tooltips and `aria-keyshortcuts`. */
export const HISTORY_KEYS = IS_MAC
  ? { back: '⌘[', forward: '⌘]', backAria: 'Meta+BracketLeft', forwardAria: 'Meta+BracketRight' }
  : { back: 'Alt+←', forward: 'Alt+→', backAria: 'Alt+ArrowLeft', forwardAria: 'Alt+ArrowRight' };

type KeyInput = Pick<KeyboardEvent, 'key' | 'code' | 'altKey' | 'ctrlKey' | 'metaKey' | 'shiftKey'>;

/** -1 (back) or 1 (forward) for Alt+← / Alt+→, or ⌘[ / ⌘] on macOS; null for other keys. */
export function historyKey(e: KeyInput, mac = IS_MAC): -1 | 1 | null {
  if (e.shiftKey || e.ctrlKey) return null;
  if (mac) {
    if (!e.metaKey || e.altKey) return null;
    if (e.key === '[' || e.code === 'BracketLeft') return -1;
    if (e.key === ']' || e.code === 'BracketRight') return 1;
    return null;
  }
  if (!e.altKey || e.metaKey) return null;
  return e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : null;
}

/**
 * Back / forward from the keyboard while there is an entry to go to (otherwise the browser
 * keeps the key). A handler that already took the key (`preventDefault`) wins.
 */
export function useHistoryKeys(): void {
  const navigate = useNavigate();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat) return;
      const dir = historyKey(e);
      if (!dir) return;
      const trail = useNavHistory.getState().trail;
      if (dir < 0 ? !canGoBack(trail) : !canGoForward(trail)) return;
      e.preventDefault();
      void navigate(dir);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);
}
