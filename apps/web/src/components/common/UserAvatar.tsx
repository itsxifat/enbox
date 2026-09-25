import { userDisplayName, type ID, type UserPublic } from '@enbox/shared';
import { Avatar, type AvatarSize } from '@/components/ui';
import { usePresence, useUser } from '@/stores/users';

export interface UserAvatarProps {
  /** A user object, or an id to look up in the users cache (fetched if missing). */
  user?: Pick<UserPublic, 'id' | 'displayName' | 'contactName' | 'avatarUrl' | 'isDeleted'> | null;
  userId?: ID | null;
  size?: AvatarSize | number;
  showPresence?: boolean;
  ring?: 'unseen' | 'seen' | null;
  className?: string;
}

export function UserAvatar({
  user,
  userId,
  size = 'md',
  showPresence = false,
  ring,
  className,
}: UserAvatarProps) {
  const cached = useUser(user ? null : userId);
  const u = user ?? cached;
  const presence = usePresence(showPresence ? (u?.id ?? userId) : null);
  return (
    <Avatar
      src={u?.isDeleted ? null : u?.avatarUrl}
      name={userDisplayName(u)}
      colorSeed={u?.id ?? userId ?? undefined}
      size={size}
      online={!!presence?.online}
      ring={ring}
      className={className}
    />
  );
}
