import { useChats, useUnreadChatsCount, useUnreadChannelsCount } from '@/stores/chats';
import { useHasUnseenStatus } from '@/stores/status';
import type { TabId } from './tabs';

export interface TabBadge {
  count?: number;
  dot?: boolean;
}

/** Badges for the nav: unread chats count, Updates dot (unseen status / unread channels). */
export function useTabBadges(): Partial<Record<TabId, TabBadge>> {
  const unread = useUnreadChatsCount();
  const unseenStatus = useHasUnseenStatus();
  const unreadChannels = useUnreadChannelsCount();
  const loaded = useChats((s) => s.loaded);
  return {
    chats: loaded && unread ? { count: unread } : undefined,
    updates: unseenStatus || unreadChannels ? { dot: true } : undefined,
  };
}
