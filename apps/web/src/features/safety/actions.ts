/**
 * Menu entries of the safety features, built by the safety builder: Report Message (message
 * menu), Ignore / Unignore and Report User (profile menu).
 */
import type { ChatSummary, ID, UserPublic } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import type { ClientMessage } from '@/stores/messages';

export function reportMessageItem(
  _chat: ChatSummary,
  _m: ClientMessage,
  _meId: ID | undefined,
): MenuEntry {
  return null;
}

export function userSafetyItems(_user: UserPublic): MenuEntry[] {
  return [];
}
