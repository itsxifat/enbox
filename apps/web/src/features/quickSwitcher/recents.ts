/**
 * Recently visited places for the Quick Switcher (this device only): keys like `chat:<id>`,
 * most recent first. Storage can be unavailable (private mode, blocked site data); the
 * switcher then simply has no recents.
 */
const KEY = 'enbox.quickSwitcher.recents';
const MAX = 20;

export function readRecents(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    const list: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.filter((k): k is string => typeof k === 'string').slice(0, MAX) : [];
  } catch {
    return [];
  }
}

export function recordVisit(key: string): void {
  try {
    const next = [key, ...readRecents().filter((k) => k !== key)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* no storage: no recents */
  }
}

/** The recents key of an app path, or null for places the switcher does not list. */
export function visitKeyOf(pathname: string): string | null {
  const space = /^\/spaces\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?/.exec(pathname);
  if (space) return space[2] ? `chat:${space[2]}` : `space:${space[1]}`;
  const chat = /^\/(?:chats|archived|starred)\/([0-9a-f-]{36})/.exec(pathname);
  return chat ? `chat:${chat[1]}` : null;
}
