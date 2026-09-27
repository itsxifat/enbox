/**
 * `ChatAvatar` (peer photo/initials for direct chats, group/channel/community icon fallback)
 * and `UserAvatar` (a user object or id from the users cache) — web components/common.
 */
import { chatTitle, userDisplayName } from '@enbox/shared';
import { Avatar } from '@/components/ui';
import { usePresence, useUser } from '@/stores/users';

/** Badge state from the presence cache: `state` when the server sends one, else the online flag. */
export function presenceBadge(presence) {
  if (!presence) return null;
  return presence.state ?? (presence.online ? 'online' : null);
}

export function ChatAvatar({ chat, size = 'lg', showPresence = false, animate, ring, style }) {
  const peerId = chat.type === 'direct' && showPresence ? chat.peer?.id : null;
  const presence = usePresence(peerId);
  const src = chat.type === 'direct' ? (chat.peer?.avatarUrl ?? chat.avatarUrl) : chat.avatarUrl;
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
      ring={ring}
      presence={peerId ? presenceBadge(presence) : null}
      style={style}
    />
  );
}

export function UserAvatar({
  user,
  userId,
  size = 'md',
  showPresence = false,
  ring,
  animate,
  style,
}) {
  const cached = useUser(user ? null : userId);
  const u = user ?? cached;
  const presence = usePresence(showPresence ? (u?.id ?? userId) : null);
  return (
    <Avatar
      src={u?.isDeleted ? null : u?.avatarUrl}
      animatedSrc={u?.isDeleted ? null : u?.avatarAnimatedUrl}
      animate={animate}
      name={userDisplayName(u)}
      colorSeed={u?.id ?? userId ?? undefined}
      size={size}
      presence={showPresence ? presenceBadge(presence) : null}
      ring={ring}
      style={style}
    />
  );
}
