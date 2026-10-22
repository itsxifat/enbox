/**
 * The profile card's view model is a `UserPublic` (cosmetics included): other users come from
 * the users store as they are; my own `UserSelf` is mapped onto the same shape
 * (`selfCardUser`) so one card renders both — and the contact dialogs / actions can take it
 * unchanged. Inside a Space, the member's per-Space profile is laid over it with
 * `withSpaceProfile` (features/spaces/serverProfile).
 */
import {
  activePresenceNote,
  effectiveAvailability,
  type PresenceState,
  type SpaceProfile,
  type UserPublic,
  type UserSelf,
} from '@enbox/shared';
import { SPACE_PROFILE_KEYS } from '@/stores/spaces';

export type ProfileCardUser = UserPublic;

/** What my own availability choice looks like as a badge: invisible shows as offline (no badge). */
export function selfPresenceState(me: UserSelf, now = Date.now()): PresenceState {
  const availability = effectiveAvailability(me, now);
  return availability === 'invisible' ? 'offline' : availability;
}

/** My own profile as the card shows it (raw `UserSelf`, no privacy gating, the unexpired note). */
export function selfCardUser(me: UserSelf, now = Date.now()): ProfileCardUser {
  const presenceState = selfPresenceState(me, now);
  return {
    id: me.id,
    username: me.username,
    displayName: me.displayName,
    avatarUrl: me.avatarUrl,
    avatarAnimatedUrl: me.avatarAnimatedUrl,
    bannerUrl: me.bannerUrl,
    bannerAnimatedUrl: me.bannerAnimatedUrl,
    about: me.about || null,
    pronouns: me.pronouns,
    bio: me.bio || null,
    profileColor: me.profileColor,
    accentColor: me.accentColor,
    avatarDecoration: me.avatarDecoration ?? null,
    profileEffect: me.profileEffect ?? null,
    nameplate: me.nameplate ?? null,
    nameStyle: me.nameStyle ?? null,
    phone: me.phone,
    online: presenceState !== 'offline',
    presenceState,
    presenceNote: activePresenceNote(me.presenceNote, now),
    lastSeenAt: null,
    createdAt: me.createdAt,
    isContact: false,
    contactName: null,
    isBlocked: false,
    isDeleted: false,
  };
}

/**
 * Whether a member set any per-Space override (the card then offers "View Main Profile").
 * Set = non-null, the rule of the merge itself (`withSpaceProfile` in
 * features/spaces/serverProfile).
 */
export function hasSpaceOverrides(p: SpaceProfile | null | undefined): boolean {
  return !!p && SPACE_PROFILE_KEYS.some((k) => p[k] !== null && p[k] !== undefined);
}

/** CSS background for the card header without a banner: profile colour → accent colour. */
export function profileGradient(
  profileColor: string | null | undefined,
  accentColor: string | null | undefined,
): string {
  const from = profileColor ?? 'var(--brand)';
  const to = accentColor ?? `color-mix(in srgb, ${from} 72%, #000)`;
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}
