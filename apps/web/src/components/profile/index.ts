/**
 * Profile building blocks shared by the popout, the full profile and the settings preview
 * (features/profile composes them; they hold no data of their own).
 */
export { BadgeIcon } from './BadgeIcon';
export { BadgeRow, OWNER_BADGE, type BadgeRowProps } from './BadgeRow';
export { MemberSince, formatProfileDate, type MemberSinceProps } from './MemberSince';
export { ProfileAvatar, type ProfileAvatarProps } from './ProfileAvatar';
export { ProfileBanner, type ProfileBannerProps } from './ProfileBanner';
export { StatusBubble, type StatusBubbleProps } from './StatusBubble';
export {
  ProfilePanel,
  ThemedProfileSurface,
  surfaceRing,
  type ThemedProfileSurfaceProps,
} from './ThemedProfileSurface';
export {
  contrastRatio,
  inkOn,
  mixHex,
  parseHex,
  profileTheme,
  relativeLuminance,
  type Ink,
  type ProfileTheme,
} from './theme';
