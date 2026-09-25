/**
 * Realtime: message events → messages store + chat-list previews/unread counts and
 * in-app/system notifications. Owned by the foundation (agent 2 may extend; keep handlers
 * idempotent — the sender also gets its own events). Delivered receipts are server-driven.
 */
import {
  chatKindOf,
  chatTitle,
  isMuted,
  messagePreviewText,
  referencedUserIds,
  truncate,
  userDisplayName,
  type ChatSummary,
  type Message,
} from '@enbox/shared';
import { isAppFocused, playSound, showNotification } from '@/lib/notify';
import type { AppSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { nameOf, useUsers } from '@/stores/users';
import { markChatRead } from './chats';

/** Apply a new message to its chat-list entry (preview, seq, unread counters). */
function applyToChat(message: Message, chat: ChatSummary, mine: boolean, visible: boolean): void {
  const patch: Partial<ChatSummary> = {};
  if (message.seq >= chat.lastSeq) {
    patch.lastMessage = message;
    patch.lastSeq = message.seq;
    patch.lastActivityAt = message.createdAt;
  }
  if (mine) {
    patch.lastReadSeq = Math.max(chat.lastReadSeq, message.seq);
  } else if (!visible && message.seq > chat.lastReadSeq && message.type !== 'system') {
    patch.unreadCount = chat.unreadCount + 1;
    const me = useAuth.getState().user?.id;
    if (me && message.mentions.includes(me)) patch.unreadMentionCount = chat.unreadMentionCount + 1;
  }
  useChats.getState().patchChat(chat.id, patch);
}

function notifyIncoming(message: Message, chat: ChatSummary): void {
  if (message.type === 'system' || message.type === 'call') return; // calls ring via the calls UI
  if (chat.type === 'channel' || isMuted(chat.mutedUntil)) return;
  const me = useAuth.getState().user;
  if (!me) return;
  const s = me.settings;
  if (chat.type === 'direct' ? !s.messageNotifications : !s.groupNotifications) return;

  const { prefs } = useUi.getState();
  const focused = isAppFocused();
  if (focused || !prefs.desktopNotifications) {
    if (prefs.sounds) playSound('message');
    return;
  }
  const title = chatTitle(chat);
  let body = 'New message';
  if (s.notificationPreviews) {
    const preview = truncate(
      messagePreviewText(message, (id) => nameOf(id), {
        viewerId: me.id,
        chatKind: chatKindOf(chat),
      }),
      140,
    );
    const sender = message.senderId ? useUsers.getState().byId[message.senderId] : undefined;
    body = chat.type === 'group' && sender ? `${userDisplayName(sender)}: ${preview}` : preview;
  }
  void showNotification({ title, body, tag: `chat:${chat.id}`, url: `/chats/${chat.id}` }).then(
    (shown) => {
      if (!shown && prefs.sounds) playSound('message');
    },
  );
}

export function handleNewMessage(message: Message): void {
  const me = useAuth.getState().user?.id;
  const mine = !!me && message.senderId === me;
  const chats = useChats.getState();
  const visible = chats.openChatId === message.chatId && isAppFocused();

  const chat = chats.byId[message.chatId];
  if (!chat) {
    // Unknown chat (normally preceded by `chat:upsert`): fetch it, it already includes this message.
    void chats.refreshChat(message.chatId).catch(() => undefined);
  } else {
    applyToChat(message, chat, mine, visible);
  }

  useMessages.getState().upsertMessage(message);
  void useUsers
    .getState()
    .fetchUsers(referencedUserIds(message))
    .catch(() => undefined);

  if (mine) return;
  if (visible) {
    markChatRead(message.chatId);
  } else {
    const current = useChats.getState().byId[message.chatId];
    if (current) notifyIncoming(message, current);
  }
}

export function registerMessageHandlers(socket: AppSocket): void {
  socket.on('message:new', ({ message }) => handleNewMessage(message));

  socket.on('message:updated', ({ message }) => {
    useMessages.getState().upsertMessage(message, { onlyIfPresent: true });
    if (message.deletedAt) useMessages.getState().markQuotesDeleted(message.id);
    const chat = useChats.getState().byId[message.chatId];
    if (chat?.lastMessage?.id === message.id) {
      useChats.getState().patchChat(chat.id, { lastMessage: { ...chat.lastMessage, ...message } });
    }
  });

  socket.on('message:removed', ({ chatId, messageIds }) => {
    useMessages.getState().removeMessages(chatId, messageIds);
    const chat = useChats.getState().byId[chatId];
    if (chat?.lastMessage && messageIds.includes(chat.lastMessage.id)) {
      // The preview message vanished: refetch the summary for the new preview.
      void useChats
        .getState()
        .refreshChat(chatId)
        .catch(() => undefined);
    }
  });
}
