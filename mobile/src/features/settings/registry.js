/**
 * /settings/:section[/:sub] → page (web features/settings/SettingsSectionPage.tsx).
 */
import { AccountPage, ChangePasswordPage, DeleteAccountPage } from './pages/AccountPages';
import {
  ChatAnimationsPage,
  ChatThemePage,
  ChatWallpaperPage,
  ChatsSettingsPage,
} from './pages/ChatsSettingsPages';
import {
  BlockedPage,
  DefaultTimerPage,
  LastSeenPage,
  PrivacyLevelPage,
  PrivacyPage,
  StatusListPage,
  StatusPrivacyPage,
} from './pages/PrivacyPages';
import { AboutPage, BioPage, ColoursPage, ProfilePage, PronounsPage } from './pages/ProfilePages';
import { DevicesPage, HelpPage, NotificationsPage, StoragePage } from './pages/SystemPages';

export const SETTINGS_PAGES = {
  profile: { title: 'Profile', render: () => <ProfilePage /> },
  'profile/about': { title: 'About', render: () => <AboutPage /> },
  'profile/bio': { title: 'Bio', render: () => <BioPage /> },
  'profile/pronouns': { title: 'Pronouns', render: () => <PronounsPage /> },
  'profile/colours': { title: 'Profile colours', render: () => <ColoursPage /> },
  account: { title: 'Account', render: () => <AccountPage /> },
  'account/password': { title: 'Change password', render: () => <ChangePasswordPage /> },
  'account/delete': { title: 'Delete account', render: () => <DeleteAccountPage /> },
  privacy: { title: 'Privacy', render: () => <PrivacyPage /> },
  'privacy/last-seen': { title: 'Last seen and online', render: () => <LastSeenPage /> },
  'privacy/profile-photo': {
    title: 'Profile photo',
    render: () => <PrivacyLevelPage setting="profilePhotoVisibility" />,
  },
  'privacy/about': { title: 'About', render: () => <PrivacyLevelPage setting="aboutVisibility" /> },
  'privacy/groups': {
    title: 'Groups',
    render: () => <PrivacyLevelPage setting="groupsAddPermission" />,
  },
  'privacy/status': { title: 'Status privacy', render: () => <StatusPrivacyPage /> },
  'privacy/status-except': {
    title: 'Hide status from…',
    render: () => <StatusListPage list="exclude" />,
  },
  'privacy/status-only': {
    title: 'Share status with…',
    render: () => <StatusListPage list="only" />,
  },
  'privacy/blocked': { title: 'Blocked contacts', render: () => <BlockedPage /> },
  'privacy/timer': { title: 'Default message timer', render: () => <DefaultTimerPage /> },
  chats: { title: 'Chats', render: () => <ChatsSettingsPage /> },
  'chats/theme': { title: 'Chat theme', render: () => <ChatThemePage /> },
  'chats/wallpaper': { title: 'Wallpaper', render: () => <ChatWallpaperPage /> },
  'chats/animations': { title: 'Animations', render: () => <ChatAnimationsPage /> },
  notifications: { title: 'Notifications', render: () => <NotificationsPage /> },
  devices: { title: 'Linked devices', render: () => <DevicesPage /> },
  storage: { title: 'Storage and data', render: () => <StoragePage /> },
  help: { title: 'Help', render: () => <HelpPage /> },
};
