/**
 * Push notifications from in-process domain events (docs "Push"). Registered at import time
 * (push/routes.ts imports this file). Each listener starts its work synchronously when the
 * event fires (after commit) and runs it in the background (`trackPush`).
 *
 * - `message.created` → `message` push to every subscription of each recipient (never the
 *   sender, regardless of socket state). Not for channels, system or call messages,
 *   withheld messages (not in `recipientIds`), or muted chats; gated by the recipient's
 *   `messageNotifications` (direct) / `groupNotifications` (groups incl. announcement).
 *   Title: direct → the sender as the recipient knows them; group → the group name with body
 *   `Sender: preview`. Preview = truncate(messagePreviewText(…, { viewerId }), 120) with
 *   mentions rendered per recipient, or "New message" when `notificationPreviews` is off.
 * - `chat.read` (unread cleared) → `dismiss` (tag chat:<chatId>) to the reader's subscriptions.
 * - `call.ringing` → `call` push (urgency high, TTL = ring timeout) unless silent or the
 *   callee's `callNotifications` is off.
 * - `call.ring-stopped` → `call_cancel` (body "Missed call" when the final status is missed)
 *   to exactly the users the `call` push went to — recorded per call in this process when it
 *   is sent (`callPushes`), so a callee who turned on DND after the push still gets the
 *   cancel that clears it and one whose DND expired mid-ring, never pushed, gets no "Missed
 *   call". Without a record (the call rang before a restart) the ring-time rules — silent,
 *   hidden, `callNotifications`, DND — are re-evaluated when the ring stops instead.
 * - Do not disturb (shared `isDnd`, docs "Users, privacy and presence"): none of the three
 *   pushes reach a recipient whose effective availability is `dnd` when the push is decided
 *   (`dismiss` is unaffected).
 */
import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  CALL_RING_TIMEOUT_MS,
  PUSH_MESSAGE_TTL_SEC,
  isDnd,
  isMuted,
  messagePreviewText,
  truncate,
  userDisplayName,
  type PushPayload,
  type UserPublic,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { callParticipants, calls, chatMembers, chats, pushSubscriptions } from '../../db/schema.js';
import { chatKindOfRow } from '../../services/chats.js';
import { domainEvents, type DomainEventMap } from '../../services/events.js';
import { loadMediaMap, staticMediaUrl } from '../../services/media.js';
import { toMessages } from '../../services/messages.js';
import { pairKey, uniq } from '../../services/sql.js';
import {
  getUserRow,
  getUserRows,
  isContactOf,
  settingsOf,
  toUserPublicMap,
  toUserPublicsForPairs,
} from '../../services/users.js';
import { deliverPush, getPushSender, trackPush, type PushEntry } from './sender.js';

const PREVIEW_MAX = 120;
const GENERIC_BODY = 'New message';

/** Users among `ids` that have at least one push subscription. */
async function subscribedUserIds(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .selectDistinct({ userId: pushSubscriptions.userId })
    .from(pushSubscriptions)
    .where(inArray(pushSubscriptions.userId, uniq(ids)));
  return rows.map((r) => r.userId);
}

/** The group's icon as every renderer shows it: static (the poster of an animated one). */
async function chatAvatarUrl(avatarMediaId: string | null): Promise<string | null> {
  if (!avatarMediaId) return null;
  const row = (await loadMediaMap(db, [avatarMediaId])).get(avatarMediaId);
  return row ? staticMediaUrl(row) : null;
}

/**
 * callId → the users its `call` push went to (see the header). An entry exists from the
 * first `call.ringing` this process handled for the call — empty when nobody was pushed —
 * until `call.ended`, or CALL_PUSH_RECORD_TTL_MS after its last ring should those events
 * never arrive.
 */
const callPushes = new Map<string, { at: number; userIds: Set<string> }>();
const CALL_PUSH_RECORD_TTL_MS = 60 * 60_000;

function recordCallPushes(callId: string, userIds: string[]): void {
  const now = Date.now();
  for (const [id, r] of callPushes) if (now - r.at > CALL_PUSH_RECORD_TTL_MS) callPushes.delete(id);
  let r = callPushes.get(callId);
  if (!r) callPushes.set(callId, (r = { at: now, userIds: new Set() }));
  r.at = now;
  for (const id of userIds) r.userIds.add(id);
}

