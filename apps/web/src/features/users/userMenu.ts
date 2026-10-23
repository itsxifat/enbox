/**
 * Discord's user context menu (everyday wave, agent 5): Profile, Mention, Message, Call, Add
 * Note, friend nickname, Invite to Space, friend and block actions, mute, and in a Space the
 * member's moderation items. Opened from names, avatars and member rows; `UserMenuHost`
 * renders it. Returns whether it opened (callers fall back to their own menu otherwise).
 */
import type { ID } from '@enbox/shared';

export interface UserMenuOptions {
  /** In a Space: the member's per-Space items and moderation actions. */
  spaceId?: ID | null;
  /** The chat it was opened from (Mention inserts into its composer). */
  chatId?: ID | null;
}

export function openUserMenu(
  _userId: ID,
  _at: { x: number; y: number },
  _opts: UserMenuOptions = {},
): boolean {
  return false;
}
