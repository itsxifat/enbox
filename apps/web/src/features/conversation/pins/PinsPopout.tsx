/**
 * The header's Pinned Messages button and its popout (Discord): the chat's pins, newest pin
 * first, as message cards (author, time, rich text) with Jump and — for members who may pin —
 * Unpin. Loaded from `GET /chats/:chatId/pins` when opened, and again when `chat:pins` brings a
 * pin it hasn't loaded. Space channels have no pinned bar, so the button also seeds the cached
 * pin ids there (the message menu's Pin / Unpin reads them).
 */
import { useEffect, useMemo, useState } from 'react';
import { Pin, X } from 'lucide-react';
import type { ChatSummary, Message } from '@enbox/shared';
import { Button, IconButton, Popover, Spinner } from '@/components/ui';
import { MessagePreview } from '@/features/inbox/MessagePreview';
import { api } from '@/lib/api';
import { useChats } from '@/stores/chats';
import { toast } from '@/stores/ui';
import { useUsers } from '@/stores/users';
import { unpinMessage } from '../actions';
import { useConversationUi } from '../state';

const NO_PINS: string[] = [];

function emptyText(chat: ChatSummary): string {
  const what =
    chat.type === 'direct' ? 'direct message' : chat.type === 'group' ? 'group' : 'channel';
  return `This ${what} doesn’t have any pinned messages… yet.`;
}

async function loadPins(chat: ChatSummary): Promise<Message[]> {
  const list = await api.get<Message[]>(`/api/chats/${chat.id}/pins`);
  const senders = [...new Set(list.map((m) => m.senderId).filter((x): x is string => !!x))];
  if (senders.length)
    void useUsers
      .getState()
      .fetchUsers(senders)
      .catch(() => undefined);
  // Seed the cached ids when nothing did yet (a `chat:pins` that arrived meanwhile is newer).
  if (useChats.getState().pins[chat.id] === undefined)
    useChats.getState().setPins(
      chat.id,
      list.map((m) => m.id),
    );
  return list;
}

export function PinsButton({ chat }: { chat: ChatSummary }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const isSpace = !!chat.space;
  useEffect(() => {
    if (!isSpace || useChats.getState().pins[chat.id] !== undefined) return;
    loadPins(chat).catch(() => undefined);
    // Once per channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, isSpace]);
  return (
    <>
      <IconButton
        icon={Pin}
        label="Pinned Messages"
        variant="ghost"
        active={!!anchor}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
        data-testid="pins-button"
      />
      <Popover
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        placement="bottom"
        align="end"
        aria-label="Pinned Messages"
        className="w-[min(420px,calc(100vw-16px))] overflow-hidden"
      >
        {anchor ? <PinsPopout chat={chat} onClose={() => setAnchor(null)} /> : null}
      </Popover>
    </>
  );
}

/** The popout's body (exported for tests). */
export function PinsPopout({ chat, onClose }: { chat: ChatSummary; onClose: () => void }) {
  const ids = useChats((s) => s.pins[chat.id] ?? NO_PINS);
  const known = useChats((s) => s.pins[chat.id] !== undefined);
  const [list, setList] = useState<Message[] | null>(null);
  const [generation, setGeneration] = useState(0);
  const canUnpin = chat.permissions.canPin && chat.membership === 'active';

  // A pin we haven't loaded (pinned meanwhile, here or elsewhere): load the list again.
  const missing = !!list && ids.some((id) => !list.some((m) => m.id === id));
  useEffect(() => {
    if (missing) setGeneration((g) => g + 1);
  }, [missing]);

  useEffect(() => {
    let cancelled = false;
    loadPins(chat)
      .then((pins) => {
        if (!cancelled) setList(pins);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setList([]);
        toast.error(e);
      });
    return () => {
      cancelled = true;
    };
    // The chat object changes with every summary update; its id and the generation matter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat.id, generation]);

  // Newest pin first (the API lists the oldest first); unpinned ones leave at once.
  const pins = useMemo(
    () =>
      (list ?? [])
        .filter((m) => !known || ids.includes(m.id))
        .filter((m) => !m.deletedAt)
        .reverse(),
    [list, ids, known],
  );

  const jump = (m: Message) => {
    onClose();
    useConversationUi.getState().requestJump(chat.id, m.seq, m.id);
  };

  return (
    <div className="flex max-h-[min(70vh,600px)] flex-col" data-testid="pins-popout">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Pin size={20} className="shrink-0 text-muted" aria-hidden />
        <h2 className="text-[16px] font-bold text-fg">Pinned Messages</h2>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2 scrollbar-thin">
        {list === null ? (
          <div className="flex justify-center py-10 text-brand-ink">
            <Spinner size={22} />
          </div>
        ) : pins.length ? (
          <ul aria-label="Pinned messages" className="flex flex-col gap-1.5">
            {pins.map((m) => (
              <li
                key={m.id}
                className="group/pin relative rounded-lg bg-surface-2 px-3 py-2.5"
                data-testid="pin-card"
              >
                <MessagePreview
                  message={m}
                  spaceId={chat.space?.spaceId ?? null}
                  className="pr-20"
                />
                <div className="absolute top-2 right-2 flex items-center gap-1">
                  <Button size="sm" variant="secondary" onClick={() => jump(m)}>
                    Jump
                  </Button>
                  {canUnpin ? (
                    <IconButton
                      icon={X}
                      label="Unpin message"
                      size="sm"
                      onClick={() => void unpinMessage(chat, m.id)}
                    />
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-surface-2 text-subtle">
              <Pin size={26} aria-hidden />
            </span>
            <p className="max-w-[18rem] text-[14px] text-muted">{emptyText(chat)}</p>
          </div>
        )}
      </div>
    </div>
  );
}
