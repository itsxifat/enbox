import { userDisplayName, type ID, type PresenceState, type UserPublic } from '@enbox/shared';
import { Avatar, type AvatarAnimate, type AvatarSize } from '@/components/ui';
import { usePresence, useUser } from '@/stores/users';

export interface UserAvatarProps {
  /** A user object, or an id to look up in the users cache (fetched if missing). */
  user?:
    | (Pick<UserPublic, 'id' | 'displayName' | 'contactName' | 'avatarUrl'> & {
        isDeleted?: boolean;
        /** The animated original when the avatar is a GIF / WebP / APNG (poster in `avatarUrl`). */
        avatarAnimatedUrl?: string | null;
      })
    | null;
  userId?: ID | null;
  size?: AvatarSize | number;
  /** Subscribe to the user's presence and show the badge (online dot / idle moon / dnd minus). */
  showPresence?: boolean;
  ring?: 'unseen' | 'seen' | null;
  /** When the animated avatar plays (default 'hover'; see `Avatar`). */
  animate?: AvatarAnimate;
  className?: string;
}

/** Badge state from the presence cache: `state` when the server sends one, else the online flag. */
export function presenceBadge(
  presence: { online: boolean | null; state?: PresenceState | null } | undefined,
): PresenceState | null {
  if (!presence) return null;
  return presence.state ?? (presence.online ? 'online' : null);
}

export function UserAvatar({
  user,
  userId,
  size = 'md',
  showPresence = false,
  ring,
  animate,
  className,
}: UserAvatarProps) {
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
      className={className}
    />
  );
}
