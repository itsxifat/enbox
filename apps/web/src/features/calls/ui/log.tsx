/** Presentation helpers shared by the call log list and the call details page. */
import { ArrowDownLeft, ArrowUpRight, Video } from 'lucide-react';
import { chatTitle, formatDuration, type CallLogEntry } from '@enbox/shared';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { Avatar, toast, type AvatarSize } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useCalls } from '@/stores/calls';
import { isMissedEntry } from '../logic';

export function CallChatAvatar({
  chat,
  size = 'lg',
}: {
  chat: CallLogEntry['chat'];
  size?: AvatarSize | number;
}) {
  const direct = chat.type === 'direct';
  return (
    <Avatar
      src={direct ? (chat.peer?.isDeleted ? null : chat.peer?.avatarUrl) : chat.avatarUrl}
      name={chatTitle(chat)}
      colorSeed={direct ? (chat.peer?.id ?? chat.id) : chat.id}
      kind={direct ? 'user' : 'group'}
      size={size}
    />
  );
}

/** "Missed", "Declined", "No answer", "Cancelled", "Ongoing", or "" for answered calls. */
export function outcomeText(e: Pick<CallLogEntry, 'direction' | 'outcome'>): string {
  switch (e.outcome) {
    case 'missed':
      return 'Missed';
    case 'declined':
      return e.direction === 'outgoing' ? 'Declined' : 'You declined';
    case 'unanswered':
      return 'No answer';
    case 'cancelled':
      return 'Cancelled';
    case 'ongoing':
      return 'Ongoing';
    default:
      return '';
  }
}

/** Direction arrow (red when missed/declined incoming), video badge for video calls. */
export function DirectionIcon({ entry, className }: { entry: CallLogEntry; className?: string }) {
  const bad =
    isMissedEntry(entry) || (entry.direction === 'incoming' && entry.outcome === 'declined');
  const Arrow = entry.direction === 'incoming' ? ArrowDownLeft : ArrowUpRight;
  return (
    <span className={cn('inline-flex shrink-0 items-center gap-0.5', className)}>
      <Arrow
        size={16}
        strokeWidth={ICON_STROKE_BOLD}
        className={
          bad
            ? 'text-danger'
            : entry.outcome === 'answered' || entry.outcome === 'ongoing'
              ? 'text-success'
              : 'text-subtle'
        }
        aria-label={entry.direction === 'incoming' ? 'Incoming' : 'Outgoing'}
        role="img"
      />
      {entry.call.type === 'video' ? (
        <Video size={14} className="text-subtle" aria-label="Video" role="img" />
      ) : null}
    </span>
  );
}

export function durationText(entry: CallLogEntry): string | null {
  return entry.call.durationSec ? formatDuration(entry.call.durationSec * 1000) : null;
}

/** Remove entries from my call log (one request each), with a toast. */
export async function removeEntries(entries: CallLogEntry[]): Promise<void> {
  try {
    for (const e of entries) await useCalls.getState().removeLogEntry(e.call.id);
    toast.success(entries.length > 1 ? 'Calls removed' : 'Call removed');
  } catch (e) {
    toast.error(e);
  }
}
