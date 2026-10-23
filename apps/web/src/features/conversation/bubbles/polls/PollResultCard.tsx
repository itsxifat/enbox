/**
 * The message posted when a poll ends (polish wave, agent 2): who asked, the winning answer
 * and a jump to the poll. SystemPill renders it for `system.kind === 'poll_result'`.
 */
import { systemEventText, type SystemEvent } from '@enbox/shared';
import type { ClientMessage } from '@/stores/messages';
import { nameOf } from '@/stores/users';

export function PollResultCard({
  event,
}: {
  m: ClientMessage;
  event: Extract<SystemEvent, { kind: 'poll_result' }>;
  onJump?: (messageId: string) => void;
}) {
  return (
    <div className="flex justify-center px-4 py-1 text-[12.5px] text-muted">
      {systemEventText(event, (id) => nameOf(id))}
    </div>
  );
}
