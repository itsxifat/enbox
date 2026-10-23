import { createElement } from 'react';
import { CircleUserRound } from 'lucide-react';
import {
  ChatsFilledIcon,
  ChatsIcon,
  CommunitiesFilledIcon,
  CommunitiesIcon,
  createIcon,
} from '@/components/icons';
import type { IconType } from '@/components/ui';

/** The phone's bottom tabs (Discord mobile): Servers, Messages, Notifications, You. */
export type TabId = 'servers' | 'messages' | 'notifications' | 'you';

export interface TabDef {
  id: TabId;
  label: string;
  /** Where the tab navigates (Servers: the last Space, see BottomTabs). */
  path: string;
  icon: IconType;
  /** Filled variant shown while the tab is current (same silhouette as `icon`). */
  activeIcon: IconType;
  /** Path prefixes that highlight this tab. */
  match: string[];
}

const BELL =
  'M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326';
const CLAPPER = 'M10.268 21a2 2 0 0 0 3.464 0';

export const BellIcon = createIcon('enbox-bell', () => [
  createElement('path', { key: 'b', d: BELL }),
  createElement('path', { key: 'c', d: CLAPPER }),
]);
export const BellFilledIcon = createIcon('enbox-bell-filled', () => [
  createElement('path', { key: 'b', d: BELL, fill: 'currentColor' }),
  createElement('path', { key: 'c', d: CLAPPER }),
]);

export const TABS: TabDef[] = [
  {
    id: 'servers',
    label: 'Servers',
    path: '/spaces',
    icon: CommunitiesIcon,
    activeIcon: CommunitiesFilledIcon,
    match: ['/spaces', '/communities', '/discover', '/join'],
  },
  {
    id: 'messages',
    label: 'Messages',
    path: '/chats',
    icon: ChatsIcon,
    activeIcon: ChatsFilledIcon,
    match: ['/chats', '/archived', '/starred', '/new'],
  },
  {
    id: 'notifications',
    label: 'Notifications',
    path: '/notifications',
    icon: BellIcon,
    activeIcon: BellFilledIcon,
    match: ['/notifications'],
  },
  {
    // Shows my avatar (BottomTabs); the glyph is the signed-out fallback.
    id: 'you',
    label: 'You',
    path: '/you',
    icon: CircleUserRound,
    activeIcon: CircleUserRound,
    // Updates and Calls are reached from the You page on phones.
    match: ['/you', '/settings', '/updates', '/calls', '/collectibles'],
  },
];

export function activeTab(pathname: string): TabId | null {
  for (const t of TABS)
    if (t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`))) return t.id;
  return null;
}
