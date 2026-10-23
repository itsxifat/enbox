/**
 * A group DM's row menu in the DM list (Discord): Mark as Read, mute, Leave Group, and Copy
 * Channel ID in Developer Mode.
 */
import { Bell, BellOff, IdCard, LogOut, MailCheck } from 'lucide-react';
import { isMuted, type ChatSummary } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import { markRead, muteChat, unmuteChat } from '@/features/chats/chatActions';
import { isChatUnread } from '@/stores/chats';
import { leaveGroupDm } from './actions';

export function groupDmRowMenu(
  chat: ChatSummary,
  opts: { title: string; devMode: boolean; onLeft?: () => void },
): MenuEntry[] {
  return [
    {
      label: 'Mark as Read',
      icon: MailCheck,
      disabled: !isChatUnread(chat),
      onSelect: () => markRead(chat),
    },
    isMuted(chat.mutedUntil)
      ? { label: 'Unmute notifications', icon: Bell, onSelect: () => void unmuteChat(chat) }
      : { label: 'Mute notifications', icon: BellOff, onSelect: () => void muteChat(chat) },
    'separator',
    {
      label: 'Leave Group',
      icon: LogOut,
      danger: true,
      onSelect: () =>
        void leaveGroupDm(chat, opts.title).then((ok) => {
          if (ok) opts.onLeft?.();
        }),
    },
    opts.devMode && 'separator',
    opts.devMode && {
      label: 'Copy Channel ID',
      icon: IdCard,
      // The conversation's helper, loaded on use (it lives in the conversation bundle).
      onSelect: () =>
        void import('@/features/conversation/moreActions').then((m) =>
          m.copyId(chat.id, 'Channel ID'),
        ),
    },
  ];
}
