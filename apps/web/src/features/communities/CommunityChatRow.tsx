/** Compact chat row used under a community (announcements / groups) with a live preview. */
import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Megaphone } from 'lucide-react';
import { chatKindOf, isMuted, messagePreviewText, referencedUserIds, type ID } from '@enbox/shared';
import { Avatar, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatChatListTime } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { isChatUnread, useChat } from '@/stores/chats';
import { nameOf, useUsers } from '@/stores/users';
import { IN_APP_NAV } from '@/components/layout/navigation';

export function CommunityChatRow({
  chatId,
  name,
  avatarUrl,
  announcement,
  fallback,
  indent,
  active,
  end,
}: {
  chatId: ID;
  name: string;
  avatarUrl: string | null;
  announcement?: boolean;
  /** Subtitle when the chat isn't in the list (not a member). */
  fallback?: ReactNode;
  indent?: boolean;
  active?: boolean;
  /** Right slot (e.g. Join button) — makes the row non-navigating. */
  end?: ReactNode;
}) {
  const chat = useChat(chatId);
  const me = getMyId() ?? undefined;
  const last = chat?.lastMessage;
  // Re-render when referenced users arrive; fetch the ones we don't know yet.
  useUsers((s) => s.byId);
  useEffect(() => {
    if (last)
      void useUsers
        .getState()
        .fetchUsers(referencedUserIds(last))
        .catch(() => undefined);
  }, [last]);
  const sender =
    last && last.senderId && last.type !== 'system' && last.type !== 'call'
      ? last.senderId === me
        ? 'You'
        : nameOf(last.senderId)
      : null;
  const preview = last
    ? messagePreviewText(last, (id) => nameOf(id), {
        viewerId: me,
        chatKind: chat ? chatKindOf(chat) : 'group',
      })
    : null;
  const unread = chat ? isChatUnread(chat) : false;
  const muted = chat ? isMuted(chat.mutedUntil) : false;

  const body = (
    <>
      {announcement ? (
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[28%] bg-brand-soft text-brand-ink">
          <Megaphone size={20} aria-hidden />
        </span>
      ) : (
        <Avatar src={avatarUrl} name={name} colorSeed={chatId} kind="group" size={44} />
      )}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-baseline gap-2">
          <span
            className={cn(
              'min-w-0 flex-1 truncate text-[15.5px] text-fg',
              unread ? 'font-semibold' : 'font-medium',
            )}
          >
            {announcement ? 'Announcements' : name}
          </span>
          {chat && last && !end ? (
            <span
              className={cn(
                'shrink-0 text-xs tabular-nums',
                unread && !muted ? 'font-medium text-brand-ink' : 'text-subtle',
              )}
            >
              {formatChatListTime(chat.lastActivityAt)}
            </span>
          ) : null}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={cn('min-w-0 flex-1 truncate text-[14px]', unread ? 'text-fg' : 'text-muted')}
          >
            {preview ? (
              <>
                {sender ? `${sender}: ` : ''}
                {preview}
              </>
            ) : (
              fallback
            )}
          </span>
          {chat && unread && !end ? (
            <Badge
              count={chat.unreadCount || undefined}
              dot={!chat.unreadCount}
              tone={muted ? 'muted' : 'brand'}
              size="sm"
              label={`${chat.unreadCount} unread`}
            />
          ) : null}
        </span>
      </span>
      {end}
    </>
  );
  const classes = cn(
    'flex w-full items-center gap-3 py-2.5 pr-4 text-left outline-none transition-colors',
    indent ? 'pl-7' : 'pl-4',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
    active && 'bg-selected',
  );
  if (end) return <div className={classes}>{body}</div>;
  return (
    // Tagged in-app: the chat's Back arrow returns to this community page, not the chat list.
    <Link
      to={`/chats/${chatId}`}
      state={IN_APP_NAV}
      className={cn(classes, 'hover:bg-hover focus-visible:bg-hover')}
    >
      {body}
    </Link>
  );
}
