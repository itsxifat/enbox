import {
  Bell,
  CircleHelp,
  CircleUserRound,
  HardDrive,
  KeyRound,
  Laptop,
  Lock,
  MessageSquareText,
  Mic,
  Radio,
} from 'lucide-react';
import type { IconType } from '@/components/ui';

/** The desktop nav's blocks: USER SETTINGS, APP SETTINGS and the untitled last one (Help). */
export type SettingsNavGroupId = 'user' | 'app' | 'more';

export interface SettingsSectionDef {
  id: string;
  title: string;
  /** The desktop settings nav's label (Discord's wording); defaults to `title`. */
  navTitle?: string;
  description: string;
  icon: IconType;
  /** Tile color behind the white icon in the settings list (white glyphs pass 3:1 on each). */
  tint: string;
  /** Where the desktop nav lists it. */
  group: SettingsNavGroupId;
  /** Words the settings search also matches: the page's rows and sub-pages, other names. */
  keywords: readonly string[];
  /** Desktop: the page needs more than the usual ~740px column (the two-column profile editor). */
  wide?: boolean;
}

/** Settings sections (routes /settings/:id). Agent 1 owns this list. */
export const SETTINGS_SECTIONS: SettingsSectionDef[] = [
  {
    id: 'profile',
    title: 'Profiles',
    description: 'Avatar, banner, decorations, name style, theme',
    icon: CircleUserRound,
    tint: '#7c6cf8',
    group: 'user',
    keywords: [
      'profile',
      'avatar',
      'banner',
      'display name',
      'pronouns',
      'about me',
      'bio',
      'avatar decoration',
      'profile effect',
      'nameplate',
      'name style',
      'font',
      'profile theme',
      'colour',
      'color',
      'per-server',
      'server profile',
      'space profile',
    ],
    wide: true,
  },
  {
    id: 'account',
    title: 'Account',
    navTitle: 'My Account',
    description: 'Password, security, delete account',
    icon: KeyRound,
    tint: '#2f7cf6',
    group: 'user',
    keywords: [
      'password',
      'security',
      'username',
      'phone number',
      'delete account',
      'log out',
      'two-factor',
      '2fa',
      'authenticator',
      'backup codes',
    ],
  },
  {
    id: 'privacy',
    title: 'Privacy',
    navTitle: 'Privacy & Safety',
    description: 'Last seen, profile photo, blocked contacts',
    icon: Lock,
    tint: '#0f9f6e',
    group: 'user',
    keywords: [
      'safety',
      'last seen',
      'online',
      'profile photo',
      'about',
      'groups',
      'status',
      'read receipts',
      'blocked contacts',
      'block',
      'default message timer',
      'disappearing messages',
      'friend requests',
    ],
  },
  {
    id: 'chats',
    title: 'Chats',
    description: 'Theme, wallpaper, animations, text size',
    icon: MessageSquareText,
    tint: '#6d5dfc',
    group: 'app',
    keywords: [
      'appearance',
      'theme',
      'light',
      'dark',
      'ash',
      'onyx',
      'chat theme',
      'bubble style',
      'wallpaper',
      'text size',
      'font size',
      'animations',
      'accessibility',
      'reduce motion',
      'animated photos',
      'gif',
      'enter is send',
      'link previews',
      'display name styles',
    ],
  },
  {
    id: 'notifications',
    title: 'Notifications',
    description: 'Messages, groups and calls',
    icon: Bell,
    tint: '#e5484d',
    group: 'app',
    keywords: [
      'message notifications',
      'group notifications',
      'call notifications',
      'desktop alerts',
      'sounds',
      'show previews',
      'push',
      'test notification',
    ],
  },
  {
    id: 'voice',
    title: 'Voice and video',
    navTitle: 'Voice & Video',
    description: 'Voice isolation, noise cancellation',
    icon: Mic,
    tint: '#0d9488',
    group: 'app',
    keywords: [
      'microphone',
      'mic',
      'voice isolation',
      'noise cancellation',
      'noise suppression',
      'echo cancellation',
      'automatic gain control',
      'audio',
      'camera',
    ],
  },
  {
    id: 'streamer',
    title: 'Streamer Mode',
    description: 'Hide personal information while you stream',
    icon: Radio,
    tint: '#9333ea',
    group: 'app',
    keywords: [
      'streamer mode',
      'streaming',
      'hide personal information',
      'hide invite links',
      'disable sounds',
    ],
  },
  {
    id: 'devices',
    title: 'Linked devices',
    navTitle: 'Devices',
    description: 'Manage where you’re logged in',
    icon: Laptop,
    tint: '#0e8fbf',
    group: 'user',
    keywords: ['linked devices', 'sessions', 'logged in', 'this device', 'other devices'],
  },
  {
    id: 'storage',
    title: 'Storage and data',
    navTitle: 'Storage & Data',
    description: 'Space used, upload limits',
    icon: HardDrive,
    tint: '#d97706',
    group: 'app',
    keywords: ['storage', 'data', 'cache', 'cached files', 'media quality', 'file size', 'network'],
  },
  {
    id: 'help',
    title: 'Help',
    description: 'Help center, version, shortcuts',
    icon: CircleHelp,
    tint: '#64748b',
    group: 'more',
    keywords: ['help center', 'faq', 'support', 'version', 'what’s new', "what's new", 'about'],
  },
];

/** A section by id (`/settings/:id`). */
export function settingsSection(id: string | undefined): SettingsSectionDef | undefined {
  return id ? SETTINGS_SECTIONS.find((s) => s.id === id) : undefined;
}
