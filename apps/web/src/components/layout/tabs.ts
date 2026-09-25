import {
  CallsFilledIcon,
  CallsIcon,
  ChatsFilledIcon,
  ChatsIcon,
  CommunitiesFilledIcon,
  CommunitiesIcon,
  SettingsFilledIcon,
  SettingsIcon,
  UpdatesFilledIcon,
  UpdatesIcon,
} from '@/components/icons';
import type { IconType } from '@/components/ui';

export type TabId = 'chats' | 'updates' | 'communities' | 'calls' | 'settings';

export interface TabDef {
  id: TabId;
  label: string;
  /** Where the tab navigates. */
  path: string;
  icon: IconType;
  /** Filled variant shown while the tab is current (same silhouette as `icon`). */
  activeIcon: IconType;
  /** Path prefixes that highlight this tab. */
  match: string[];
}

export const TABS: TabDef[] = [
  {
    id: 'chats',
    label: 'Chats',
    path: '/chats',
    icon: ChatsIcon,
    activeIcon: ChatsFilledIcon,
    match: ['/chats', '/archived', '/starred', '/new'],
  },
  {
    id: 'updates',
    label: 'Updates',
    path: '/updates',
    icon: UpdatesIcon,
    activeIcon: UpdatesFilledIcon,
    match: ['/updates'],
  },
  {
    id: 'communities',
    label: 'Communities',
    path: '/communities',
    icon: CommunitiesIcon,
    activeIcon: CommunitiesFilledIcon,
    match: ['/communities'],
  },
  {
    id: 'calls',
    label: 'Calls',
    path: '/calls',
    icon: CallsIcon,
    activeIcon: CallsFilledIcon,
    match: ['/calls'],
  },
  {
    id: 'settings',
    label: 'Settings',
    path: '/settings',
    icon: SettingsIcon,
    activeIcon: SettingsFilledIcon,
    match: ['/settings'],
  },
];

export function activeTab(pathname: string): TabId | null {
  for (const t of TABS)
    if (t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`))) return t.id;
  return null;
}
