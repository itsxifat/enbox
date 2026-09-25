import { useChats, useUnreadChatsCount, useUnreadChannelsCount } from '@/stores/chats';
import { useMissedCallsCount } from '@/features/calls';
import { useHasUnseenStatus } from '@/stores/status';
import type { TabId } from './tabs';

export interface TabBadge {
  count?: number;
  dot?: boolean;
}

/** Badges for the nav: unread chats count, Updates dot (unseen status / unread channels), missed calls. */
export function useTabBadges(): Partial<Record<TabId, TabBadge>> {
  const unread = useUnreadChatsCount();
  const unseenStatus = useHasUnseenStatus();
  const unreadChannels = useUnreadChannelsCount();
  const missedCalls = useMissedCallsCount();
  const loaded = useChats((s) => s.loaded);
  return {
    chats: loaded && unread ? { count: unread } : undefined,
    updates: unseenStatus || unreadChannels ? { dot: true } : undefined,
    calls: missedCalls ? { count: missedCalls } : undefined,
  };
}

/** Spoken text for a tab's badge ("3 unread chats", "1 missed call", "new updates"). */
export function tabBadgeText(id: TabId, badge: TabBadge | undefined): string | null {
  if (badge?.count) {
    const n = badge.count;
    return id === 'calls'
      ? `${n} missed call${n === 1 ? '' : 's'}`
      : `${n} unread chat${n === 1 ? '' : 's'}`;
  }
  return badge?.dot ? 'new updates' : null;
}
