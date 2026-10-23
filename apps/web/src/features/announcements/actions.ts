/** Message menu ▸ Publish (announcement channels; the announcements builder). */
import type { ChatSummary } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import type { ClientMessage } from '@/stores/messages';

export function publishMessageItem(_chat: ChatSummary, _m: ClientMessage): MenuEntry {
  return null;
}
