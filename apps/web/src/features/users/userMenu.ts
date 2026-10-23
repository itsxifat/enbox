/**
 * Discord's user context menu (everyday wave, agent 5): Profile, Message, Call, Add Note, friend
 * nickname, Invite to Space, friend and block actions, and in a Space the member's moderation
 * items. Opened from names, avatars and member rows; `UserMenuHost` renders it, and the dialogs
 * its items open (note, friend nickname, the member's Space dialogs) so they outlive the menu.
 * Returns whether it opened (callers fall back to their own menu otherwise).
 */
import { create } from 'zustand';
import type { ID } from '@enbox/shared';
import { registerSessionReset } from '@/lib/session';
import type { MemberDialogKind } from '@/features/spaces/MemberActions';

export interface UserMenuOptions {
  /** In a Space: the member's per-Space items and moderation actions. */
  spaceId?: ID | null;
  /** The chat it was opened from (Mention inserts into its composer). */
  chatId?: ID | null;
}

export interface UserMenuRequest {
  userId: ID;
  at: { x: number; y: number };
  opts: UserMenuOptions;
}

export type UserDialog =
  | { kind: 'note'; userId: ID }
  | { kind: 'nickname'; userId: ID }
  | { kind: 'member'; userId: ID; spaceId: ID; dialog: MemberDialogKind };

interface UserMenuState {
  menu: UserMenuRequest | null;
  dialog: UserDialog | null;
}

export const useUserMenu = create<UserMenuState>(() => ({ menu: null, dialog: null }));

export function openUserMenu(
  userId: ID,
  at: { x: number; y: number },
  opts: UserMenuOptions = {},
): boolean {
  if (!userId) return false;
  useUserMenu.setState({ menu: { userId, at, opts } });
  return true;
}

export function closeUserMenu(): void {
  if (useUserMenu.getState().menu) useUserMenu.setState({ menu: null });
}

/** Show a dialog of the user menu (also used by the DM list's row menu). */
export function openUserDialog(dialog: UserDialog): void {
  useUserMenu.setState({ dialog });
}

export function closeUserDialog(): void {
  if (useUserMenu.getState().dialog) useUserMenu.setState({ dialog: null });
}

registerSessionReset(() => useUserMenu.setState({ menu: null, dialog: null }));
