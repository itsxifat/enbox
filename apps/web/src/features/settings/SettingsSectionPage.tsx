/**
 * /settings/:section[/:sub] — resolves the page from the registry below. Desktop shows it in
 * the User Settings layer's content column under a Discord-style title (sections have no back
 * arrow, sub-pages go back to their section); phones show it full screen with a back arrow.
 */
import type { ReactNode } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import { ArrowLeft, SearchX } from 'lucide-react';
import { backTarget } from '@/components/layout/navigation';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, IconButton } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { settingsSection } from './sections';
import { AccountPage } from './account/AccountPage';
import { ChangePasswordPage } from './account/ChangePasswordPage';
import { DeleteAccountPage } from './account/DeleteAccountPage';
import { TwoFactorPage } from './account/TwoFactorPage';
import {
  ChatAnimationsPage,
  ChatThemePage,
  ChatWallpaperPage,
  ChatsSettingsPage,
} from './ChatsSettingsPage';
import { DevicesPage } from './DevicesPage';
import { HelpPage, StoragePage } from './HelpPages';
import { NotificationsPage } from './NotificationsPage';
import { IgnoredPage } from '@/features/safety/IgnoredPage';
import { BlockedPage } from './privacy/BlockedPage';
import { DefaultTimerPage, LastSeenPage, PrivacyLevelPage } from './privacy/PrivacyChoicePages';
import { PrivacyPage } from './privacy/PrivacyPage';
import { StatusListPage, StatusPrivacyPage } from './privacy/StatusPrivacyPages';
import { AboutPage } from './profile/AboutPage';
import { BioPage } from './profile/BioPage';
import { ColoursPage } from './profile/ColoursPage';
import { ProfilePage } from './profile/ProfilePage';
import { PronounsPage } from './profile/PronounsPage';
import { StreamerModePage } from './StreamerModePage';
import { VoiceSettingsPage } from './VoiceSettingsPage';

interface PageDef {
  title: string;
  /** Page key to go back to (defaults to the section for sub-pages). */
  parent?: string;
  render: () => ReactNode;
}

export const SETTINGS_PAGES: Record<string, PageDef> = {
  profile: { title: 'Profiles', render: () => <ProfilePage /> },
  'profile/about': { title: 'About', render: () => <AboutPage /> },
  'profile/bio': { title: 'Bio', render: () => <BioPage /> },
  'profile/pronouns': { title: 'Pronouns', render: () => <PronounsPage /> },
  'profile/colours': { title: 'Profile colours', render: () => <ColoursPage /> },
  account: { title: 'Account', render: () => <AccountPage /> },
  'account/password': { title: 'Change password', render: () => <ChangePasswordPage /> },
  'account/delete': { title: 'Delete account', render: () => <DeleteAccountPage /> },
  'account/two-factor': { title: 'Two-factor authentication', render: () => <TwoFactorPage /> },
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
  'privacy/ignored': { title: 'Ignored users', render: () => <IgnoredPage /> },
  'privacy/timer': { title: 'Default message timer', render: () => <DefaultTimerPage /> },
  chats: { title: 'Chats', render: () => <ChatsSettingsPage /> },
  'chats/theme': { title: 'Chat theme', render: () => <ChatThemePage /> },
  'chats/wallpaper': { title: 'Wallpaper', render: () => <ChatWallpaperPage /> },
  'chats/animations': { title: 'Animations', render: () => <ChatAnimationsPage /> },
  notifications: { title: 'Notifications', render: () => <NotificationsPage /> },
  voice: { title: 'Voice and video', render: () => <VoiceSettingsPage /> },
  streamer: { title: 'Streamer Mode', render: () => <StreamerModePage /> },
  devices: { title: 'Linked devices', render: () => <DevicesPage /> },
  storage: { title: 'Storage and data', render: () => <StoragePage /> },
  help: { title: 'Help', render: () => <HelpPage /> },
};

/**
 * The layer's page title, lined up with the page's content column (the settings pages center
 * a max-w-2xl column; the profile editor a max-w-5xl one).
 */
function LayerTitle({ title, back, wide }: { title: string; back?: string; wide?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <header
      className={cn(
        'mx-auto flex h-12 w-full shrink-0 items-center gap-1 px-3 lg:px-6',
        wide ? 'max-w-5xl' : 'max-w-2xl',
      )}
    >
      {back ? (
        <IconButton
          icon={ArrowLeft}
          label="Back"
          className="-ml-2 shrink-0"
          onClick={() => {
            const t = backTarget(location.state, window.history.state, back);
            if (t.kind === 'pop') void navigate(-1);
            else void navigate(t.to, { replace: true, state: location.state });
          }}
        />
      ) : null}
      <h1 className="min-w-0 truncate text-[20px] leading-6 font-semibold text-fg">{title}</h1>
    </header>
  );
}

export function SettingsSectionPage() {
  const { section = '', sub } = useParams();
  const desktop = useIsDesktop();
  const key = sub ? `${section}/${sub}` : section;
  const page = SETTINGS_PAGES[key];
  const back = sub ? `/settings/${page?.parent ?? section}` : desktop ? undefined : '/settings';
  const def = settingsSection(section);
  const title = page?.title ?? 'Settings';
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      {desktop ? (
        <LayerTitle title={sub ? title : (def?.navTitle ?? title)} back={back} wide={def?.wide} />
      ) : (
        <PaneHeader title={title} back={back} border />
      )}
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
