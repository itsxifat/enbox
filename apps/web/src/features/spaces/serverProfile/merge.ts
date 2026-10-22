/**
 * Per-Space profile → the profile card's user. Every override that is set (non-null) wins over
 * the main profile; null / absent ones fall through. Use it wherever a user is shown inside a
 * Space (profile popover from a channel, member list, message author):
 *
 *   const author = useSpaceAuthor(spaceId, userId);
 *   <ProfileCard user={withSpaceProfile(user, author?.profile, author?.nickname)} />
 */
import type { SpaceProfile, UserPublic } from '@enbox/shared';

export function withSpaceProfile(
  user: UserPublic,
  profile: SpaceProfile | null | undefined,
  nickname?: string | null,
): UserPublic {
  if (user.isDeleted || (!profile && !nickname)) return user;
  const p = profile ?? {};
  // An image override replaces both its static and its animated URL (a still server avatar
  // must not animate with the main profile's GIF).
  const avatar = p.avatarUrl
    ? { avatarUrl: p.avatarUrl, avatarAnimatedUrl: p.avatarAnimatedUrl ?? null }
    : { avatarUrl: user.avatarUrl, avatarAnimatedUrl: user.avatarAnimatedUrl ?? null };
  const banner = p.bannerUrl
    ? { bannerUrl: p.bannerUrl, bannerAnimatedUrl: p.bannerAnimatedUrl ?? null }
    : { bannerUrl: user.bannerUrl ?? null, bannerAnimatedUrl: user.bannerAnimatedUrl ?? null };
  return {
    ...user,
    displayName: nickname?.trim() || user.displayName,
    ...avatar,
    ...banner,
    bio: p.bio ?? user.bio,
    pronouns: p.pronouns ?? user.pronouns,
    profileColor: p.profileColor ?? user.profileColor,
    accentColor: p.accentColor ?? user.accentColor,
    avatarDecoration: p.avatarDecoration ?? user.avatarDecoration ?? null,
    profileEffect: p.profileEffect ?? user.profileEffect ?? null,
    nameplate: p.nameplate ?? user.nameplate ?? null,
  };
}
