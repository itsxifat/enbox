import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { bus } from '@/lib/bus';
import { registerSessionReset } from '@/lib/session';

/**
 * Open someone's profile card (or my own, with the availability picker) from anywhere:
 * anchored to the trigger element on desktop, a sheet on phones; `null` for a centered
 * dialog. The card itself is rendered by the one `ProfileCardHost` mounted in AppShell.
 */
export function openProfile(
  userId: ID,
  anchor: HTMLElement | { x: number; y: number } | null = null,
  opts: { spaceId?: ID } = {},
): void {
  bus.emit('profile:open', { userId, anchor, spaceId: opts.spaceId });
}

/** The full profile's tabs. */
export type FullProfileTab = 'about' | 'spaces' | 'friends' | 'groups';

export interface FullProfileRequest {
  userId: ID;
  /** Opened inside a Space: its per-Space profile, roles and join date. */
  spaceId?: ID;
  tab?: FullProfileTab;
}

/** The open full profile modal (rendered by ProfileCardHost); null = closed. */
export const useFullProfileRequest = create<{ req: FullProfileRequest | null }>(() => ({
  req: null,
}));

/** Open the full profile modal (~600px; a full-height sheet on phones). */
export function openFullProfile(
  userId: ID,
  opts: { spaceId?: ID; tab?: FullProfileTab } = {},
): void {
  useFullProfileRequest.setState({ req: { userId, ...opts } });
}

export function closeFullProfile(): void {
  if (useFullProfileRequest.getState().req) useFullProfileRequest.setState({ req: null });
}

registerSessionReset(closeFullProfile);