/** Whether the `call` push went to `userId`; null without a record (the call rang before a restart). */
function tookCallPush(callId: string, userId: string): boolean | null {
  const r = callPushes.get(callId);
  return r ? r.userIds.has(userId) : null;
}

export async function onMessageCreated({
  message,
  chat,
  recipientIds,
}: DomainEventMap['message.created']): Promise<void> {
  if (
    chat.type === 'channel' ||
    message.type === 'system' ||
    message.type === 'call' ||
    !message.senderId
  )
    return;
  if (!getPushSender()) return;
  const subscribed = await subscribedUserIds(recipientIds);
  if (subscribed.length === 0) return;

  const [members, rows] = await Promise.all([
    db
      .select({ userId: chatMembers.userId, mutedUntil: chatMembers.mutedUntil })
      .from(chatMembers)
      .where(
        and(
          eq(chatMembers.chatId, chat.id),
          inArray(chatMembers.userId, subscribed),
          isNull(chatMembers.leftAt),
        ),
      ),
    getUserRows(db, subscribed),
  ]);
  const now = new Date();
  const eligible = members
    .filter((m) => {
      const row = rows.get(m.userId);
      if (!row || row.deletedAt || isMuted(m.mutedUntil?.toISOString(), now)) return false;
      if (isDnd(row, now.getTime())) return false;
      const s = settingsOf(row);
      return chat.type === 'direct' ? s.messageNotifications : s.groupNotifications;
    })
    .map((m) => m.userId);
  if (eligible.length === 0) return;

  const [msg] = await toMessages(db, null, [message]);
  if (!msg) return;
  const senderId = message.senderId;
  const refIds = uniq([senderId, ...msg.mentions]);
  const [publics, groupIcon] = await Promise.all([
    toUserPublicsForPairs(
      db,
      eligible.flatMap((viewerId) => refIds.map((subjectId) => ({ viewerId, subjectId }))),
    ),
    chat.type === 'direct' ? Promise.resolve(null) : chatAvatarUrl(chat.avatarMediaId),
  ]);
  const chatKind = chatKindOfRow(chat);

  const entries: PushEntry[] = eligible.map((viewerId) => {
    const s = settingsOf(rows.get(viewerId)!);
    const nameOf = (id: string) => userDisplayName(publics.get(pairKey(viewerId, id)));
    const sender: UserPublic | undefined = publics.get(pairKey(viewerId, senderId));
    const senderName = nameOf(senderId);
    const preview = s.notificationPreviews
      ? truncate(messagePreviewText(msg, nameOf, { viewerId, chatKind }), PREVIEW_MAX)
      : GENERIC_BODY;
    const direct = chat.type === 'direct';
    const icon = direct ? (sender?.avatarUrl ?? null) : groupIcon;
    const payload: PushPayload = {
      type: 'message',
      title: direct ? senderName : (chat.name ?? 'Group'),
      body: direct || !s.notificationPreviews ? preview : `${senderName}: ${preview}`,
      tag: `chat:${chat.id}`,
      url: `/chats/${chat.id}`,
      chatId: chat.id,
      ...(icon ? { icon } : {}),
    };
    return { userId: viewerId, payload, opts: { ttl: PUSH_MESSAGE_TTL_SEC } };
  });
  await deliverPush(entries);
}

export async function onChatRead({
  userId,
  chatId,
  clearedUnread,
}: DomainEventMap['chat.read']): Promise<void> {
  if (!clearedUnread || !getPushSender()) return;
  const [chat] = await db
    .select({ type: chats.type })
    .from(chats)
    .where(eq(chats.id, chatId))
    .limit(1);
  if (!chat || chat.type === 'channel') return; // channels never notify
  await deliverPush([
    {
      userId,
      payload: {
        type: 'dismiss',
        title: '',
        body: '',
        tag: `chat:${chatId}`,
        url: `/chats/${chatId}`,
        chatId,
      },
      opts: { ttl: PUSH_MESSAGE_TTL_SEC },
    },
  ]);
}

function callKind(callType: 'audio' | 'video'): string {
  return callType === 'video' ? 'video' : 'voice';
}

