import { chatTitle, type ChatSummary } from '@enbox/shared';
import { Avatar, type AvatarSize } from '@/components/ui';
import { usePresence } from '@/stores/users';

export interface ChatAvatarProps {
  chat: Pick<
    ChatSummary,
    'id' | 'type' | 'name' | 'avatarUrl' | 'peer' | 'isAnnouncement' | 'communityId'
  >;
  size?: AvatarSize | number;
  /** Subscribe to the peer's presence and show the online dot (direct chats). */
  showPresence?: boolean;
  className?: string;
}

/** Avatar for any chat: peer photo/initials for direct chats, group/channel icon fallback. */
export function ChatAvatar({
  chat,
  size = 'lg',
  showPresence = false,
  className,
}: ChatAvatarProps) {
  const peerId = chat.type === 'direct' && showPresence ? chat.peer?.id : null;
  const presence = usePresence(peerId);
  const src = chat.type === 'direct' ? (chat.peer?.avatarUrl ?? chat.avatarUrl) : chat.avatarUrl;
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
      name={chatTitle(chat)}
      colorSeed={chat.type === 'direct' ? (chat.peer?.id ?? chat.id) : chat.id}
      kind={kind}
      size={size}
      online={!!presence?.online}
      className={className}
    />
  );
}
