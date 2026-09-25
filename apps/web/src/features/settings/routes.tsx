/** Settings routes — OWNED BY FEATURE AGENT 1. */
import type { RouteObject } from 'react-router';
import { Settings } from 'lucide-react';
import type { RouteHandle } from '@/app/routeHandle';
import { MainEmpty } from '@/components/layout/MainEmpty';
import { SplitView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const SettingsPane = lazyNamed(() => import('./SettingsPane'), 'SettingsPane');
const SettingsSectionPage = lazyNamed(() => import('./SettingsSectionPage'), 'SettingsSectionPage');

const detail: RouteHandle = { detail: true };

export const settingsRoutes: RouteObject[] = [
  {
    path: 'settings',
    element: (
      <SplitView
        list={<SettingsPane />}
        empty={
          <MainEmpty
            icon={Settings}
            title="Settings"
            description="Manage your profile, privacy, notifications and devices."
          />
        }
      />
    ),
    children: [{ path: ':section', element: <SettingsSectionPage />, handle: detail }],
  },
];
