/**
 * Settings routes — OWNED BY FEATURE AGENT 1.
 *
 *   /settings                 section list (desktop: + empty main pane)
 *   /settings/:section        a section (profile, account, privacy, chats, notifications,
 *                             devices, storage, help)
 *   /settings/:section/:sub   a sub-page (e.g. privacy/blocked, account/password)
 *   /welcome                  post-registration onboarding (features/auth/WelcomePage);
 *                             lives here because it needs an authenticated session
 */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { SettingsIcon } from '@/components/icons';
import { MainEmpty } from '@/components/layout/MainEmpty';
import { SplitView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const SettingsPane = lazyNamed(() => import('./SettingsPane'), 'SettingsPane');
const SettingsSectionPage = lazyNamed(() => import('./SettingsSectionPage'), 'SettingsSectionPage');
const WelcomePage = lazyNamed(() => import('@/features/auth/WelcomePage'), 'WelcomePage');

const detail: RouteHandle = { detail: true };

export const settingsRoutes: RouteObject[] = [
  {
    path: 'settings',
    element: (
      <SplitView
        list={<SettingsPane />}
        empty={
          <MainEmpty
            icon={SettingsIcon}
            title="Settings"
            description="Manage your profile, privacy, notifications and devices."
          />
        }
      />
    ),
    children: [
      { path: ':section', element: <SettingsSectionPage />, handle: detail },
      { path: ':section/:sub', element: <SettingsSectionPage />, handle: detail },
    ],
  },
  { path: 'welcome', element: <WelcomePage />, handle: { hideTabs: true } satisfies RouteHandle },
];
