import {
  Bell,
  CircleUserRound,
  Info,
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
    description: 'Password, phone number, delete account',
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
    description: 'Messages, groups, calls',
    icon: Bell,
  },
  {
    id: 'devices',
    title: 'Linked devices',
    description: 'Sessions signed in to your account',
    icon: Laptop,
  },
  { id: 'help', title: 'Help', description: 'About Enbox', icon: Info },
];
