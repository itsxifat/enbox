/**
 * The profile card's view model is a `UserPublic`: other users come from the users store as
 * they are; my own `UserSelf` is mapped onto the same shape (`selfCardUser`) so one card
 * renders both — and the contact dialogs / actions can take it unchanged.
 */
import { activePresenceNote, effectiveAvailability } from '@enbox/shared';

/** What my own availability choice looks like as a badge: invisible shows as offline (no badge). */
export function selfPresenceState(me, now = Date.now()) {
  const availability = effectiveAvailability(me, now);
  return availability === 'invisible' ? 'offline' : availability;
}

/** My own profile as the card shows it (raw `UserSelf`, no privacy gating, the unexpired note). */
export function selfCardUser(me, now = Date.now()) {
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

/** CSS background for the card header without a banner: profile colour → accent colour. */
export function profileGradient(profileColor, accentColor) {
  const from = profileColor ?? 'var(--brand)';
  const to = accentColor ?? `color-mix(in srgb, ${from} 72%, #000)`;
  return `linear-gradient(135deg, ${from} 0%, ${to} 100%)`;
}
