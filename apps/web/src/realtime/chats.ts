/**
 * Realtime: chat-list events and read receipts. Owned by the foundation
 * (agent 2 may extend; keep handlers idempotent).
 *
 * Delivered receipts are server-driven (advanced when a message reaches a connected user,
 * and on every socket connect); clients never send them.
 *
 * Exports
 * - `markChatRead(chatId, { force })` — emits `chat:read` with the chat's `lastSeq` when the
 *   app is visible+focused (or `force`), and zeroes the unread badge optimistically (reading
 *   also clears `markedUnread` server-side). ConversationPane calls it on open and whenever
 *   new messages arrive while visible; `installReadTracking()` also calls it for the open
 *   chat when the window regains focus.
 */
import { type ID, type Message } from '@enbox/shared';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { isAppFocused } from '@/lib/notify';
import { sendEvent, type AppSocket, type ReadyInfo } from '@/lib/socket';
import { getMyId } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { mergeWatermarks, useChats } from '@/stores/chats';
import { useMessages, windowGeneration, windowRequestMark } from '@/stores/messages';

export { mergeWatermarks };

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
  // Relative to the summary it lands on (a chat-list reload may replay it on a newer one).
  useChats.getState().mutateChat(chatId, (c) => ({
    lastReadSeq: Math.max(c.lastReadSeq, seq),
    markedUnread: false,
    ...(seq >= c.lastSeq ? { unreadCount: 0, unreadMentionCount: 0 } : {}),
  }));
  return true;
}

/** Forget the live call of a chat I can no longer join (left, removed, chat gone). */
function dropLiveCall(chatId: ID): void {
  useCalls.getState().removeLiveCall(chatId);
}

export function registerChatHandlers(socket: AppSocket): void {
  const chats = () => useChats.getState();

  socket.on('chat:upsert', ({ chat }) => {
    chats().upsertChat(chat);
    // Former members get no call events any more: a stale "Join" banner would 403.
    if (chat.membership !== 'active') dropLiveCall(chat.id);
  });

  socket.on('chat:updated', ({ chatId, changes }) => {
    chats().applyChatUpdate(chatId, changes);
  });

  socket.on('chat:removed', ({ chatId }) => {
    chats().removeChat(chatId);
    useMessages.getState().dropChat(chatId);
    dropLiveCall(chatId);
    reportedRead.delete(chatId);
  });

  socket.on('chat:cleared', ({ chatId, clearedSeq }) => {
    useMessages.getState().clearChat(chatId, clearedSeq);
    chats().mutateChat(chatId, (c) =>
      c.lastMessage && c.lastMessage.seq <= clearedSeq
        ? { lastMessage: null, unreadCount: 0, unreadMentionCount: 0 }
        : null,
    );
  });

  socket.on(
    'chat:read',
    ({ chatId, lastReadSeq, unreadCount, unreadMentionCount, markedUnread }) => {
      reportedRead.set(chatId, Math.max(reportedRead.get(chatId) ?? 0, lastReadSeq));
      // Counts are the server's at that read position; an older read (another device, a
      // reordered event) must not overwrite a newer local read.
      chats().mutateChat(chatId, (c) =>
        lastReadSeq >= c.lastReadSeq
          ? { lastReadSeq, unreadCount, unreadMentionCount, markedUnread }
          : null,
      );
    },
  );

  socket.on('chat:watermarks', ({ chatId, readWatermark, deliveredWatermark }) => {
    chats().mutateChat(chatId, (c) => mergeWatermarks(c, { readWatermark, deliveredWatermark }));
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

/**
 * On every `ready` (the socket doesn't replay missed events): reload the chat list, discard
 * cached message pages (they may hold stale edits/deletes/reactions/votes — unsent messages
 * stay), reload the open chat's latest page + pins, forget other chats' pins (re-seeded when
 * opened), clear typing indicators and mark the open chat read. The reloads never reuse a
 * request issued before this `ready` (it may predate the room joins). Presence
 * re-subscription and `GET /api/calls/active` run in their own domain resyncs.
 */
export async function resyncChats(_info: ReadyInfo): Promise<void> {
  useChats.getState().clearTyping();
  // Window requests issued from now on are post-`ready` (fresh).
  const readyMark = windowRequestMark();
  try {
    await useChats.getState().loadChats({ fresh: true });
  } catch {
    return; // stays on cached list; next reconnect retries
  }
  const { byId, openChatId } = useChats.getState();

  const messages = useMessages.getState();
  for (const chatId of Object.keys(messages.byChat)) {
    if (chatId !== openChatId) messages.discardConfirmed(chatId);
  }
  useChats.getState().resetPins(openChatId && byId[openChatId] ? openChatId : null);
  if (openChatId && byId[openChatId]) {
    // Already (re)requested after this `ready` — the user opened it or jumped to a message:
    // that window is fresh, and reloading the latest page would undo the jump.
    const requestedSinceReady = windowGeneration(openChatId) > readyMark;
    await Promise.allSettled([
      requestedSinceReady
        ? Promise.resolve()
        : useMessages.getState().loadLatest(openChatId, { fresh: true }),
      api.get<Message[]>(`/api/chats/${openChatId}/pins`).then((pins) =>
        useChats.getState().setPins(
          openChatId,
          pins.map((m) => m.id),
        ),
      ),
    ]);
    markChatRead(openChatId);
  } else if (openChatId) {
    messages.discardConfirmed(openChatId);
  }
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
