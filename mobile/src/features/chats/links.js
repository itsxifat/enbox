/**
 * Link that opens a chat scrolled to (and highlighting) a message:
 * `/chats/<chatId>?m=<seq>&mid=<messageId>`. ConversationPane consumes and removes the params.
 * Other features may use it too (e.g. media galleries → "show in chat").
 */
export function messageLink(chatId, seq, messageId, base = '/chats') {
  return `${base}/${chatId}${jumpQuery(seq, messageId)}`;
}

function jumpQuery(seq, messageId) {
  if (!seq) return '';
  const params = new URLSearchParams({ m: String(seq) });
  if (messageId) params.set('mid', messageId);
  return `?${params.toString()}`;
}

/**
 * Where a chat (optionally at a message) opens: channels in their own feed in the Updates tab
 * (`/updates/channels/<id>`, which reads `?m=`/`mid` too), everything else in the conversation
 * view under `base` (`/chats`, `/starred`, `/archived`).
 */
export function chatPath(chat, opts = {}) {
  if (chat.type === 'channel')
    return `/updates/channels/${chat.id}${jumpQuery(opts.seq, opts.messageId)}`;
  return `${opts.base ?? '/chats'}/${chat.id}${jumpQuery(opts.seq, opts.messageId)}`;
}
