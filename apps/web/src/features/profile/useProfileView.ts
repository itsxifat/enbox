import { useState } from 'react';
import { userDisplayName, type ID, type Space, type SpaceMember } from '@enbox/shared';
// The module itself, not the folder's index: the editor there renders ProfileCard.
import { withSpaceProfile } from '@/features/spaces/serverProfile/merge';
import { useMe } from '@/stores/auth';
import { useSpace, useSpaceAuthor, useSpaceMember } from '@/stores/spaces';
import { hasSpaceOverrides, type ProfileCardUser } from './model';

/** How a profile surface shows a user, in or out of a Space. */
export interface ProfileView {
  /** The user with the per-Space profile laid over it (unless viewing the main profile). */
  shown: ProfileCardUser;
  /** Nickname in the Space (unless viewing the main profile), else the saved / display name. */
  name: string;
  /** The real display name when `name` is something else (a nickname or a saved name). */
  alias: string | null;
  space: Space | undefined;
  /** Their membership of the Space (mine from `space.me`): roles and join date. */
  member: SpaceMember | null;
  /** Space owner (crown badge). */
  owner: boolean;
  /** The member set a per-Space profile: offer "View Main Profile". */
  hasOverrides: boolean;
  showMain: boolean;
  setShowMain: (main: boolean) => void;
}

/**
 * The Space context of a profile surface: the member's nickname, roles, join date and
 * per-Space profile (`useSpaceAuthor` — batch-loads a member not seen yet — merged with
 * `withSpaceProfile`: avatar, banner, bio, pronouns, colours, decoration, effect and nameplate
 * win over the main profile), with a toggle back to the main profile. Outside a Space it is
 * the user as is.
 */
export function useProfileView(user: ProfileCardUser, spaceId?: ID | null): ProfileView {
  const me = useMe();
  const self = !!me && me.id === user.id;
  const inSpace = !!spaceId && !user.isDeleted;
  const space = useSpace(inSpace ? spaceId : null);
  const author = useSpaceAuthor(inSpace ? spaceId : null, user.id);
  const stored = useSpaceMember(inSpace && !self ? spaceId : null, user.id);
  const [showMain, setShowMain] = useState(false);

  let member: SpaceMember | null = null;
  if (inSpace && space) member = self ? { ...space.me, userId: user.id } : (stored ?? null);
  const hasOverrides = hasSpaceOverrides(author?.profile);
  const nickname = !showMain ? author?.nickname?.trim() || null : null;
  const shown = showMain || !author ? user : withSpaceProfile(user, author.profile, nickname);
  const name = nickname ?? userDisplayName(user);
  const alias = !user.isDeleted && name !== user.displayName ? user.displayName : null;
  return {
    shown,
    name,
    alias,
    space: inSpace ? space : undefined,
    member,
    owner: inSpace && !!space && space.ownerId === user.id,
    hasOverrides,
    showMain,
    setShowMain,
  };
}
