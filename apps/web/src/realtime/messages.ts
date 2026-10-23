/**
 * Realtime: message events → messages store + chat-list previews/unread counts and
 * in-app/system notifications. Owned by the foundation (agent 2 may extend; keep handlers
 * idempotent — the sender also gets its own events). Delivered receipts are server-driven.
 */
import {
  isVoiceChannelType,
  chatKindOf,
  chatTitle,
  isDnd,
  isMuted,
  isSpaceChatType,
  messagePreviewText,
  referencedUserIds,
  renderMentions,
  truncate,
  userDisplayName,
  type ChatKind,
  type ChatSummary,
  type ID,
  type MediaAttachment,
  type Message,
  type ReactionEvent,
  type UserSelf,
} from '@enbox/shared';
import { chatPath } from '@/features/chats/links';
import {
  applyReactionChange,
  applyReactionsCleared,
  reactorsListed,
  superArrivalKey,
} from '@/features/conversation/bubbles/reactions/model';
import { hasPendingReaction } from '@/features/conversation/bubbles/reactions/pending';
import { speakArrivedMessage } from '@/features/tts/tts';
import { useChatMembersStore } from '@/features/conversation/members';
import { UNNAMED_GROUP_DM, groupDmMemberNames, isUnnamedGroupDm } from '@/features/groupDms/title';
import { mediaUrl } from '@/lib/api';
import { arrivalKey, markArrival } from '@/lib/arrivals';
import { isAppFocused, playSound, showNotification, type AppNotification } from '@/lib/notify';
import { registerSessionReset } from '@/lib/session';
import type { AppSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { isIgnored } from '@/stores/ignores';
import { useMessages } from '@/stores/messages';
import { useSidePanel } from '@/stores/sidePanel';
import { useUi } from '@/stores/ui';
import { nameOf, useUsers } from '@/stores/users';
import { mentionsMe, notifyLevelOf, useSpaces } from '@/stores/spaces';
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
    const mentioned = opts.me
      ? isSpaceChatType(chat.type)
        ? mentionsMe(message, chat, opts.me)
        : message.mentions.includes(opts.me)
      : false;
    if (mentioned) patch.unreadMentionCount = chat.unreadMentionCount + 1;
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
  // Channels and space channels list no reactors/voters (counts only): keep cached values.
  if (!chat || chat.type === 'channel' || isSpaceChatType(chat.type) || !me) return message;
  let out = message;
  if (message.myReactions === undefined) {
    const mine = message.reactions.filter((r) => r.userIds.includes(me)).map((r) => r.emoji);
    out = { ...out, myReactions: mine, myReaction: message.myReaction ?? mine[0] ?? null };
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

// ---------------------------------------------------------------------------
// Desktop notifications (Discord's wording)
// ---------------------------------------------------------------------------

/** What a message without text sent: "Sent an image", "Sent 3 files", "Shared a location"… */
function sentWhat(message: Message): string | null {
  const files: MediaAttachment[] = message.attachments?.length
    ? message.attachments
    : message.media
      ? [message.media]
      : [];
  if (files.length > 1) {
    const kinds = new Set(files.map((f) => f.kind));
    const only = kinds.size === 1 ? files[0]!.kind : null;
    const noun = only === 'image' ? 'images' : only === 'video' ? 'videos' : 'files';
    return `Sent ${files.length} ${noun}`;
  }
  switch (message.type) {
    case 'image':
      return message.media?.animated || message.media?.mimeType === 'image/gif'
        ? 'Sent a GIF'
        : 'Sent an image';
    case 'video':
      return 'Sent a video';
    case 'voice':
      return 'Sent a voice message';
    case 'audio':
      return 'Sent an audio file';
    case 'file':
      return 'Sent a file';
    case 'location':
      return 'Shared a location';
    case 'contact':
      return 'Shared a contact';
    default:
      return null;
  }
}

/**
 * A notification's body: the message's text with mentions resolved to names (custom emoji as
 * `:name:`), else what was sent ("Sent an image", "Sent a sticker", "Sent 3 files"). Pure.
 */
export function notificationBody(
  message: Message,
  names: { nameOf: (id: ID) => string; roleName?: (id: ID) => string },
  opts: { viewerId?: ID; chatKind?: ChatKind } = {},
): string {
  if (message.sticker) return 'Sent a sticker';
  if (message.type === 'poll' && message.poll) return `Poll: ${message.poll.question}`;
  const text = message.text
    ? renderMentions(message.text, names.nameOf, names.roleName).trim()
    : '';
  return text || sentWhat(message) || messagePreviewText(message, names.nameOf, opts);
}

export interface NotificationContext {
  viewerId: ID;
  /** Settings ▸ Notifications ▸ Show previews: else the body is "New message". */
  previews: boolean;
  /** The sender as the chat shows them (a Space nickname first). */
  senderName: string;
  senderAvatar: string | null | undefined;
  /** Space channels: the Space's name. */
  spaceName: string | null;
  /** Groups: the chat's name (an unnamed group DM: its members' names); else `chatTitle`. */
  chatName?: string;
  /** Mention names (Space nicknames first). */
  nameOf: (id: ID) => string;
  roleName?: (id: ID) => string;
}

/**
 * A message's desktop notification: "Alice (#general, Gaming)" in a Space channel or thread,
 * "Alice" in a DM, "Alice (Group name)" in a group ("Alice (Alice, Bob)" in an unnamed group
 * DM, `ctx.chatName`); the body from `notificationBody`; the sender's avatar; a click opens the
 * chat at that message. One per chat (`tag`). Pure.
 */
export function messageNotification(
  message: Message,
  chat: ChatSummary,
  ctx: NotificationContext,
): AppNotification {
  const where = isSpaceChatType(chat.type)
    ? [`${isVoiceChannelType(chat.type) ? '🔊 ' : '#'}${chat.name ?? ''}`, ctx.spaceName]
        .filter(Boolean)
        .join(', ')
    : chat.type === 'direct'
      ? null
      : ctx.chatName || chatTitle(chat);
  const opts = { viewerId: ctx.viewerId, chatKind: chatKindOf(chat) };
  const body = ctx.previews ? truncate(notificationBody(message, ctx, opts), 140) : 'New message';
  return {
    title: where ? `${ctx.senderName} (${where})` : ctx.senderName,
    body,
    icon: mediaUrl(ctx.senderAvatar),
    tag: `chat:${chat.id}`,
    url: chatPath(chat, { seq: message.seq, messageId: message.id }),
  };
}

/** Who sent it and how names read, from the caches (users, the Space's members and roles). */
function notificationContext(
  message: Message,
  chat: ChatSummary,
  me: UserSelf,
): NotificationContext {
  const spaceId = chat.space?.spaceId;
  const spaces = useSpaces.getState();
  const space = spaceId ? spaces.byId[spaceId] : undefined;
  const members = spaceId ? spaces.members[spaceId] : undefined;
  const users = useUsers.getState().byId;
  const chatMembers = useChatMembersStore.getState().byChat[chat.id];
  const senderId = message.senderId;
  const sender = senderId
    ? (users[senderId] ??
      (chat.peer?.id === senderId ? chat.peer : undefined) ??
      chatMembers?.find((m) => m.user.id === senderId)?.user)
    : undefined;
  const member = senderId ? members?.[senderId] : undefined;
  // An unnamed group DM is named after its members (features/groupDms/title.ts).
  const chatName = isUnnamedGroupDm(chat)
    ? (groupDmMemberNames(chatMembers, me.id, users) ?? UNNAMED_GROUP_DM)
    : chatTitle(chat);
  return {
    viewerId: me.id,
    previews: me.settings.notificationPreviews,
    senderName:
      member?.nickname ||
      (sender ? userDisplayName(sender) : senderId ? nameOf(senderId) : chatName),
    senderAvatar: member?.avatarUrl ?? sender?.avatarUrl ?? null,
    spaceName: space?.name ?? null,
    chatName,
    nameOf: (id) => members?.[id]?.nickname || nameOf(id, { you: me.displayName }),
    roleName: (id) => space?.roles.find((r) => r.id === id)?.name ?? 'role',
  };
}

/** How long a notification waits for an unnamed group DM's members (its title is their names). */
const GROUP_DM_MEMBERS_WAIT_MS = 1_500;

/** The thread open beside its channel is on screen too (it marks itself read). */
function inThreadPanel(chatId: ID): boolean {
  const p = useSidePanel.getState().panel;
  return p?.kind === 'thread' && p.threadId === chatId;
}

function notifyIncoming(message: Message, chat: ChatSummary): void {
  if (message.type === 'system' || message.type === 'call') return; // calls ring via the calls UI
  if (chat.type === 'channel' || isMuted(chat.mutedUntil)) return;
  // Someone I ignore: no sound, no notification (the unread badge still counts it).
  if (isIgnored(message.senderId)) return;
  const me = useAuth.getState().user;
  if (!me) return;
  if (isSpaceChatType(chat.type)) {
    // Notification level chain: channel → my Space default → the Space's default.
    const space = chat.space ? useSpaces.getState().byId[chat.space.spaceId] : undefined;
    if (space && isMuted(space.me.mutedUntil)) return;
    const level = notifyLevelOf(chat);
    if (level === 'none' || (level === 'mentions' && !mentionsMe(message, chat, me.id))) return;
  }
  const s = me.settings;
  if (chat.type === 'direct' ? !s.messageNotifications : !s.groupNotifications) return;
  // Do not disturb: no sound and no system notification (the unread badge still counts it).
  if (isDnd(me)) return;

  const { prefs } = useUi.getState();
  const focused = isAppFocused();
  // Nothing for the chat I'm looking at (the open conversation never gets here).
  if (focused && inThreadPanel(chat.id)) return;
  if (focused || !prefs.desktopNotifications) {
    if (prefs.sounds) playSound('message');
    return;
  }
  const notify = () => {
    const n = messageNotification(message, chat, notificationContext(message, chat, me));
    void showNotification(n).then((shown) => {
      if (!shown && prefs.sounds) playSound('message');
    });
  };
  // An unnamed group DM is titled with its members' names: load them first, briefly.
  const members = useChatMembersStore.getState();
  if (isUnnamedGroupDm(chat) && !members.byChat[chat.id] && chat.permissions.canViewMembers) {
    const wait = new Promise<void>((resolve) => setTimeout(resolve, GROUP_DM_MEMBERS_WAIT_MS));
    void Promise.race([members.load(chat.id), wait]).then(notify);
  } else notify();
}

export function handleNewMessage(message: Message): void {
  const me = useAuth.getState().user?.id;
  const mine = !!me && message.senderId === me;
  const chats = useChats.getState();
  const visible = chats.openChatId === message.chatId && isAppFocused();
  // A live arrival: its row may play the chat's enter animation (never on loads/resyncs).
  markArrival(arrivalKey(message));

  if (!chats.byId[message.chatId]) {
    // Unknown chat (normally preceded by `chat:upsert`): fetch it, it already includes this message.
    void chats.refreshChat(message.chatId).catch(() => undefined);
  } else {
    chats.mutateChat(message.chatId, (c) => messageChatPatch(c, message, { me, visible }));
  }

  useMessages.getState().upsertMessage(message);
  // A /tts message in the chat I'm viewing is read aloud (features/tts).
  speakArrivedMessage(message);
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

/**
 * Reaction deltas (Discord model; the message is not re-sent): merged into the cached
 * message. My own echo changes nothing — the optimistic update already applied it, and while
 * a change of mine to that emoji is in flight my echoes are skipped (reactions/pending.ts) —
 * while one from my other devices updates my reactions. Unloaded messages are ignored (they
 * arrive with their reactions). A super reaction (`burst`) is its own kind, and one added
 * live plays its burst on the chip (lib/arrivals).
 */
export function handleReactionDelta(e: ReactionEvent, add: boolean): void {
  const me = useAuth.getState().user?.id;
  const burst = !!e.burst;
  if (me && e.userId === me && hasPendingReaction(e.messageId, e.emoji, burst)) return;
  const chat = useChats.getState().byId[e.chatId];
  const listed = chat ? reactorsListed(chat) : false;
  if (add && burst) markArrival(superArrivalKey(e.messageId, e.emoji));
  useMessages
    .getState()
    .patchReactions(e.chatId, e.messageId, (m) =>
      applyReactionChange(m, { emoji: e.emoji, userId: e.userId, add, burst }, { me, listed }),
    );
}

export function handleReactionsCleared(chatId: ID, messageId: ID, emoji: string | null): void {
  const me = useAuth.getState().user?.id;
  useMessages
    .getState()
    .patchReactions(chatId, messageId, (m) => applyReactionsCleared(m, emoji, me));
}

export function registerMessageHandlers(socket: AppSocket): void {
  socket.on('message:new', ({ message }) => handleNewMessage(message));
  socket.on('message:updated', ({ message }) => handleMessageUpdated(message));
  socket.on('message:removed', ({ chatId, messageIds }) =>
    handleMessagesRemoved(chatId, messageIds),
  );
  socket.on('message:reaction-add', (e) => handleReactionDelta(e, true));
  socket.on('message:reaction-remove', (e) => handleReactionDelta(e, false));
  socket.on('message:reactions-cleared', ({ chatId, messageId, emoji }) =>
    handleReactionsCleared(chatId, messageId, emoji),
  );
}
