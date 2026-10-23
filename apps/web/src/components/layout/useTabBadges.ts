import { useChats, useUnreadChatsCount, useUnreadChannelsCount } from '@/stores/chats';
import { useMissedCallsCount } from '@/features/calls';
import { inboxMentionCount } from '@/features/inbox/lib';
import { useIncomingFriendRequestCount } from '@/stores/friends';
import { useHasUnseenStatus } from '@/stores/status';
import { useSpaces, useSpacesTabBadge } from '@/stores/spaces';
import type { TabId } from './tabs';

export interface TabBadge {
  count?: number;
  dot?: boolean;
  /** Spoken text when the badge sums different things (the You tab). */
  label?: string;
}

/** The phone tabs, plus the rows behind them: Updates / Calls (Home sidebar, You page), Friends. */
export type BadgeKey = TabId | 'updates' | 'calls' | 'friends';

function plural(n: number, one: string): string {
  return `${n} ${one}${n === 1 ? '' : 's'}`;
}

/**
 * Badges for the nav:
 * - servers: Space mentions (count) or unread channels (dot);
 * - messages: unread DMs and groups;
 * - notifications: unread mentions (the Inbox's count);
 * - you: friend requests + missed calls (count), else unseen updates (dot) — the You page
 *   lists Friends, Updates and Calls on phones;
 * - updates (dot), calls (missed), friends (requests): those rows themselves.
 */
export function useTabBadges(): Partial<Record<BadgeKey, TabBadge>> {
  const unread = useUnreadChatsCount();
  const loaded = useChats((s) => s.loaded);
  const unseenStatus = useHasUnseenStatus();
  const unreadChannels = useUnreadChannelsCount();
  const missedCalls = useMissedCallsCount();
  const servers = useSpacesTabBadge();
  const requests = useIncomingFriendRequestCount();
  const spaces = useSpaces((s) => s.byId);
  const channelsLoaded = useSpaces((s) => s.channelsLoaded);
  // A number: re-renders only when the count changes, not on every chat update.
  const mentions = useChats((s) => inboxMentionCount(s.byId, spaces, channelsLoaded));
  const updates = unseenStatus || unreadChannels ? { dot: true } : undefined;
  const you = requests + missedCalls;
  return {
    servers,
    messages: loaded && unread ? { count: unread } : undefined,
    notifications: mentions ? { count: mentions } : undefined,
    you: you
      ? {
          count: you,
          label: [
            requests ? plural(requests, 'friend request') : '',
            missedCalls ? plural(missedCalls, 'missed call') : '',
          ]
            .filter(Boolean)
            .join(', '),
        }
      : updates
        ? { dot: true, label: 'new updates' }
        : undefined,
    updates,
    calls: missedCalls ? { count: missedCalls } : undefined,
    friends: requests ? { count: requests } : undefined,
  };
}

/** Spoken text for a badge ("3 unread chats", "1 missed call", "2 unread mentions"). */
export function tabBadgeText(id: BadgeKey, badge: TabBadge | undefined): string | null {
  if (!badge) return null;
  if (badge.label) return badge.label;
  if (badge.count) {
    const n = badge.count;
    switch (id) {
      case 'calls':
        return plural(n, 'missed call');
      case 'servers':
      case 'notifications':
        return plural(n, 'unread mention');
      case 'friends':
        return plural(n, 'friend request');
      default:
        return plural(n, 'unread chat');
    }
  }
  if (!badge.dot) return null;
  return id === 'servers' ? 'unread messages' : 'new updates';
}
