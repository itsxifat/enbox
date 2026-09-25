/** Starred messages of one chat (filtered from `GET /api/messages/starred`). */
import { useEffect, useState } from 'react';
import { Star } from 'lucide-react';
import {
  chatKindOf,
  messagePreviewText,
  type ChatSummary,
  type MessageSearchResult,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, ListItemSkeleton } from '@/components/ui';
import { api, errorMessage } from '@/lib/api';
import { formatChatListTime } from '@/lib/format';
import { getMyId } from '@/stores/auth';
import { nameOf, useUsers } from '@/stores/users';

export function StarredView({ chat, onBack }: { chat: ChatSummary; onBack: () => void }) {
  const [items, setItems] = useState<MessageSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Re-render names once missing users arrive.
  useUsers((s) => s.byId);

  useEffect(() => {
    let alive = true;
    api
      .get<MessageSearchResult[]>('/api/messages/starred')
      .then((list) => {
        if (!alive) return;
        const mine = list.filter((r) => r.chat.id === chat.id);
        const ids = mine.map((r) => r.message.senderId).filter((x): x is string => !!x);
        void useUsers
          .getState()
          .fetchUsers(ids)
          .catch(() => undefined);
        setItems(mine);
      })
      .catch((e: unknown) => alive && setError(errorMessage(e)));
    return () => {
      alive = false;
    };
  }, [chat.id]);

  const me = getMyId() ?? undefined;
  return (
    <div className="flex min-h-full flex-col bg-surface">
      <PaneHeader title="Starred messages" back={onBack} border />
      {items === null && !error ? (
        <ListItemSkeleton count={4} />
      ) : !items?.length ? (
        <EmptyState
          compact
          icon={Star}
          title={error ? "Couldn't load" : 'No starred messages'}
          description={
            error ??
            'Tap and hold on any message in this chat to star it, so you can easily find it later.'
          }
        />
      ) : (
        <ul className="divide-y divide-line">
          {items.map(({ message }) => (
            <li key={message.id} className="flex gap-3 px-4 py-3">
              {message.senderId ? (
                <UserAvatar userId={message.senderId} size="sm" />
              ) : (
                <span className="size-8" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-[14px] font-semibold text-fg">
                    {message.senderId ? nameOf(message.senderId) : (chat.name ?? 'Channel')}
                  </span>
                  <span className="shrink-0 text-xs text-subtle">
                    {formatChatListTime(message.createdAt)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-3 text-[14.5px] break-words text-fg">
                  {messagePreviewText(message, (id) => nameOf(id), {
                    viewerId: me,
                    chatKind: chatKindOf(chat),
                  })}
                </p>
              </div>
              <Star
                size={14}
                className="mt-1 shrink-0 fill-current text-warning"
                aria-label="Starred"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
