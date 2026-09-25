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
  const [index, setIndex] = useState(0);
  const active = chat.membership === 'active';

  // Seed on open and refetch whenever the pinned set changes to one we can't render.
  const missing = ids.some((id) => !fetched.some((m) => m.id === id));
  useEffect(() => {
    if (!active || (known && !missing)) return;
    let cancelled = false;
    api
      .get<Message[]>(`/api/chats/${chat.id}/pins`)
      .then((list) => {
        if (cancelled) return;
        setFetched(list);
        void useUsers
          .getState()
          .fetchUsers(list.map((m) => m.senderId).filter((x): x is string => !!x))
          .catch(() => undefined);
        if (!known)
          useChats.getState().setPins(
            chat.id,
            list.map((m) => m.id),
          );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [chat.id, active, known, missing]);

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
        className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-1 py-0.5 text-left outline-none hover:bg-hover focus-visible:bg-hover"
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
