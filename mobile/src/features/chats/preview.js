/**
 * One-line message previews with a type icon (chat rows, search results, starred list,
 * reply quotes, pinned bar). Text comes from the shared `messagePreviewText`; its emoji
 * prefix is replaced by a crisp icon.
 */
import { View } from 'react-native';
import {
  Ban,
  BarChart3,
  Camera,
  FileText,
  Headphones,
  MapPin,
  Mic,
  UserRound,
} from 'lucide-react-native';
import { callOutcome, chatKindOf, messagePreviewText } from '@enbox/shared';
import {
  Icon,
  PhoneIcon,
  PhoneIncomingIcon,
  PhoneMissedIcon,
  PhoneOutgoingIcon,
  VideoIcon,
} from '@/components/icons';
import { T } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { nameOf } from '@/stores/users';
import { alpha, useTheme } from '@/theme';

const TYPE_ICONS = {
  image: Camera,
  video: VideoIcon,
  voice: Mic,
  audio: Headphones,
  file: FileText,
  location: MapPin,
  contact: UserRound,
  poll: BarChart3,
};

const EMOJI_PREFIX = /^(?:📷|🎥|🎤|🎵|📄|📍|👤|📊)\s?/u;

/** Name for rendering a mention token: my own display name instead of "You". */
export function mentionName(id) {
  const you = useAuth.getState().user?.displayName;
  return nameOf(id, you ? { you } : {});
}

export function typeIcon(type) {
  return TYPE_ICONS[type] ?? null;
}

export function previewParts(m, opts = {}) {
  const viewerId = opts.meId ?? undefined;
  const you = m.type === 'system' ? undefined : useAuth.getState().user?.displayName;
  const text = messagePreviewText(m, (id) => nameOf(id, you ? { you } : {}), {
    viewerId,
    chatKind: opts.chat ? chatKindOf(opts.chat) : undefined,
  });
  if (m.deletedAt) return { icon: Ban, text, italic: true };
  if (m.type === 'call' && m.call) {
    const { direction, outcome } = callOutcome(m.call, viewerId);
    const missed = outcome === 'missed';
    const icon =
      m.call.callType === 'video'
        ? VideoIcon
        : missed
          ? PhoneMissedIcon
          : outcome === 'ongoing'
            ? PhoneIcon
            : direction === 'outgoing'
              ? PhoneOutgoingIcon
              : PhoneIncomingIcon;
    return { icon, text, danger: missed };
  }
  if (m.type === 'voice') {
    return {
      icon: Mic,
      text: text.replace(EMOJI_PREFIX, '').replace(/^Voice message \((.+)\)$/, '$1'),
    };
  }
  return { icon: typeIcon(m.type), text: text.replace(EMOJI_PREFIX, '') };
}

/** Icon + one truncated line; `color` defaults to the surrounding muted text. */
export function PreviewLine({ parts, color, style, textStyle, size = 14 }) {
  const { tw, c } = useTheme();
  const fg = color ?? c.muted;
  return (
    <View style={[tw`min-w-0 shrink flex-row items-center gap-1`, style]}>
      {parts.icon ? (
        <Icon icon={parts.icon} size={16} color={parts.danger ? c.danger : alpha(fg, 0.8)} />
      ) : null}
      <T
        numberOfLines={1}
        style={[
          { fontSize: size, lineHeight: size * 1.375, color: fg, flexShrink: 1 },
          parts.italic ? { fontStyle: 'italic' } : null,
          textStyle,
        ]}
      >
        {parts.text}
      </T>
    </View>
  );
}
