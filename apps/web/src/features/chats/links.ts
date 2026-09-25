import type { ID } from '@enbox/shared';

/**
 * Link that opens a chat scrolled to (and highlighting) a message:
 * `/chats/<chatId>?m=<seq>&mid=<messageId>`. ConversationPane consumes and removes the params.
 * Other features may use it too (e.g. media galleries → "show in chat").
 */
export function messageLink(chatId: ID, seq: number, messageId?: ID, base = '/chats'): string {
  const params = new URLSearchParams({ m: String(seq) });
  if (messageId) params.set('mid', messageId);
  return `${base}/${chatId}?${params.toString()}`;
}
