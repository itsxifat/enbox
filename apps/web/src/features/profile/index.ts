/**
 * Profile card (P1): `openProfile(userId, anchor)` from anywhere; `ProfileCardHost` renders it
 * (mounted once in AppShell); `ProfileCard` in `preview` mode is the live preview on
 * Settings → Profile.
 */
export { openProfile } from './open';
export { ProfileCard, type ProfileCardProps } from './ProfileCard';
export { ProfileCardHost } from './ProfileCardHost';
export { AvailabilityPicker, AvailabilityDot, AVAILABILITY_LABELS } from './AvailabilityPicker';
export { PresenceNoteDialog } from './PresenceNoteDialog';
export { profileGradient, selfCardUser, selfPresenceState, type ProfileCardUser } from './model';
