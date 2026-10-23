/**
 * Reaction pushes (UserSettings.reactionNotifications, docs "Push"): someone else reacted to a
 * message of mine — 'all': anywhere, 'dms': in direct and group chats only, 'off': never.
 * Broadcast channels never push (their reactions are anonymous). Like message pushes: not in
 * do not disturb, not from someone I ignore or blocked, not in a message request or a chat I
 * left or muted (in Spaces: the Space, the channel, a thread's channel), and not once the
 * message is out of my sight (deleted, expired, hidden or outside my window, a channel I can no
 * longer see). At most one per message every REACTION_PUSH_WINDOW_MS (this process, counted
 * when one is sent). Title as message pushes (the reactor in a DM), body "Alice reacted 👍 to
 * your message: <preview>" ("Reacted 👍 …" in a DM; no preview when previews are off), the
 * reactor's avatar; tag `reaction:<messageId>`, a click opens the message. Registered at
 * import time (push/routes.ts imports this file).
 */
import { eq, sql } from 'drizzle-orm';
import {
  PERM,
  PUSH_MESSAGE_TTL_SEC,
  hasPerm,
  isDnd,
  isMuted,
  isSpaceChatType,
  messagePreviewText,
  parseCustomEmoji,
  truncate,
  userDisplayName,
  type PushPayload,
  type SpaceChannelType,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { pushSubscriptions, type ChatRow, type MessageRow } from '../../db/schema.js';
import { chatKindOfRow } from '../../services/chats.js';
import { domainEvents, type DomainEventMap } from '../../services/events.js';
import { toMessages } from '../../services/messages.js';
import {
  channelBits,
  loadChannelOverwrites,
  loadSpaceMembers,
  loadSpacePermCtx,
} from '../../services/spaceAccess.js';
import { rawRows, uniq } from '../../services/sql.js';
import { getUserRow, settingsOf, toUserPublicMap } from '../../services/users.js';
import { silencedRecipients } from '../ignores/service.js';
import { pushMessageUrl, pushPlaceTitle } from './places.js';
import { deliverPush, getPushSender, trackPush } from './sender.js';

/** One reaction push per message within this window. */
export const REACTION_PUSH_WINDOW_MS = 10 * 60_000;
const PREVIEW_MAX = 120;

/** messageId → when its last reaction push went out (this process). */
const lastPush = new Map<string, number>();

/** Forget the pushes sent (tests). */
export function resetReactionPushes(): void {
  lastPush.clear();
}

function pushedRecently(messageId: string, now: number): boolean {
  const at = lastPush.get(messageId);
  return at !== undefined && now - at < REACTION_PUSH_WINDOW_MS;
}

const mutedNow = (v: unknown, now: Date) =>
  !!v && isMuted(new Date(v as string).toISOString(), now);

/** A DM or group: an active member, not a request, not muted, the message in their window. */
async function mayNotifyInChat(
  chat: ChatRow,
  message: MessageRow,
  userId: string,
): Promise<boolean> {
  const [row] = await rawRows<{
    left_at: unknown;
    request_state: string | null;
    muted_until: unknown;
    joined_seq: number;
    cleared_seq: number;
    hidden: boolean;
  }>(
    db,
    sql`select cm.left_at, cm.request_state, cm.muted_until, cm.joined_seq, cm.cleared_seq,
               exists (select 1 from message_hidden h
                       where h.user_id = cm.user_id and h.message_id = ${message.id}::uuid) as hidden
        from chat_members cm where cm.chat_id = ${chat.id}::uuid and cm.user_id = ${userId}::uuid`,
  );
  if (
    !row ||
    row.left_at ||
    row.request_state ||
    row.hidden ||
    mutedNow(row.muted_until, new Date())
  )
    return false;
  return Number(message.seq) > Math.max(Number(row.joined_seq), Number(row.cleared_seq));
}

/**
 * A Space channel or thread: a member who can see it (VIEW_CHANNEL), with neither the Space,
 * the channel nor a thread's parent channel muted, the message in their window.
 */
async function mayNotifyInSpace(
  chat: ChatRow,
  message: MessageRow,
  userId: string,
): Promise<boolean> {
  if (!chat.spaceId) return false;
  const [row] = await rawRows<{
    s_muted: unknown;
    c_muted: unknown;
    p_muted: unknown;
    joined_seq: number | null;
    cleared_seq: number | null;
    hidden: boolean;
  }>(
    db,
    sql`select sm.muted_until as s_muted, cm.muted_until as c_muted, pm.muted_until as p_muted,
               cm.joined_seq, cm.cleared_seq,
               exists (select 1 from message_hidden h
                       where h.user_id = sm.user_id and h.message_id = ${message.id}::uuid) as hidden
        from space_members sm
        left join chat_members cm on cm.chat_id = ${chat.id}::uuid and cm.user_id = sm.user_id
        left join chat_members pm on pm.chat_id = ${chat.parentId}::uuid and pm.user_id = sm.user_id
        where sm.space_id = ${chat.spaceId}::uuid and sm.user_id = ${userId}::uuid`,
  );
  const now = new Date();
  if (!row || row.hidden || [row.s_muted, row.c_muted, row.p_muted].some((v) => mutedNow(v, now)))
    return false;
  if (Number(message.seq) <= Math.max(Number(row.joined_seq ?? 0), Number(row.cleared_seq ?? 0)))
    return false;
  const ctx = await loadSpacePermCtx(db, chat.spaceId);
  const member = ctx ? (await loadSpaceMembers(db, chat.spaceId, [userId])).get(userId) : undefined;
  if (!ctx || !member) return false;
  const overwrites = (await loadChannelOverwrites(db, [chat.id])).get(chat.id) ?? [];
  const bits = channelBits(ctx, userId, member, chat.type as SpaceChannelType, overwrites);
  return hasPerm(bits, PERM.VIEW_CHANNEL);
}

export async function onReactionAdded({
  message,
  chat,
  userId: reactorId,
  emoji,
}: DomainEventMap['reaction.added']): Promise<void> {
  const authorId = message.senderId;
  if (!getPushSender() || !authorId || authorId === reactorId) return;
  if (chat.type === 'channel' || message.type === 'system' || message.type === 'call') return;
  if (message.deletedAt || (message.expiresAt && message.expiresAt.getTime() <= Date.now())) return;
  if (pushedRecently(message.id, Date.now())) return;
  const space = isSpaceChatType(chat.type);
  const author = await getUserRow(db, authorId);
  if (!author || author.deletedAt || isDnd(author)) return;
  const s = settingsOf(author);
  if (s.reactionNotifications === 'off' || (s.reactionNotifications === 'dms' && space)) return;
  const [subscribed] = await db
    .select({ id: pushSubscriptions.id })
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, authorId))
    .limit(1);
  if (!subscribed) return;
  // The author ignores (or blocked) the reactor.
  if ((await silencedRecipients(db, reactorId, [authorId])).has(authorId)) return;
  if (!(await (space ? mayNotifyInSpace : mayNotifyInChat)(chat, message, authorId))) return;
  // Claimed with no await since the check above: concurrent reactions send one push.
  const now = Date.now();
  if (pushedRecently(message.id, now)) return;
  for (const [id, at] of lastPush) if (now - at >= REACTION_PUSH_WINDOW_MS) lastPush.delete(id);
  lastPush.set(message.id, now);

  const [msg] = await toMessages(db, null, [message]);
  if (!msg) return;
  const users = await toUserPublicMap(db, authorId, uniq([reactorId, ...msg.mentions]));
  const nameOf = (id: string) => userDisplayName(users.get(id));
  const nickname =
    space && chat.spaceId
      ? (await loadSpaceMembers(db, chat.spaceId, [reactorId])).get(reactorId)?.member.nickname
      : null;
  const custom = parseCustomEmoji(emoji);
  const reacted = `${custom ? `:${custom.name}:` : emoji} to your message`;
  const what =
    chat.type === 'direct'
      ? `Reacted ${reacted}`
      : `${nickname || nameOf(reactorId)} reacted ${reacted}`;
  const preview = s.notificationPreviews
    ? truncate(
        messagePreviewText(msg, nameOf, { viewerId: authorId, chatKind: chatKindOfRow(chat) }),
        PREVIEW_MAX,
      )
    : '';
  const icon = users.get(reactorId)?.avatarUrl;
  const payload: PushPayload = {
    type: 'message',
    title: await pushPlaceTitle(chat, authorId),
    body: preview ? `${what}: ${preview}` : what,
    tag: `reaction:${message.id}`,
    url: pushMessageUrl(chat, msg),
    chatId: chat.id,
    ...(icon ? { icon } : {}),
  };
  await deliverPush([{ userId: authorId, payload, opts: { ttl: PUSH_MESSAGE_TTL_SEC } }]);
}

domainEvents.on('reaction.added', (e) => trackPush(onReactionAdded(e)));
