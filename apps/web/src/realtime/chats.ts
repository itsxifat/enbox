/**
 * Realtime: chat-list events, read/delivered receipts. Owned by the foundation
 * (agent 2 may extend; keep handlers idempotent).
 *
 * Exports
 * - `markChatRead(chatId, { force })` — emits `chat:read` with the chat's `lastSeq` when the
 *   app is visible+focused (or `force`), and zeroes the unread badge optimistically.
 *   ConversationPane calls it on open and whenever new messages arrive while visible;
 *   `installReadTracking()` also calls it for the open chat when the window regains focus.
 * - `ackDelivered(chats)` — `chat:delivered` for chats with messages newer than our read position.
 */
import { type ChatSummary, type ID } from '@enbox/shared';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { isAppFocused } from '@/lib/notify';
import { sendEvent, type AppSocket, type ReadyInfo } from '@/lib/socket';
import { getMyId } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';

/** chatId → highest seq we already reported as read (avoid duplicate emits). */
const reportedRead = new Map<ID, number>();

export function markChatRead(chatId: ID, opts: { force?: boolean } = {}): boolean {
  const chat = useChats.getState().byId[chatId];
  if (!chat) return false;
  if (!opts.force && !isAppFocused()) return false;
  const seq = chat.lastSeq;
  const unread = chat.unreadCount > 0 || chat.unreadMentionCount > 0 || chat.markedUnread;
  if (!unread && chat.lastReadSeq >= seq) return false;
  if (!unread && (reportedRead.get(chatId) ?? -1) >= seq) return false;

  reportedRead.set(chatId, seq);
  if (!sendEvent('chat:read', { chatId, seq })) {
    void api.post(`/api/chats/${chatId}/read`, { seq }).catch(() => undefined);
  }
  if (chat.markedUnread) {
    void api.patch(`/api/chats/${chatId}/prefs`, { markedUnread: false }).catch(() => undefined);
  }
  useChats.getState().patchChat(chatId, {
    lastReadSeq: Math.max(chat.lastReadSeq, seq),
    unreadCount: 0,
    unreadMentionCount: 0,
    markedUnread: false,
  });
  return true;
}

/** Report delivery for chats that have messages from others beyond our read position. */
export function ackDelivered(chats: ChatSummary[]): void {
  const me = getMyId();
  for (const c of chats) {
    if (c.lastSeq > c.lastReadSeq && c.lastMessage && c.lastMessage.senderId !== me) {
      sendEvent('chat:delivered', { chatId: c.id, seq: c.lastSeq });
    }
  }
}

export function registerChatHandlers(socket: AppSocket): void {
  const chats = () => useChats.getState();

  socket.on('chat:upsert', ({ chat }) => {
    chats().upsertChat(chat);
  });

  socket.on('chat:removed', ({ chatId }) => {
    chats().removeChat(chatId);
    useMessages.getState().dropChat(chatId);
    reportedRead.delete(chatId);
  });

  socket.on('chat:cleared', ({ chatId, clearedSeq }) => {
    useMessages.getState().clearChat(chatId, clearedSeq);
    const chat = chats().byId[chatId];
    if (chat && chat.lastMessage && chat.lastMessage.seq <= clearedSeq) {
      chats().patchChat(chatId, { lastMessage: null, unreadCount: 0, unreadMentionCount: 0 });
    }
  });

  socket.on('chat:read', ({ chatId, lastReadSeq, unreadCount }) => {
    const chat = chats().byId[chatId];
    if (!chat) return;
    reportedRead.set(chatId, Math.max(reportedRead.get(chatId) ?? 0, lastReadSeq));
    chats().patchChat(chatId, {
      lastReadSeq: Math.max(chat.lastReadSeq, lastReadSeq),
      unreadCount,
      unreadMentionCount: unreadCount === 0 ? 0 : chat.unreadMentionCount,
    });
  });

  socket.on('chat:watermarks', ({ chatId, readWatermark, deliveredWatermark }) => {
    chats().patchChat(chatId, { readWatermark, deliveredWatermark });
  });

  socket.on('chat:typing', ({ chatId, userId, state }) => {
    if (userId === getMyId()) return;
    chats().setTyping(chatId, userId, state);
  });

  socket.on('chat:pins', ({ chatId, messageIds }) => {
    chats().setPins(chatId, messageIds);
  });

  socket.on('chat:members-changed', ({ chatId }) => {
    bus.emit('chat:members-changed', { chatId });
  });
}

/** After (re)connect: reload the list, ack deliveries, catch up loaded conversations. */
export async function resyncChats(_info: ReadyInfo): Promise<void> {
  try {
    await useChats.getState().loadChats();
  } catch {
    return; // stays on cached list; next reconnect retries
  }
  const { byId, openChatId } = useChats.getState();
  ackDelivered(Object.values(byId));

  const messages = useMessages.getState();
  const loaded = Object.keys(messages.byChat).filter((id) => messages.byChat[id]?.loaded);
  for (const chatId of loaded) {
    if (!byId[chatId]) messages.dropChat(chatId);
  }
  // Open conversation first, then the others (sequentially, cheap `after=` queries).
  const order =
    openChatId && loaded.includes(openChatId)
      ? [openChatId, ...loaded.filter((id) => id !== openChatId)]
      : loaded;
  for (const chatId of order) {
    if (!useChats.getState().byId[chatId]) continue;
    await useMessages
      .getState()
      .catchUp(chatId)
      .catch(() => undefined);
  }
  if (openChatId) markChatRead(openChatId);
}

/**
 * Mark the open conversation read when the window regains focus or the open chat changes.
 * Returns a cleanup function.
 */
export function installReadTracking(): () => void {
  const onFocus = () => {
    const id = useChats.getState().openChatId;
    if (id) markChatRead(id);
  };
  document.addEventListener('visibilitychange', onFocus);
  window.addEventListener('focus', onFocus);
  const unsub = useChats.subscribe((s, prev) => {
    if (s.openChatId && s.openChatId !== prev.openChatId) markChatRead(s.openChatId);
  });
  return () => {
    document.removeEventListener('visibilitychange', onFocus);
    window.removeEventListener('focus', onFocus);
    unsub();
    reportedRead.clear();
  };
}
