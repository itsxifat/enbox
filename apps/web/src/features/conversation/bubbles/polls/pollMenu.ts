/** Poll items of the message menu (polish wave, agent 2): End Poll Now. */
import type { ChatSummary } from '@enbox/shared';
import type { MenuItem } from '@/components/ui';
import type { ClientMessage } from '@/stores/messages';

/** "End Poll Now" for the poll's sender (or a moderator) while it is open, else null. */
export function pollMenuItem(
  _chat: ChatSummary,
  _m: ClientMessage,
  _me: string | undefined,
): MenuItem | null {
  return null;
}
