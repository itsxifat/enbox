/**
 * What needs my attention, for the tab title, the favicon badge and the app badge (Discord):
 * - `mentions`: unread mentions of me across DMs, groups and Spaces, plus every unread message
 *   of a DM or a group DM (they are all for me) — the "(N)" of "(N) Enbox"
 * - `unread`: anything unread at all — the "• " when there are no mentions
 * Muted chats, muted channels and muted Spaces don't count, nor do archived chats and
 * broadcast channels. The counters are the stores' own (`ChatSummary` unread fields, Space
 * badges from `computeSpaceBadges`); nothing is recounted here. Pure (unit-tested).
 */
import {
  chatTitle,
  inChatList,
  isMuted,
  isSpaceChatType,
  type ChatSummary,
  type ID,
  type Space,
} from '@enbox/shared';
import { isChatUnread } from '@/stores/chats';
import { computeSpaceBadges, isSpaceMuted } from '@/stores/spaces';

export const APP_NAME = 'Enbox';

export interface Attention {
  mentions: number;
  unread: boolean;
}

export const NO_ATTENTION: Attention = Object.freeze({ mentions: 0, unread: false });

export function computeAttention(
  chats: Record<ID, ChatSummary>,
  spaces: Record<ID, Space>,
  channelsLoaded: Record<ID, boolean>,
  now = Date.now(),
): Attention {
  const at = new Date(now);
  let mentions = 0;
  let unread = false;
  // Space channels go through the Spaces' badges (minus the channels I muted).
  const spaceChats: Record<ID, ChatSummary> = {};
  for (const c of Object.values(chats)) {
    if (isMuted(c.mutedUntil, at)) continue;
    if (isSpaceChatType(c.type)) {
      spaceChats[c.id] = c;
      continue;
    }
    if (c.type === 'channel' || !inChatList(c.type) || c.isArchived) continue;
    const dm = c.type === 'direct' || !!c.isGroupDm;
    mentions += dm ? Math.max(c.unreadCount, c.unreadMentionCount) : c.unreadMentionCount;
    if (isChatUnread(c)) unread = true;
  }
  const live = Object.values(spaces).filter((s) => !isSpaceMuted(s, now));
  for (const badge of computeSpaceBadges(live, spaceChats, channelsLoaded, now).values()) {
    mentions += badge.mentions;
    if (badge.unread) unread = true;
  }
  return { mentions, unread };
}

/**
 * Where I am, after the app name: "#general | Gaming", "@Alice", a group's name; null =
 * nowhere in particular. `name` overrides the chat's own title (an unnamed group DM reads its
 * members' names, features/groupDms/title.ts).
 */
export function placeTitle(
  chat: Pick<ChatSummary, 'type' | 'name' | 'peer'> | undefined,
  space: Pick<Space, 'name'> | undefined,
  name?: string | null,
): string | null {
  if (!chat) return space ? space.name : null;
  if (isSpaceChatType(chat.type)) {
    const channel = `#${chat.name ?? ''}`;
    return space ? `${channel} | ${space.name}` : channel;
  }
  const title = name || chatTitle(chat);
  return chat.type === 'direct' ? `@${title}` : title;
}

/** "(3) Enbox | #general | Gaming", "• Enbox | @Alice" (unread, no mentions), "Enbox". */
export function documentTitle(attention: Attention, place: string | null): string {
  const prefix = attention.mentions > 0 ? `(${attention.mentions}) ` : attention.unread ? '• ' : '';
  return `${prefix}${APP_NAME}${place ? ` | ${place}` : ''}`;
}

/** The favicon badge's text: the count up to 9, then "9+"; '' = no badge. */
export function badgeLabel(count: number): string {
  if (count <= 0) return '';
  return count > 9 ? '9+' : String(count);
}
