import { useMatches } from 'react-router';

/**
 * Per-route layout flags, set with the `handle` field of a route object:
 *
 *   { path: ':chatId', element: <ConversationPane />, handle: { detail: true } }
 *
 * - `detail`   phone: this route replaces the list pane full screen (bottom tabs hidden)
 * - `hideTabs` phone: hide the bottom tab bar without being a detail (e.g. /new)
 */
export interface RouteHandle {
  detail?: boolean;
  hideTabs?: boolean;
}

/** Merged flags of all matched routes (deepest wins). */
export function useRouteHandle(): RouteHandle {
  const matches = useMatches();
  const out: RouteHandle = {};
  for (const m of matches) {
    const h = m.handle as RouteHandle | undefined;
    if (h && typeof h === 'object') Object.assign(out, h);
  }
  return out;
}
