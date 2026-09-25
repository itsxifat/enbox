/** Starred messages (/starred): newest star first; tap to open the message in its chat. */
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { ChevronRight, Star, StarOff } from 'lucide-react';
import { chatTitle, renderMentions, type MessageSearchResult } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ChatAvatar } from '@/components/common/ChatAvatar';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { Button, EmptyState, IconButton, ListItemSkeleton } from '@/components/ui';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatShortDate, formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { useUserName, useUsers } from '@/stores/users';
import { messageLink } from './links';
import { PreviewLine, mentionName, previewParts } from './preview';

function StarredRow({
  r,
  active,
  onUnstar,
}: {
  r: MessageSearchResult;
  active: boolean;
  onUnstar: () => void;
}) {
  const navigate = useNavigate();
  const me = useAuth((s) => s.user?.id);
  const m = r.message;
  const sender = useUserName(m.senderId, { you: 'You' });
  const chatName = chatTitle({ ...r.chat }, me);
  const direct = r.chat.type === 'direct';
  const channel = r.chat.type === 'channel';
  const mine = m.senderId === me;
  const thumb = m.media?.thumbnailUrl ?? (m.media?.kind === 'image' ? m.media.url : null);
  const text = m.text ? renderMentions(m.text, mentionName) : null;
  const from = channel ? chatName : sender;
  const to = channel ? null : direct ? (mine ? chatName : 'You') : chatName;
  return (
    <div
      className={cn(
        'group/star relative border-b border-line px-4 py-3 transition-colors hover:bg-hover',
        active && 'bg-selected hover:bg-selected',
      )}
    >
      <button
        type="button"
        className="absolute inset-0 z-0 outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        aria-label={`Open starred message from ${from}`}
        onClick={() => navigate(messageLink(r.chat.id, m.seq, m.id, '/starred'))}
      />
      <div className="pointer-events-none relative flex items-center gap-2 text-[13px]">
        {channel ? (
          <ChatAvatar chat={{ ...r.chat, isAnnouncement: false, communityId: null }} size="xs" />
        ) : (
          <UserAvatar userId={m.senderId} size="xs" />
        )}
        <span className="flex min-w-0 flex-1 items-center gap-1 font-medium text-fg">
          <span className="truncate">{from}</span>
          {to ? (
            <>
              <ChevronRight size={14} className="shrink-0 text-subtle" aria-hidden />
              <span className="truncate">{to}</span>
            </>
          ) : null}
        </span>
        <span className="shrink-0 text-xs text-subtle">{formatShortDate(m.createdAt)}</span>
      </div>
      <div className="pointer-events-none relative mt-2 flex items-end gap-2 pl-8">
        <div
          className={cn(
            'max-w-[85%] rounded-xl px-3 py-2 text-[14px] text-fg shadow-bubble',
            mine ? 'bg-bubble-out' : 'bg-bubble-in',
          )}
        >
          {thumb ? (
            <img
              src={mediaUrl(thumb)}
              alt=""
              className="mb-1.5 max-h-40 rounded-lg object-cover"
              loading="lazy"
            />
          ) : null}
          {text ? (
            <p className="line-clamp-4 break-words whitespace-pre-wrap">{text}</p>
          ) : (
            <PreviewLine parts={previewParts(m, { meId: me })} />
          )}
          <span
            className={cn(
              'mt-0.5 flex items-center justify-end gap-1 text-[11px]',
              mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
            )}
          >
            <Star size={11} className="fill-current" aria-label="Starred" />
            {formatTime(m.createdAt)}
          </span>
        </div>
      </div>
      <IconButton
        icon={StarOff}
        label="Unstar"
        size="sm"
        onClick={onUnstar}
        className="absolute top-2.5 right-2 z-[1] opacity-0 group-hover/star:opacity-100 focus-visible:opacity-100"
      />
    </div>
  );
}

export function StarredPane() {
  const { chatId } = useParams();
  const [items, setItems] = useState<MessageSearchResult[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    api
      .get<MessageSearchResult[]>('/api/messages/starred')
      .then((list) => {
        const ids = new Set<string>();
        for (const r of list) if (r.message.senderId) ids.add(r.message.senderId);
        void useUsers
          .getState()
          .fetchUsers(ids)
          .catch(() => undefined);
        setItems(list);
      })
      .catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  useEffect(load, [load]);

  const unstar = async (r: MessageSearchResult) => {
    setItems((list) => list?.filter((x) => x.message.id !== r.message.id) ?? null);
    try {
      await api.delete(`/api/messages/${r.message.id}/star`);
      useMessages.getState().patchMessage(r.message.chatId, r.message.id, { starred: false });
    } catch (e) {
      toast.error(e);
      load();
    }
  };

  return (
    <>
      <PaneHeader title="Starred messages" back="/chats" />
      <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin" data-testid="starred-list">
        {error && !items ? (
          <EmptyState
            icon={Star}
            title="Couldn't load starred messages"
            description={error}
            action={<Button onClick={load}>Try again</Button>}
          />
        ) : !items ? (
          <ListItemSkeleton count={5} />
        ) : items.length ? (
          items.map((r) => (
            <StarredRow
              key={r.message.id}
              r={r}
              active={r.chat.id === chatId}
              onUnstar={() => void unstar(r)}
            />
          ))
        ) : (
          <EmptyState
            icon={Star}
            title="No starred messages"
            description="Tap and hold (or right-click) any message and choose Star to find it here later."
          />
        )}
      </div>
    </>
  );
}
