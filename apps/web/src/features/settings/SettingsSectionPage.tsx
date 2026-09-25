/**
 * /settings/:section[/:sub] — resolves the page from the registry below. Desktop shows it in
 * the main pane (sections have no back arrow, sub-pages go back to their section); phones
 * show it full screen with a back arrow.
 */
import type { ReactNode } from 'react';
import { useParams } from 'react-router';
import { SearchX } from 'lucide-react';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { AccountPage } from './account/AccountPage';
import { ChangePasswordPage } from './account/ChangePasswordPage';
import { DeleteAccountPage } from './account/DeleteAccountPage';
import { ChatsSettingsPage } from './ChatsSettingsPage';
import { DevicesPage } from './DevicesPage';
import { HelpPage, StoragePage } from './HelpPages';
import { NotificationsPage } from './NotificationsPage';
import { BlockedPage } from './privacy/BlockedPage';
import { DefaultTimerPage, LastSeenPage, PrivacyLevelPage } from './privacy/PrivacyChoicePages';
import { PrivacyPage } from './privacy/PrivacyPage';
import { StatusListPage, StatusPrivacyPage } from './privacy/StatusPrivacyPages';
import { AboutPage } from './profile/AboutPage';
import { ProfilePage } from './profile/ProfilePage';

interface PageDef {
  title: string;
  /** Page key to go back to (defaults to the section for sub-pages). */
  parent?: string;
  render: () => ReactNode;
}

export const SETTINGS_PAGES: Record<string, PageDef> = {
  profile: { title: 'Profile', render: () => <ProfilePage /> },
  'profile/about': { title: 'About', render: () => <AboutPage /> },
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
    parent: 'privacy/status',
    render: () => <StatusListPage list="exclude" />,
  },
  'privacy/status-only': {
    title: 'Share status with…',
    parent: 'privacy/status',
    render: () => <StatusListPage list="only" />,
  },
  'privacy/blocked': { title: 'Blocked contacts', render: () => <BlockedPage /> },
  'privacy/timer': { title: 'Default message timer', render: () => <DefaultTimerPage /> },
  chats: { title: 'Chats', render: () => <ChatsSettingsPage /> },
  notifications: { title: 'Notifications', render: () => <NotificationsPage /> },
  devices: { title: 'Linked devices', render: () => <DevicesPage /> },
  storage: { title: 'Storage and data', render: () => <StoragePage /> },
  help: { title: 'Help', render: () => <HelpPage /> },
};

export function SettingsSectionPage() {
  const { section = '', sub } = useParams();
  const desktop = useIsDesktop();
  const key = sub ? `${section}/${sub}` : section;
  const page = SETTINGS_PAGES[key];
  const back = sub ? `/settings/${page?.parent ?? section}` : desktop ? undefined : '/settings';
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface lg:bg-app">
      <PaneHeader title={page?.title ?? 'Settings'} back={back} border />
      {page ? (
        page.render()
      ) : (
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={SearchX}
            title="Page not found"
            description="This settings page doesn't exist."
          />
        </div>
      )}
    </div>
  );
}