export async function onCallRinging(e: DomainEventMap['call.ringing']): Promise<void> {
  if (!getPushSender()) return;
  const silent = new Set(e.silentUserIds);
  const targets = await subscribedUserIds(
    e.userIds.filter((id) => id !== e.callerId && !silent.has(id)),
  );
  const rows = await getUserRows(db, targets);
  const eligible = targets.filter((id) => {
    const row = rows.get(id);
    return !!row && !row.deletedAt && settingsOf(row).callNotifications && !isDnd(row);
  });
  // Recorded before delivery, an empty set included: a ring stop racing the delivery must
  // find the record rather than re-evaluate the rules.
  recordCallPushes(e.callId, eligible);
  if (eligible.length === 0) return;
  const [chat] = e.isGroup
    ? await db
        .select({ name: chats.name, avatarMediaId: chats.avatarMediaId })
        .from(chats)
        .where(eq(chats.id, e.chatId))
        .limit(1)
    : [];
  const groupIcon = chat ? await chatAvatarUrl(chat.avatarMediaId) : null;
  const callers = await toUserPublicsForPairs(
    db,
    eligible.map((viewerId) => ({ viewerId, subjectId: e.callerId })),
  );
  const kind = callKind(e.callType);
  const entries: PushEntry[] = eligible.map((viewerId) => {
    const caller = callers.get(pairKey(viewerId, e.callerId));
    const callerName = userDisplayName(caller);
    const icon = e.isGroup ? groupIcon : (caller?.avatarUrl ?? null);
    return {
      userId: viewerId,
      payload: {
        type: 'call',
        title: e.isGroup ? (chat?.name ?? 'Group call') : callerName,
        body: e.isGroup ? `${callerName} · Incoming group ${kind} call` : `Incoming ${kind} call`,
        tag: `call:${e.callId}`,
        url: `/chats/${e.chatId}`,
        chatId: e.chatId,
        callId: e.callId,
        ...(icon ? { icon } : {}),
      },
      opts: { ttl: Math.round(CALL_RING_TIMEOUT_MS / 1000), urgency: 'high' },
    };
  });
  await deliverPush(entries);
}

export async function onRingStopped(e: DomainEventMap['call.ring-stopped']): Promise<void> {
  // Read before the first await: the same batch's `call.ended` listener forgets the record.
  const pushed = tookCallPush(e.callId, e.userId);
  if (!getPushSender() || pushed === false) return;
  if ((await subscribedUserIds([e.userId])).length === 0) return;
  const user = await getUserRow(db, e.userId);
  if (!user || user.deletedAt) return;
  // No record: the best guess is the ring-time rules, evaluated now.
  const guess = pushed === null;
  if (guess && (!settingsOf(user).callNotifications || isDnd(user))) return;

  const [call] = await db
    .select({ initiatorId: calls.initiatorId, isGroup: calls.isGroup, chatName: chats.name })
    .from(calls)
    .innerJoin(chats, eq(chats.id, calls.chatId))
    .where(eq(calls.id, e.callId))
    .limit(1);
  let title = '';
  if (call) {
    if (guess) {
      // Only users who were rung with a push get the cancel (hidden = callee blocked the caller; silent rings push nothing).
      const [p] = await db
        .select({ hiddenAt: callParticipants.hiddenAt })
        .from(callParticipants)
        .where(and(eq(callParticipants.callId, e.callId), eq(callParticipants.userId, e.userId)))
        .limit(1);
      if (p?.hiddenAt) return;
      if (
        settingsOf(user).silenceUnknownCallers &&
        !(await isContactOf(db, e.userId, call.initiatorId))
      )
        return;
    }
    const caller = (await toUserPublicMap(db, e.userId, [call.initiatorId])).get(call.initiatorId);
    title = call.isGroup ? (call.chatName ?? 'Group call') : userDisplayName(caller);
  }
  await deliverPush([
    {
      userId: e.userId,
      payload: {
        type: 'call_cancel',
        title,
        body: e.finalStatus === 'missed' ? 'Missed call' : '',
        tag: `call:${e.callId}`,
        url: `/chats/${e.chatId}`,
        chatId: e.chatId,
        callId: e.callId,
      },
      opts: { ttl: PUSH_MESSAGE_TTL_SEC, urgency: 'high' },
    },
  ]);
}

domainEvents.on('message.created', (e) => trackPush(onMessageCreated(e)));
domainEvents.on('chat.read', (e) => trackPush(onChatRead(e)));
domainEvents.on('call.ringing', (e) => trackPush(onCallRinging(e)));
domainEvents.on('call.ring-stopped', (e) => trackPush(onRingStopped(e)));
domainEvents.on('call.ended', (e) => void callPushes.delete(e.callId));
