/**
 * One-line message previews with a type icon (chat rows, search results, starred list,
 * reply quotes, pinned bar). Text comes from the shared `messagePreviewText`; its emoji
 * prefix is replaced by a crisp icon.
 */
import {
  Ban,
  BarChart3,
  Camera,
  FileText,
  Headphones,
  MapPin,
  Mic,
  Phone,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  UserRound,
  Video,
  type LucideIcon,
} from 'lucide-react';
import {
  callOutcome,
  chatKindOf,
  messagePreviewText,
  type ChatSummary,
  type ID,
  type Message,
  type MessageType,
} from '@enbox/shared';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { nameOf } from '@/stores/users';

const TYPE_ICONS: Partial<Record<MessageType, LucideIcon>> = {
  image: Camera,
  video: Video,
  voice: Mic,
  audio: Headphones,
  file: FileText,
  location: MapPin,
  contact: UserRound,
  poll: BarChart3,
};

const EMOJI_PREFIX = /^(?:📷|🎥|🎤|🎵|📄|📍|👤|📊)\s?/u;

/** Name for rendering a mention token: my own display name instead of "You". */
export function mentionName(id: ID): string {
  const you = useAuth.getState().user?.displayName;
  return nameOf(id, you ? { you } : {});
}

export interface PreviewParts {
  icon: LucideIcon | null;
  text: string;
  italic?: boolean;
  danger?: boolean;
}

export function typeIcon(type: MessageType): LucideIcon | null {
  return TYPE_ICONS[type] ?? null;
}

export function previewParts(
  m: Message,
  opts: { meId?: ID | null; chat?: Pick<ChatSummary, 'type' | 'isAnnouncement'> | null } = {},
): PreviewParts {
  const viewerId = opts.meId ?? undefined;
  // "@Me" mentions read as my name (like the sender typed it); system texts say "You".
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
        ? Video
        : missed
          ? PhoneMissed
          : outcome === 'ongoing'
            ? Phone
            : direction === 'outgoing'
              ? PhoneOutgoing
              : PhoneIncoming;
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

export function PreviewLine({
  parts,
  className,
  iconClassName,
}: {
  parts: PreviewParts;
  className?: string;
  iconClassName?: string;
}) {
  const Icon = parts.icon;
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1', className)}>
      {Icon ? (
        <Icon
          size={16}
          className={cn('shrink-0', parts.danger ? 'text-danger' : 'opacity-80', iconClassName)}
          aria-hidden
        />
      ) : null}
      <span className={cn('truncate', parts.italic && 'italic')}>{parts.text}</span>
    </span>
  );
}
