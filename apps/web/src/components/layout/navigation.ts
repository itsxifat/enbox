/**
 * Back navigation for header arrows (PaneHeader `back="/path"`).
 *
 * In-app links that open a detail page (chat list → chat, community → its chats, search /
 * starred results, channel lists) push their entry with `state: IN_APP_NAV`. The Back arrow of
 * such a page then goes back in history, so the phone's own back gesture doesn't reopen the
 * page just left and the page it came from (e.g. the community) is restored. Anything else —
 * a deep link, a notification, a page opened after an action — goes to the parent path and
 * replaces the current entry instead of stacking a new one.
 */
export const IN_APP_NAV = { fromApp: true } as const;

export function isInAppNav(state: unknown): boolean {
  return !!state && typeof state === 'object' && (state as { fromApp?: unknown }).fromApp === true;
}

/** How a header Back arrow should leave the current page. */
export function backTarget(
  locationState: unknown,
  historyState: unknown,
  parent: string,
): { kind: 'pop' } | { kind: 'replace'; to: string } {
  const idx = (historyState as { idx?: unknown } | null)?.idx;
  if (typeof idx === 'number' && idx > 0 && isInAppNav(locationState)) return { kind: 'pop' };
  return { kind: 'replace', to: parent };
}
