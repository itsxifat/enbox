/** The message menu's Bookmark and Remind Me items (everyday wave, agent 6). */
import type { ChatSummary } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import type { ClientMessage } from '@/stores/messages';

export function bookmarkMenuItems(_chat: ChatSummary, _m: ClientMessage): MenuEntry[] {
  return [];
}
