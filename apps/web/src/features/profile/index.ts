/**
 * Profile surfaces: `openProfile(userId, anchor, { spaceId })` opens the popout from anywhere
 * and `openFullProfile(userId, { spaceId, tab })` the full profile modal; `ProfileCardHost`
 * renders both (mounted once in AppShell). `ProfileCard` in `preview` mode is the live preview
 * of the profile editor; `FullProfile` is also the `/u/:username` and `/users/:userId` page.
 */
export {
  closeFullProfile,
  openFullProfile,
  openProfile,
  useFullProfileRequest,
  type FullProfileRequest,
  type FullProfileTab,
} from './open';
export { ProfileCard, type ProfileCardProps } from './ProfileCard';
export { ProfileCardHost } from './ProfileCardHost';
export { FullProfile, type FullProfileProps } from './FullProfile';
export { FullProfileModal, type FullProfileModalProps } from './FullProfileModal';
export { useProfiles, useUserProfile } from './profileStore';
export { AvailabilityPicker, AvailabilityDot, AVAILABILITY_LABELS } from './AvailabilityPicker';
export { PresenceNoteDialog } from './PresenceNoteDialog';
export {
  hasSpaceOverrides,
  profileGradient,
  selfCardUser,
  selfPresenceState,
  type ProfileCardUser,
} from './model';
