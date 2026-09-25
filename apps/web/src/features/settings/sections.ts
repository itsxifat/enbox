import {
  Bell,
  CircleHelp,
  CircleUserRound,
  HardDrive,
  KeyRound,
  Laptop,
  Lock,
  MessageSquareText,
} from 'lucide-react';
import type { IconType } from '@/components/ui';

export interface SettingsSectionDef {
  id: string;
  title: string;
  description: string;
  icon: IconType;
}

/** Settings sections (routes /settings/:id). Agent 1 owns this list. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'profile',
    title: 'Profile',
    description: 'Name, photo, about, username',
    icon: CircleUserRound,
  },
  {
    id: 'account',
    title: 'Account',
    description: 'Password, security, delete account',
    icon: KeyRound,
  },
  {
    id: 'privacy',
    title: 'Privacy',
    description: 'Last seen, profile photo, blocked contacts',
    icon: Lock,
  },
  {
    id: 'chats',
    title: 'Chats',
    description: 'Theme, wallpaper, text size',
    icon: MessageSquareText,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Messages, groups and calls',
    icon: Bell,
  },
  {
    id: 'devices',
    title: 'Linked devices',
    description: 'Manage where you’re logged in',
    icon: Laptop,
  },
  {
    id: 'storage',
    title: 'Storage and data',
    description: 'Space used, upload limits',
    icon: HardDrive,
  },
  { id: 'help', title: 'Help', description: 'Help center, version, shortcuts', icon: CircleHelp },
];
