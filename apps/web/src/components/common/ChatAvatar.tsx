import { chatTitle, type ChatSummary } from '@enbox/shared';
import { Avatar, type AvatarAnimate, type AvatarSize } from '@/components/ui';
import { usePresence } from '@/stores/users';
import { presenceBadge } from './UserAvatar';

export interface ChatAvatarProps {
  chat: Pick<
    ChatSummary,
    'id' | 'type' | 'name' | 'avatarUrl' | 'peer' | 'isAnnouncement' | 'communityId'
  >;
  size?: AvatarSize | number;
  /** Subscribe to the peer's presence and show the badge (direct chats). */
  showPresence?: boolean;
  /** When the peer's animated avatar plays (default 'hover'; see `Avatar`). */
  animate?: AvatarAnimate;
  className?: string;
}

/** Avatar for any chat: peer photo/initials for direct chats, group/channel icon fallback. */
export function ChatAvatar({
  chat,
  size = 'lg',
  showPresence = false,
  animate,
  className,
}: ChatAvatarProps) {
  const peerId = chat.type === 'direct' && showPresence ? chat.peer?.id : null;
  const presence = usePresence(peerId);
  const src = chat.type === 'direct' ? (chat.peer?.avatarUrl ?? chat.avatarUrl) : chat.avatarUrl;
  // Group/channel icons have no animated variant in P1; direct chats show the peer's.
  const animatedSrc = chat.type === 'direct' ? chat.peer?.avatarAnimatedUrl : null;
  const kind =
    chat.type === 'direct'
      ? 'user'
      : chat.type === 'channel'
        ? 'channel'
        : chat.isAnnouncement
          ? 'community'
          : 'group';
  return (
    <Avatar
      src={src}
      animatedSrc={animatedSrc}
      animate={animate}
      name={chatTitle(chat)}
      colorSeed={chat.type === 'direct' ? (chat.peer?.id ?? chat.id) : chat.id}
      kind={kind}
      size={size}
      presence={peerId ? presenceBadge(presence) : null}
      className={className}
    />
  );
}
