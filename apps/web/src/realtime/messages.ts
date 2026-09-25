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
  type ID,
  type Message,
} from '@enbox/shared';
import { isAppFocused, playSound, showNotification } from '@/lib/notify';
import { registerSessionReset } from '@/lib/session';
import type { AppSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { nameOf, useUsers } from '@/stores/users';
import { markChatRead } from './chats';

/**
 * Chat-list patch for a new message (preview, seq, unread counters). Pure (unit-tested).
 *
 * A summary whose `lastSeq` already reaches the message was built after the message existed
 * (the `chat:upsert` that precedes the first message of a new/unhidden chat, a reload that
 * landed first), so its counters already include it: only messages newer than `lastSeq`
 * count. My own message advances my read position (the server does the same).
 */
export function messageChatPatch(
  chat: ChatSummary,
  message: Message,
  opts: { me: ID | null | undefined; visible: boolean },
): Partial<ChatSummary> | null {
  const mine = !!opts.me && message.senderId === opts.me;
  const fresh = message.seq > chat.lastSeq;
  const patch: Partial<ChatSummary> = {};
  if (message.seq >= chat.lastSeq) {
    patch.lastMessage = message;
    patch.lastSeq = message.seq;
    patch.lastActivityAt = message.createdAt;
  }
  if (mine) {
    patch.lastReadSeq = Math.max(chat.lastReadSeq, message.seq);
    if (message.seq >= chat.lastSeq) {
      patch.unreadCount = 0;
      patch.unreadMentionCount = 0;
      patch.markedUnread = false;
    }
  } else if (
    fresh &&
    !opts.visible &&
    message.seq > chat.lastReadSeq &&
    message.type !== 'system'
  ) {
    patch.unreadCount = chat.unreadCount + 1;
    if (opts.me && message.mentions.includes(opts.me))
      patch.unreadMentionCount = chat.unreadMentionCount + 1;
  }
  return Object.keys(patch).length ? patch : null;
}

/**
 * `message:updated` is viewer-neutral. Outside channels `reactions[].userIds` and
 * `poll.options[].voterIds` are authoritative, so derive my reaction / votes from them —
 * otherwise a change made on another device keeps the cached (stale) values. Channels are
 * anonymous (empty id lists): keep the cached values there. Pure (unit-tested).
 */
export function withViewerFields(
  message: Message,
  chat: Pick<ChatSummary, 'type'> | undefined,
  me: ID | null | undefined,
): Message {
  if (!chat || chat.type === 'channel' || !me) return message;
  let out = message;
  if (message.myReaction === undefined) {
    const mine = message.reactions.find((r) => r.userIds.includes(me));
    out = { ...out, myReaction: mine?.emoji ?? null };
  }
  if (message.poll && message.poll.myOptionIds === undefined) {
    const myOptionIds = message.poll.options
      .filter((o) => o.voterIds.includes(me))
      .map((o) => o.id);
    out = { ...out, poll: { ...message.poll, myOptionIds } };
  }
  return out;
}

// Unread / mention counters the client can't recompute locally (edits, deletes and removals
// of unread messages): refetch the summary, debounced per chat.
const refreshTimers = new Map<ID, ReturnType<typeof setTimeout>>();

function refreshChatSoon(chatId: ID, delayMs = 400): void {
  const prev = refreshTimers.get(chatId);
  if (prev) clearTimeout(prev);
  refreshTimers.set(
    chatId,
    setTimeout(() => {
      refreshTimers.delete(chatId);
      void useChats
        .getState()
        .refreshChat(chatId)
        .catch(() => undefined);
    }, delayMs),
  );
}

registerSessionReset(() => {
  for (const t of refreshTimers.values()) clearTimeout(t);
  refreshTimers.clear();
});

function cachedMessage(chatId: ID, id: ID): Message | undefined {
  return useMessages.getState().byChat[chatId]?.items.find((m) => m.id === id);
}

function countsAsUnread(m: Message, chat: ChatSummary, me: ID | null | undefined): boolean {
  return m.senderId !== me && m.seq > chat.lastReadSeq && m.type !== 'system';
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

  if (!chats.byId[message.chatId]) {
    // Unknown chat (normally preceded by `chat:upsert`): fetch it, it already includes this message.
    void chats.refreshChat(message.chatId).catch(() => undefined);
  } else {
    chats.mutateChat(message.chatId, (c) => messageChatPatch(c, message, { me, visible }));
  }

  useMessages.getState().upsertMessage(message);
  // A message from someone ends their typing indicator right away (WhatsApp behaviour).
  if (message.senderId && !mine) chats.setTyping(message.chatId, message.senderId, 'idle');
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

export function handleMessageUpdated(incoming: Message): void {
  const me = useAuth.getState().user?.id;
  const chat = useChats.getState().byId[incoming.chatId];
  const message = withViewerFields(incoming, chat, me);

  // Did the edit / delete-for-everyone change whether an unread message mentions me?
  if (chat && me && countsAsUnread(message, chat, me) && (message.editedAt || message.deletedAt)) {
    const mentionsMe = !message.deletedAt && message.mentions.includes(me);
    const old = cachedMessage(chat.id, message.id);
    const changed = old
      ? mentionsMe !== (!old.deletedAt && old.mentions.includes(me))
      : mentionsMe !== chat.unreadMentionCount > 0;
    if (changed) refreshChatSoon(chat.id);
  }

  useMessages.getState().upsertMessage(message, { onlyIfPresent: true });
  if (message.deletedAt) useMessages.getState().markQuotesDeleted(message.id);
  useChats
    .getState()
    .mutateChat(message.chatId, (c) =>
      c.lastMessage?.id === message.id ? { lastMessage: { ...c.lastMessage, ...message } } : null,
    );
}

export function handleMessagesRemoved(chatId: ID, messageIds: ID[]): void {
  const me = useAuth.getState().user?.id;
  const chat = useChats.getState().byId[chatId];
  if (chat) {
    const previewGone = !!chat.lastMessage && messageIds.includes(chat.lastMessage.id);
    // Unknown (not loaded) messages may have been unread: let the server recount.
    const unreadGone =
      (chat.unreadCount > 0 || chat.unreadMentionCount > 0) &&
      messageIds.some((id) => {
        const m = cachedMessage(chatId, id);
        return !m || countsAsUnread(m, chat, me);
      });
    // The preview message vanished: refetch the summary for the new preview.
    if (previewGone || unreadGone) refreshChatSoon(chatId);
  }
  useMessages.getState().removeMessages(chatId, messageIds);
}

export function registerMessageHandlers(socket: AppSocket): void {
  socket.on('message:new', ({ message }) => handleNewMessage(message));
  socket.on('message:updated', ({ message }) => handleMessageUpdated(message));
  socket.on('message:removed', ({ chatId, messageIds }) =>
    handleMessagesRemoved(chatId, messageIds),
  );
}
