/**
 * Settings routes — OWNED BY FEATURE AGENT 1.
 *
 *   /settings                 desktop: the User Settings layer on My Account; phones: the
 *                             settings list (full screen, opened from the You tab)
 *   /settings/:section        a section (profile, account, privacy, chats, notifications,
 *                             voice, devices, storage, help)
 *   /settings/:section/:sub   a sub-page (e.g. privacy/blocked, account/password)
 *   /welcome                  post-registration onboarding (features/auth/WelcomePage);
 *                             lives here because it needs an authenticated session
 *
 * On desktop AppShell draws the layer over the page settings were opened from (see
 * SettingsLayer); the routes stay ordinary children of the shell.
 */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { lazyNamed } from '@/lib/lazy';

const SettingsRoot = lazyNamed(() => import('./SettingsPane'), 'SettingsRoot');
const SettingsSectionPage = lazyNamed(() => import('./SettingsSectionPage'), 'SettingsSectionPage');
const WelcomePage = lazyNamed(() => import('@/features/auth/WelcomePage'), 'WelcomePage');

const detail: RouteHandle = { detail: true };

export const settingsRoutes: RouteObject[] = [
  {
    path: 'settings',
    element: <SettingsRoot />,
    // Phones: settings is a pushed screen off the You tab, without the tab bar.
    handle: { hideTabs: true } satisfies RouteHandle,
    children: [
      { path: ':section', element: <SettingsSectionPage />, handle: detail },
      { path: ':section/:sub', element: <SettingsSectionPage />, handle: detail },
    ],
  },
  { path: 'welcome', element: <WelcomePage />, handle: { hideTabs: true } satisfies RouteHandle },
];
