/**
 * Where I was, per account on this device: the last app route (a fresh start on `/` or plain
 * `/chats` reopens it) and the last page under Home (the rail's Home tile goes back there).
 * Each Space's last channel is `spaceMemory`'s (features/spaces/actions.ts).
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { storage } from '@/lib/storage';

const routeKey = (userId: ID) => `enbox.frame.lastRoute.${userId}`;
const homeKey = (userId: ID) => `enbox.frame.lastHome.${userId}`;

/** Routes worth reopening on start: conversations, Spaces and their channels, the main pages. */
const RESTORABLE = [
  /^\/(?:chats|archived|starred)(?:\/[^/]+)?$/,
  /^\/spaces(?:\/[^/]+(?:\/(?!settings$)[^/]+)?)?$/,
  /^\/(?:discover|message-requests|updates|calls)$/,
];

export function isRestorable(pathname: string): boolean {
  return RESTORABLE.some((re) => re.test(pathname));
}

/** Home's own pages: Friends and the DMs (`/chats[/:chatId]`). */
export function isHomeRoute(pathname: string): boolean {
  return /^\/chats(?:\/[^/]+)?$/.test(pathname);
}

/** The last Home page, live for the rail's Home tile. */
export const useLastHome = create<{ userId: ID | null; path: string | null }>(() => ({ userId: null, path: null }));

/** Remember `pathname` as where I am (nothing for pages not worth reopening). */
export function rememberLocation(userId: ID, pathname: string): void {
  if (!isRestorable(pathname)) return;
  storage.set(routeKey(userId), pathname);
  if (isHomeRoute(pathname)) {
    storage.set(homeKey(userId), pathname);
    useLastHome.setState({ userId, path: pathname });
  }
}

export function lastRoute(userId: ID): string | null {
  const path = storage.get(routeKey(userId));
  return path && isRestorable(path) ? path : null;
}

/**
 * Where the shell should go instead of its first location: the last route, when the app
 * starts on its front door (`/`, or `/chats` with nothing in the URL — the installed app's
 * start page and the login default). Pure but for reading storage.
 */
export function startRedirect(
  userId: ID | null | undefined,
  at: { pathname: string; search: string; hash: string },
): { from: string; to: string } | null {
  if (!userId) return null;
  const door = at.pathname === '/' || (at.pathname === '/chats' && !at.search && !at.hash);
  const to = door ? lastRoute(userId) : null;
  return to && to !== at.pathname ? { from: at.pathname, to } : null;
}

const STARTED_KEY = 'enbox.frame.started';

/**
 * The first start of the app in this tab: true once, then false for reloads and later visits
 * to the front door (on phones `/chats` is the chat list, which a reload must keep showing).
 */
function claimFreshStart(): boolean {
  try {
    if (sessionStorage.getItem(STARTED_KEY)) return false;
    sessionStorage.setItem(STARTED_KEY, '1');
  } catch {
    // Storage blocked: every load counts as a fresh start.
  }
  return true;
}

/**
 * AppShell: the redirect to the last route while the shell is still on the location it
 * started on (the tab's first start only), and the memory of where I go next (settings and
 * other one-off pages are skipped).
 */
export function useLastLocation(
  userId: ID | null | undefined,
  location: { pathname: string; search: string; hash: string },
): string | null {
  const [start, setStart] = useState(() =>
    userId && claimFreshStart() ? startRedirect(userId, location) : null,
  );
  // Once the shell has left its first location, the start is over.
  if (start && location.pathname !== start.from) setStart(null);
  const redirect = start && location.pathname === start.from ? start.to : null;
  useEffect(() => {
    if (!userId) return;
    if (useLastHome.getState().userId !== userId)
      useLastHome.setState({ userId, path: storage.get(homeKey(userId)) });
  }, [userId]);
  useEffect(() => {
    if (userId && !redirect) rememberLocation(userId, location.pathname);
  }, [userId, location.pathname, redirect]);
  return redirect;
}
