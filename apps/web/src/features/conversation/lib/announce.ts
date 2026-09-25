/**
 * Screen-reader announcement for messages that arrive in the open conversation (the chat is
 * open and focused, so no notification or sound tells anyone about them).
 */
import {
  chatKindOf,
  messagePreviewText,
  type ChatSummary,
  type ID,
  type Message,
} from '@enbox/shared';

/** Text for the live region, or null when nothing should be announced. */
export function incomingAnnouncement(
  chat: Pick<ChatSummary, 'type' | 'isAnnouncement'>,
  incoming: Message[],
  nameOf: (id: ID) => string,
  viewerId: ID | null | undefined,
): string | null {
  const list = incoming.filter((m) => m.type !== 'system');
  const last = list[list.length - 1];
  if (!last) return null;
  const text = messagePreviewText(last, nameOf, {
    viewerId: viewerId ?? undefined,
    chatKind: chatKindOf(chat),
  });
  const from = chat.type === 'group' && last.senderId ? `${nameOf(last.senderId)}: ` : '';
  const body = `${from}${text || 'New message'}`;
  return list.length > 1 ? `${list.length} new messages. ${body}` : body;
}
