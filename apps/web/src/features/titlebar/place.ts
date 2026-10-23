/**
 * Where a path is, for the title bar's middle (pure): a Space channel ("#general · Night
 * Owls"), a Space page, a DM or group, or one of the app's own pages ("Friends").
 */
import type { ChatSummary } from '@enbox/shared';

export type RoutePlace =
  | { kind: 'channel'; spaceId: string; chatId: string }
  | { kind: 'space'; spaceId: string; page: string | null }
  | { kind: 'chat'; chatId: string }
  | { kind: 'page'; title: string };

/** Space pages that are not channels (`/spaces/:spaceId/<page>`). */
const SPACE_PAGES: Record<string, string> = {
  guide: 'Server Guide',
  browse: 'Browse Channels',
  'channels-roles': 'Channels & Roles',
  settings: 'Server Settings',
};

/** The app's own pages, by path (the first match wins). */
const PAGES: [RegExp, string][] = [
  [/^\/chats\/?$/, 'Friends'],
  [/^\/(?:you\/)?friends\/?$/, 'Friends'],
  [/^\/archived\/?$/, 'Archived Chats'],
  [/^\/starred\/?$/, 'Starred Messages'],
  [/^\/message-requests\/?$/, 'Message Requests'],
  [/^\/spaces\/?$/, 'Spaces'],
  [/^\/(?:discover|preview)(?:\/|$)/, 'Explore Spaces'],
  [/^\/calls(?:\/|$)/, 'Calls'],
  [/^\/updates(?:\/|$)/, 'Updates'],
  [/^\/collectibles(?:\/|$)/, 'Collectibles'],
  [/^\/notifications\/?$/, 'Notifications'],
  [/^\/new\/group\/?$/, 'New Group'],
  [/^\/new(?:\/|$)/, 'New Chat'],
  [/^\/join\//, 'Invite'],
  [/^\/template\//, 'Server Template'],
  [/^\/(?:users|u)\//, 'Profile'],
  [/^\/settings(?:\/|$)/, 'User Settings'],
  [/^\/welcome\/?$/, 'Welcome'],
  [/^\/you\/?$/, 'You'],
];

/** The place a path shows (null: nowhere worth naming). */
export function routePlace(pathname: string): RoutePlace | null {
  const space = /^\/spaces\/([^/]+)(?:\/([^/]+))?/.exec(pathname);
  if (space) {
    const spaceId = space[1]!;
    const rest = space[2];
    if (!rest) return { kind: 'space', spaceId, page: null };
    const page = SPACE_PAGES[rest];
    return page ? { kind: 'space', spaceId, page } : { kind: 'channel', spaceId, chatId: rest };
  }
  const chat = /^\/(?:chats|archived|starred|updates\/channels)\/([^/]+)\/?$/.exec(pathname);
  if (chat && chat[1] !== 'discover' && chat[1] !== 'new') return { kind: 'chat', chatId: chat[1]! };
  for (const [re, title] of PAGES) if (re.test(pathname)) return { kind: 'page', title };
  return null;
}

/** A channel's name as the title bar shows it: "#general" for text-like ones, voice and Stage plain. */
export function channelLabel(chat: Pick<ChatSummary, 'type' | 'name'>): string {
  const plain = chat.type === 'space_voice' || chat.type === 'space_stage';
  return `${plain ? '' : '#'}${chat.name ?? ''}`;
}
