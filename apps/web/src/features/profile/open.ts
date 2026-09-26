import type { ID } from '@enbox/shared';
import { bus } from '@/lib/bus';

/**
 * Open someone's profile card (or my own, with the availability picker) from anywhere:
 * anchored to the trigger element on desktop, a sheet on phones; `null` for a centered
 * dialog. The card itself is rendered by the one `ProfileCardHost` mounted in AppShell.
 */
export function openProfile(
  userId: ID,
  anchor: HTMLElement | { x: number; y: number } | null = null,
): void {
  bus.emit('profile:open', { userId, anchor });
}
