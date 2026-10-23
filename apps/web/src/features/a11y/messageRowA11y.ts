/**
 * Screen reader and keyboard attributes of a message row: spread on the row's outer element by
 * MessageRow and CozyMessageRow. A row is an article named "<author>, <time>, <content>" (the
 * text cut to LABEL_TEXT_MAX characters, or what the message is: "Image", "Sticker, Wave"…),
 * focusable from script only (MessageList moves the focus between rows, rowKeys.ts), with
 * `aria-setsize -1` since the list is loaded in windows.
 */
import { useMemo, type HTMLAttributes } from 'react';
import {
  formatDuration,
  messagePreviewText,
  userDisplayName,
  type ChatSummary,
} from '@enbox/shared';
import { plainMessageText } from '@/features/conversation/bubbles/cards/plainText';
import { formatTime } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { nameOf, useUsers } from '@/stores/users';

/** Characters of a message's text its label keeps. */
export const LABEL_TEXT_MAX = 80;

function shorten(text: string): string {
  const chars = Array.from(text);
  return chars.length > LABEL_TEXT_MAX
    ? `${chars.slice(0, LABEL_TEXT_MAX).join('').trimEnd()}…`
    : text;
}

const KIND_LABELS: Partial<Record<ClientMessage['type'], string>> = {
  image: 'Image',
  video: 'Video',
  audio: 'Audio',
  file: 'File',
  location: 'Location',
  contact: 'Contact',
  poll: 'Poll',
};

/** What a message says or is, in words (`text`: its text as plain words). Pure. */
export function messageContentLabel(m: ClientMessage, text: string, mine: boolean): string {
  if (m.deletedAt) return mine ? 'You deleted this message' : 'This message was deleted';
  const files = m.attachments?.length ?? 0;
  let kind: string | null;
  if (m.sticker) kind = `Sticker, ${m.sticker.name}`;
  else if (files > 1)
    kind = m.attachments!.every((a) => a.kind === 'image') ? `${files} images` : `${files} files`;
  else if (m.type === 'voice') kind = `Voice message, ${formatDuration(m.media?.durationMs)}`;
  else if (m.type === 'call')
    // "Missed voice call"…, from the caller's side when the message is mine.
    kind = messagePreviewText(m, nameOf, { viewerId: (mine && m.senderId) || undefined });
  else {
    const detail =
      m.type === 'image' || m.type === 'video'
        ? m.attachments?.[0]?.description
        : m.type === 'audio' || m.type === 'file'
          ? m.media?.fileName
          : m.type === 'location'
            ? m.location?.name
            : m.type === 'contact'
              ? m.contact?.name
              : m.type === 'poll'
                ? m.poll?.question
                : null;
    const base = KIND_LABELS[m.type] ?? null;
    kind = base && detail ? `${base}, ${detail}` : base;
  }
  const embed = !text && !kind ? m.embeds?.find((e) => e.title || e.description) : undefined;
  const words = text || (embed ? (embed.title ?? embed.description ?? '') : '');
  return [kind, words ? shorten(words) : null].filter(Boolean).join(', ') || 'Message';
}

/** "Ann, 3:14 PM, Hello there" (", not sent" after a failed send). Pure. */
export function messageRowLabel(
  m: ClientMessage,
  author: string,
  text: string,
  mine: boolean,
): string {
  const label = `${author}, ${formatTime(m.createdAt)}, ${messageContentLabel(m, text, mine)}`;
  return m.failed ? `${label}, not sent` : label;
}

/** The attributes for a row labelled `label`. Pure. */
export function messageRowA11y(label: string): HTMLAttributes<HTMLDivElement> {
  return {
    role: 'article',
    'aria-roledescription': 'Message',
    'aria-label': label,
    'aria-setsize': -1,
    tabIndex: -1,
  };
}

/**
 * The row's attributes, naming its author as the row shows them: a webhook's or crosspost's
 * name, the nickname in a Space, my own display name. String selectors: a row re-renders when
 * the name it reads out changes, not on every profile or Space update (the name and avatar
 * components load what is missing). Call before any early return (system rows too).
 */
export function useMessageRowA11y(
  m: ClientMessage,
  chat: ChatSummary,
  mine: boolean,
): HTMLAttributes<HTMLDivElement> {
  const lookup = m.type === 'system' || m.authorOverride ? null : m.senderId;
  const spaceId = chat.space?.spaceId;
  const myName = useAuth((s) => (mine ? (s.user?.displayName ?? null) : null));
  const userName = useUsers((s) => {
    const user = lookup && !mine ? s.byId[lookup] : undefined;
    return user ? userDisplayName(user) : null;
  });
  // In a Space: the nickname (mine from `space.me` until my member row loads).
  const nickname = useSpaces((s) => {
    if (!spaceId || !lookup) return null;
    const member = s.members[spaceId]?.[lookup] ?? (mine ? s.byId[spaceId]?.me : undefined);
    return member?.nickname ?? null;
  });
  const text = useMemo(
    () => (m.text && !m.deletedAt ? plainMessageText(m.text, (id) => nameOf(id)) : ''),
    [m.text, m.deletedAt],
  );
  const peer = chat.type === 'direct' && chat.peer?.id === lookup ? chat.peer : null;
  const author =
    m.authorOverride?.name ||
    nickname ||
    (mine ? (myName ?? 'You') : (userName ?? (peer ? userDisplayName(peer) : 'Unknown')));
  return messageRowA11y(messageRowLabel(m, author, text, mine));
}
