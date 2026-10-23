/**
 * The server tag a user wears, next to their name (chat rows, member list, profiles): the
 * badge in its colour and the 2-4 letter tag, the Space's name as its tooltip when it is one
 * of mine. Renders nothing when they wear none. Pass `tag` when the caller already has the
 * user's profile; otherwise it comes from the users store (`useWornTag`).
 */
import type { ID, Space, UserSpaceTag } from '@enbox/shared';
import { useAuth } from '@/stores/auth';
import { useSpaces } from '@/stores/spaces';
import { useUser } from '@/stores/users';
import { TagPill } from './TagPill';

const hasTaggedSpace = (byId: Record<ID, Space>) => Object.values(byId).some((s) => !!s.tag);

/**
 * The tag `userId` wears per the users store (the user is loaded when missing). Mine only
 * while one of my Spaces has a tag: I can only wear the tag of a Space I'm in, so rows never
 * load my own profile for nothing.
 */
export function useWornTag(userId: ID | null | undefined): UserSpaceTag | null {
  const mine = useAuth((s) => !!userId && s.user?.id === userId);
  const mayWear = useSpaces((s) => !mine || hasTaggedSpace(s.byId));
  return useUser(userId && mayWear ? userId : null)?.spaceTag ?? null;
}

export function ServerTagPill({
  userId,
  tag,
  size = 'sm',
  className,
}: {
  userId: string;
  /** The tag from a profile the caller holds (null = none); omitted = the users store's. */
  tag?: UserSpaceTag | null;
  size?: 'sm' | 'md';
  className?: string;
}) {
  const stored = useWornTag(tag === undefined ? userId : null);
  const worn = tag === undefined ? stored : tag;
  const spaceName = useSpaces((s) => (worn ? s.byId[worn.spaceId]?.name : undefined));
  if (!worn) return null;
  return (
    <TagPill
      tag={worn}
      size={size}
      title={spaceName ? `Tag from ${spaceName}` : 'Space tag'}
      className={className}
    />
  );
}
