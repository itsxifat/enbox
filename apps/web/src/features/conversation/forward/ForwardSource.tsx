/**
 * Where a forwarded message came from (polish wave), under its "Forwarded" label: the
 * original's time and, when I know its chat (it's in my chats), "#channel · Space name" or
 * the DM / group name — a button that jumps to the original (its place is looked up when it
 * isn't loaded). Unknown chats show the time only; copies made before sources existed, nothing.
 */
import { useEffect } from 'react';
import {
  chatTitle,
  isSpaceChatType,
  type ChatSummary,
  type ForwardSource as Source,
  type ID,
  type Message,
} from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { toast } from '@/stores/ui';
import { chatPath } from '@/features/chats/links';
import { openInternalLink } from '../bubbles/cards/internalLinks';

/** "Oct 22, 3:14 PM" (with the year when it isn't this one). */
export function forwardTime(iso: string, now = new Date(), locale?: string): string {
  const d = new Date(iso);
  return d.toLocaleString(locale, {
    month: 'short',
    day: 'numeric',
    year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** "#channel · Space name" for Space chats, else the chat's own title. */
export function sourcePlace(chat: ChatSummary, spaceName: string | undefined, me?: ID): string {
  if (!isSpaceChatType(chat.type)) return chatTitle(chat, me);
  const channel = `#${chat.name ?? 'channel'}`;
  return spaceName ? `${channel} · ${spaceName}` : channel;
}

/** Open the original where it is: its seq from the loaded history, else from the server. */
async function jumpToSource(chat: ChatSummary, src: Source): Promise<void> {
  let seq = useMessages
    .getState()
    .byChat[src.chatId]?.items.find((x) => x.id === src.messageId)?.seq;
  if (!seq) {
    try {
      seq = (await api.get<Message>(`/api/messages/${src.messageId}`)).seq;
    } catch (e) {
      toast.error(
        e instanceof ApiError && e.status === 404 ? "Message not found or you can't see it" : e,
        { id: 'forward-source' },
      );
      return;
    }
  }
  openInternalLink({
    kind: 'message',
    path: chatPath(chat, { seq, messageId: src.messageId }),
    messageId: src.messageId,
    chatId: chat.id,
    seq,
    spaceId: src.spaceId,
  });
}

/** Spaces whose channels a forward source asked for (once per session). */
const requested = new Set<ID>();

export function ForwardSource({ m }: { m: ClientMessage }) {
  const src = m.forwardedFrom;
  const chat = useChats((s) => (src ? s.byId[src.chatId] : undefined));
  const spaceName = useSpaces((s) => (src?.spaceId ? s.byId[src.spaceId]?.name : undefined));
  const channelsLoaded = useSpaces((s) => (src?.spaceId ? !!s.channelsLoaded[src.spaceId] : true));
  const me = useAuth((s) => s.user?.id);
  // An original in a Space of mine whose channels aren't loaded yet: load them for its name.
  const spaceToLoad = !chat && spaceName !== undefined && !channelsLoaded ? src?.spaceId : null;
  useEffect(() => {
    if (!spaceToLoad || requested.has(spaceToLoad)) return;
    requested.add(spaceToLoad);
    void useSpaces
      .getState()
      .loadSpace(spaceToLoad)
      .catch(() => undefined);
  }, [spaceToLoad]);
  if (!src) return null;
  return (
    <span
      className="flex min-w-0 items-center gap-1 px-1 text-[12px] leading-4 text-muted"
      data-testid="forward-source"
    >
      {chat ? (
        <>
          <button
            type="button"
            title="Jump to the original message"
            onClick={(e) => {
              e.stopPropagation();
              void jumpToSource(chat, src);
            }}
            className="min-w-0 truncate rounded-sm font-medium hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-brand"
          >
            {sourcePlace(chat, spaceName, me)}
          </button>
          <span aria-hidden>·</span>
        </>
      ) : null}
      <time
        dateTime={src.createdAt}
        title={new Date(src.createdAt).toLocaleString()}
        className="shrink-0"
      >
        {forwardTime(src.createdAt)}
      </time>
    </span>
  );
}
