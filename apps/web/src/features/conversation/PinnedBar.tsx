/** Pinned messages bar: shows one pin at a time; tap jumps to it and cycles to the next. */
import { useEffect, useMemo, useState } from 'react';
import { Pin, PinOff } from 'lucide-react';
import type { ChatSummary, Message } from '@enbox/shared';
import { IconButton } from '@/components/ui';
import { api, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useUsers } from '@/stores/users';
import { PreviewLine, previewParts } from '@/features/chats/preview';
import { unpinMessage } from './actions';
import { useConversationUi } from './state';

const NO_IDS: string[] = [];

export function PinnedBar({ chat }: { chat: ChatSummary }) {
  const me = useAuth((s) => s.user?.id);
  const ids = useChats((s) => s.pins[chat.id] ?? NO_IDS);
  const known = useChats((s) => s.pins[chat.id] !== undefined);
  const items = useMessages((s) => s.byChat[chat.id]?.items);
  const [fetched, setFetched] = useState<Message[]>([]);
  const [synced, setSynced] = useState(false);
  const [index, setIndex] = useState(0);
  const active = chat.membership === 'active';

  // The cached ids may be stale (pins changed while this chat wasn't open, or offline): load
  // the list once per open, and again whenever the pinned set has ids we can't render.
  // Former members get [] from the server (and no bar).
  const missing = ids.some((id) => !fetched.some((m) => m.id === id));
  const needFetch = !synced || !known || missing;
  const idsKey = ids.join(',');
  useEffect(() => {
    if (!needFetch) return;
    let cancelled = false;
    const before = useChats.getState().pins[chat.id];
    api
      .get<Message[]>(`/api/chats/${chat.id}/pins`)
      .then((list) => {
        if (cancelled) return;
        setFetched(list);
        setSynced(true);
        void useUsers
          .getState()
          .fetchUsers(list.map((m) => m.senderId).filter((x): x is string => !!x))
          .catch(() => undefined);
        // A chat:pins that arrived during the request is newer than this list: keep it.
        if (useChats.getState().pins[chat.id] === before)
          useChats.getState().setPins(
            chat.id,
            list.map((m) => m.id),
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chat.id, needFetch, idsKey]);

  const pins = useMemo(
    () =>
      ids
        .map((id) => items?.find((m) => m.id === id) ?? fetched.find((m) => m.id === id))
        .filter((m): m is Message => !!m && !m.deletedAt),
    [ids, items, fetched],
  );

  if (!active || !pins.length) return null;
  const i = index % pins.length;
  const m = pins[i]!;
  const thumb =
    m.media && (m.type === 'image' || m.type === 'video')
      ? (m.media.thumbnailUrl ?? (m.type === 'image' ? m.media.url : null))
      : null;

  return (
    <div
      className="flex shrink-0 items-center gap-2 border-b border-line bg-surface py-1.5 pr-1 pl-3 animate-slide-down"
      data-testid="pinned-bar"
    >
      <span className="flex h-9 flex-col justify-center gap-0.5" aria-hidden>
        {pins.map((p, j) => (
          <span
            key={p.id}
            className={cn('w-[3px] flex-1 rounded-full', j === i ? 'bg-brand' : 'bg-line-strong')}
          />
        ))}
      </span>
      <button
        type="button"
        onClick={() => {
          useConversationUi.getState().requestJump(chat.id, m.seq, m.id);
          setIndex((x) => x + 1);
        }}
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-0.5 text-left outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
        aria-label={`Pinned message ${i + 1} of ${pins.length}. Go to message`}
      >
        <Pin size={16} className="shrink-0 rotate-45 text-muted" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-[12px] font-semibold text-brand-ink">
            {pins.length > 1 ? `Pinned message ${i + 1} of ${pins.length}` : 'Pinned message'}
          </span>
          <span className="truncate text-[13.5px] text-muted">
            <PreviewLine parts={previewParts(m, { meId: me, chat })} />
          </span>
        </span>
        {thumb ? (
          <img src={mediaUrl(thumb)} alt="" className="size-9 shrink-0 rounded object-cover" />
        ) : null}
      </button>
      {chat.permissions.canPin ? (
        <IconButton
          icon={PinOff}
          label="Unpin message"
          size="sm"
          onClick={() => void unpinMessage(chat, m.id)}
        />
      ) : null}
    </div>
  );
}
