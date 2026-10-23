/**
 * A link to a message of this app (Copy Message Link) as a card: the author, where it was
 * posted ("#channel" or the chat's name), when, and the start of the message. The message
 * comes from the loaded conversation when it is there, else `GET /api/messages/:id` (a
 * session cache; a message I can't see answers 404: "Message not found or you can't see
 * it"). A click jumps to it (`openInternalLink`); a modified click opens it in a new tab.
 */
import { useEffect, useSyncExternalStore } from 'react';
import { MessageSquareOff } from 'lucide-react';
import {
  chatTitle,
  isSpaceChatType,
  messagePreviewText,
  type ID,
  type Message,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ApiError, api } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatChatListTime } from '@/lib/format';
import { getMyId, useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useSpaceAuthor } from '@/stores/spaces';
import { nameOf, useUserName } from '@/stores/users';
import { plainCustomEmoji } from '../../lib/richText';
import { EmbedFrame, cardClasses, useGrowNotice, type RemoveEmbeds } from './EmbedFrame';
import { isPlainClick, openInternalLink, type InternalLink } from './internalLinks';
import { plainMessageText } from './plainText';

type MessageLink = Extract<InternalLink, { kind: 'message' }>;
type Entry = { message: Message } | { missing: true };

/** A failed lookup (offline) is asked again after this long. */
const RETRY_AFTER_MS = 30_000;
const MAX_CACHED = 300;
const cache = new Map<ID, Entry>();
const failedAt = new Map<ID, number>();
const pending = new Set<ID>();
const listeners = new Set<() => void>();

function notify(): void {
  for (const fn of listeners) fn();
}

function load(id: ID): void {
  if (cache.has(id) || pending.has(id)) return;
  const failed = failedAt.get(id);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return;
  pending.add(id);
  api
    .get<Message>(`/api/messages/${id}`)
    .then(
      (message) => cache.set(id, { message }),
      (e: unknown) => {
        if (e instanceof ApiError && e.status >= 400 && e.status < 500 && e.status !== 429)
          cache.set(id, { missing: true });
        else failedAt.set(id, Date.now());
      },
    )
    .finally(() => {
      pending.delete(id);
      if (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
      notify();
    });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Tests: forget every looked-up message. */
export function resetLinkedMessages(): void {
  cache.clear();
  failedAt.clear();
  pending.clear();
}

/** The linked message: the loaded copy, else the looked-up one; null when it can't be seen. */
function useLinkedMessage(link: MessageLink): Message | null | undefined {
  const live = useMessages((s) =>
    s.byChat[link.chatId]?.items.find((m) => m.id === link.messageId),
  );
  const entry = useSyncExternalStore(subscribe, () => cache.get(link.messageId));
  useEffect(() => {
    if (!live) load(link.messageId);
  }, [live, link.messageId]);
  if (live) return live;
  if (!entry) return undefined;
  return 'message' in entry ? entry.message : null;
}

/** What the card quotes: the text as plain words, else what was sent ("📷 Photo"…). */
function snippetOf(m: Message, names: (id: ID) => string): string {
  if (!m.deletedAt && m.text && m.type === 'text') return plainMessageText(m.text, names);
  return plainCustomEmoji(messagePreviewText(m, names, { viewerId: getMyId() ?? undefined }));
}

function Found({ link, message: m }: { link: MessageLink; message: Message }) {
  const chat = useChats((s) => s.byId[m.chatId]);
  const spaceId = chat?.space?.spaceId ?? link.spaceId;
  const author = useSpaceAuthor(spaceId, m.senderId);
  // Discord shows my own name, not "You".
  const myName = useAuth((s) => s.user?.displayName);
  const userName = useUserName(m.senderId, { you: myName });
  const name =
    m.authorOverride?.name ??
    (m.senderId ? (author?.nickname ?? userName) : chat ? chatTitle(chat) : 'Message');
  const where = chat
    ? isSpaceChatType(chat.type)
      ? `#${chat.name ?? 'channel'}`
      : chat.type === 'direct'
        ? null
        : chatTitle(chat)
    : null;
  const snippet = snippetOf(m, (id) => nameOf(id));
  return (
    <a
      href={new URL(link.path, window.location.origin).href}
      onClick={(e) => {
        e.stopPropagation();
        if (!isPlainClick(e)) return;
        e.preventDefault();
        openInternalLink(link);
      }}
      data-testid="message-link-embed"
      className={cardClasses(
        null,
        'w-[min(400px,72vw)] max-w-full text-fg no-underline transition-colors hover:bg-black/[0.07] focus-visible:outline-2 focus-visible:outline-brand dark:hover:bg-white/[0.08]',
      )}
    >
      <span className="flex min-w-0 items-center gap-1.5 text-[12.5px]">
        {m.senderId ? <UserAvatar userId={m.senderId} size={18} decorated={false} /> : null}
        <span
          className="truncate font-semibold text-fg"
          style={author?.color ? { color: author.color } : undefined}
        >
          {name}
        </span>
        {where ? <span className="truncate text-muted">{where}</span> : null}
        <time
          dateTime={m.createdAt}
          title={new Date(m.createdAt).toLocaleString()}
          className="ml-auto shrink-0 text-[11.5px] text-muted"
        >
          {formatChatListTime(m.createdAt)}
        </time>
      </span>
      <span
        className={cn(
          'mt-1 line-clamp-3 block text-[13.5px] leading-snug break-words',
          m.deletedAt ? 'text-muted italic' : 'text-fg/85',
        )}
      >
        {snippet || 'Message'}
      </span>
    </a>
  );
}

export function MessageLinkCard({
  link,
  onRemove,
}: {
  link: MessageLink;
  onRemove?: RemoveEmbeds;
}) {
  const message = useLinkedMessage(link);
  useGrowNotice(message !== undefined);
  if (message === undefined) return null;
  return (
    <EmbedFrame onRemove={onRemove}>
      {message ? (
        <Found link={link} message={message} />
      ) : (
        <div
          className={cardClasses(
            null,
            'flex w-[min(400px,72vw)] max-w-full items-center gap-2 text-[13px] text-muted',
          )}
          data-testid="message-link-embed"
        >
          <MessageSquareOff size={16} aria-hidden className="shrink-0" />
          Message not found or you can't see it
        </div>
      )}
    </EmbedFrame>
  );
}
