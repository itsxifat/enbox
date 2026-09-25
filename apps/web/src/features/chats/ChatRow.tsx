/**
 * PLACEHOLDER (agent 2): a basic chat row that exercises the stores. Replace with the
 * polished row (draft preview, ticks, mentions, context menu, swipe actions…).
 */
import type { ReactNode } from 'react';
import { AtSign, BellOff, Check, CheckCheck, Clock, Pin } from 'lucide-react';
import {
  chatKindOf,
  chatTitle,
  isMuted,
  messagePreviewText,
  tickStatus,
  type ChatSummary,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { Badge, ListItem } from '@/components/ui';
import { formatChatListTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { isChatUnread, useTypingUsers } from '@/stores/chats';
import type { ClientMessage } from '@/stores/messages';
import { nameOf } from '@/stores/users';

export function ChatRow({ chat, to, active }: { chat: ChatSummary; to: string; active?: boolean }) {
  const me = useAuth((s) => s.user?.id);
  const typing = useTypingUsers(chat.id);
  const typingIds = Object.keys(typing);
  const muted = isMuted(chat.mutedUntil);
  const unread = isChatUnread(chat);
  const last = chat.lastMessage as ClientMessage | null;
  const mine = !!last && last.senderId === me;

  let subtitle: ReactNode = '';
  if (typingIds.length) {
    const who = chat.type === 'group' ? `${nameOf(typingIds[0]!)} is ` : '';
    const recording = Object.values(typing).some((t) => t.state === 'recording');
    subtitle = (
      <span className="text-brand-ink">
        {who}
        {recording ? 'recording audio…' : 'typing…'}
      </span>
    );
  } else if (last) {
    const status = mine ? (last.pending ? 'pending' : tickStatus(last, chat)) : null;
    const prefix =
      !mine && chat.type === 'group' && last.senderId && last.type !== 'system'
        ? `${nameOf(last.senderId)}: `
        : '';
    subtitle = (
      <span className="inline-flex max-w-full items-center gap-1">
        {status === 'pending' ? (
          <Clock size={14} className="shrink-0" aria-label="Sending" />
        ) : null}
        {status === 'sent' ? <Check size={16} className="shrink-0" aria-label="Sent" /> : null}
        {status === 'delivered' ? (
          <CheckCheck size={16} className="shrink-0" aria-label="Delivered" />
        ) : null}
        {status === 'read' ? (
          <CheckCheck size={16} className="shrink-0 text-tick-read" aria-label="Read" />
        ) : null}
        <span className="truncate">
          {prefix}
          {messagePreviewText(last, (id) => nameOf(id), {
            viewerId: me,
            chatKind: chatKindOf(chat),
          })}
        </span>
      </span>
    );
  } else if (chat.description) {
    subtitle = chat.description;
  }

  return (
    <ListItem
      to={to}
      active={active}
      leading={<ChatAvatar chat={chat} size="lg" />}
      title={chatTitle(chat, me)}
      meta={
        chat.lastMessage || chat.lastActivityAt
          ? formatChatListTime(chat.lastActivityAt)
          : undefined
      }
      highlight={unread && !muted}
      subtitle={subtitle}
      trailing={
        <>
          {muted ? <BellOff size={15} aria-label="Muted" /> : null}
          {chat.unreadMentionCount > 0 ? (
            <span
              className="flex size-5 items-center justify-center rounded-full bg-unread text-on-brand"
              aria-label="Mentioned"
            >
              <AtSign size={12} strokeWidth={2.6} />
            </span>
          ) : null}
          {chat.isPinned && !unread ? (
            <Pin size={15} className="rotate-45" aria-label="Pinned" />
          ) : null}
          {unread ? (
            chat.unreadCount > 0 ? (
              <Badge
                count={chat.unreadCount}
                tone={muted ? 'muted' : 'brand'}
                label={`${chat.unreadCount} unread`}
              />
            ) : (
              <span
                className={
                  muted ? 'size-5 rounded-full bg-unread-muted' : 'size-5 rounded-full bg-unread'
                }
                role="status"
                aria-label="Marked unread"
              />
            )
          ) : null}
        </>
      }
    />
  );
}
