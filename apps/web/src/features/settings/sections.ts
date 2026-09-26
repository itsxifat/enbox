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
  /** Tile color behind the white icon in the settings list (white glyphs pass 3:1 on each). */
  tint: string;
}

/** Settings sections (routes /settings/:id). Agent 1 owns this list. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'profile',
    title: 'Profile',
    description: 'Name, photo, about, username',
    icon: CircleUserRound,
    tint: '#7c6cf8',
  },
  {
    id: 'account',
    title: 'Account',
    description: 'Password, security, delete account',
    icon: KeyRound,
    tint: '#2f7cf6',
  },
  {
    id: 'privacy',
    title: 'Privacy',
    description: 'Last seen, profile photo, blocked contacts',
    icon: Lock,
    tint: '#0f9f6e',
  },
  {
    id: 'chats',
    title: 'Chats',
    description: 'Theme, wallpaper, text size',
    icon: MessageSquareText,
    tint: '#6d5dfc',
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Messages, groups and calls',
    icon: Bell,
    tint: '#e5484d',
  },
  {
    id: 'devices',
    title: 'Linked devices',
    description: 'Manage where you’re logged in',
    icon: Laptop,
    tint: '#0e8fbf',
  },
  {
    id: 'storage',
    title: 'Storage and data',
    description: 'Space used, upload limits',
    icon: HardDrive,
    tint: '#d97706',
  },
  {
    id: 'help',
    title: 'Help',
    description: 'Help center, version, shortcuts',
    icon: CircleHelp,
    tint: '#64748b',
  },
];
