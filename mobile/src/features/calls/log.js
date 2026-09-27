/** Presentation helpers shared by the call log list and the call details page (web ui/log.tsx). */
import { View } from 'react-native';
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react-native';
import { chatTitle, formatDuration } from '@enbox/shared';
import { ICON_STROKE_BOLD, Icon, VideoIcon } from '@/components/icons';
import { Avatar, toast } from '@/components/ui';
import { useCalls } from '@/stores/calls';
import { useTheme } from '@/theme';
import { isMissedEntry } from './logic';

export function CallChatAvatar({ chat, size = 'lg' }) {
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
export function outcomeText(e) {
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
export function DirectionIcon({ entry }) {
  const { tw, c } = useTheme();
  const bad =
    isMissedEntry(entry) || (entry.direction === 'incoming' && entry.outcome === 'declined');
  const Arrow = entry.direction === 'incoming' ? ArrowDownLeft : ArrowUpRight;
  return (
    <View style={tw`flex-row items-center gap-0.5`}>
      <Icon
        icon={Arrow}
        size={16}
        strokeWidth={ICON_STROKE_BOLD}
        color={
          bad
            ? c.danger
            : entry.outcome === 'answered' || entry.outcome === 'ongoing'
              ? c.success
              : c.subtle
        }
      />
      {entry.call.type === 'video' ? <Icon icon={VideoIcon} size={14} color={c.subtle} /> : null}
    </View>
  );
}

export function durationText(entry) {
  return entry.call.durationSec ? formatDuration(entry.call.durationSec * 1000) : null;
}

/** Remove entries from my call log (one request each), with a toast. */
export async function removeEntries(entries) {
  try {
    for (const e of entries) await useCalls.getState().removeLogEntry(e.call.id);
    toast.success(entries.length > 1 ? 'Calls removed' : 'Call removed');
  } catch (e) {
    toast.error(e);
  }
}
