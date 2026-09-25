import { CircleDashed, MessageCircle, Phone, Settings, UsersRound } from 'lucide-react';
import type { IconType } from '@/components/ui';

export type TabId = 'chats' | 'updates' | 'communities' | 'calls' | 'settings';

export interface TabDef {
  id: TabId;
  label: string;
  /** Where the tab navigates. */
  path: string;
  icon: IconType;
  /** Path prefixes that highlight this tab. */
  match: string[];
}

export const TABS: TabDef[] = [
  {
    id: 'chats',
    label: 'Chats',
    path: '/chats',
    icon: MessageCircle,
    match: ['/chats', '/archived', '/starred', '/new'],
  },
  { id: 'updates', label: 'Updates', path: '/updates', icon: CircleDashed, match: ['/updates'] },
  {
    id: 'communities',
    label: 'Communities',
    path: '/communities',
    icon: UsersRound,
    match: ['/communities'],
  },
  { id: 'calls', label: 'Calls', path: '/calls', icon: Phone, match: ['/calls'] },
  { id: 'settings', label: 'Settings', path: '/settings', icon: Settings, match: ['/settings'] },
];

export function activeTab(pathname: string): TabId | null {
  for (const t of TABS)
    if (t.match.some((m) => pathname === m || pathname.startsWith(`${m}/`))) return t.id;
  return null;
}
