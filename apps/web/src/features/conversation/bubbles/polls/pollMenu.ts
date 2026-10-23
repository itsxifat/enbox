/** Poll items of the message menu: End Poll Now. */
import { TimerOff } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import type { MenuItem } from '@/components/ui';
import type { ClientMessage } from '@/stores/messages';
import { canEndPoll } from './model';
import { endPoll } from './pollActions';

/** "End Poll Now" for the poll's sender (or a moderator) while it is open, else null. */
export function pollMenuItem(
  chat: ChatSummary,
  m: ClientMessage,
  me: string | undefined,
): MenuItem | null {
  if (!canEndPoll(chat, m, me)) return null;
  return { label: 'End Poll Now', icon: TimerOff, onSelect: () => void endPoll(m) };
}
