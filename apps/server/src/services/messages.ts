/**
 * Messages: the send transaction (`createMessage`), the batch serializer (`toMessages`),
 * history paging, visibility-checked lookups by id, and the update/delete fan-out.
 * Normative: docs/ARCHITECTURE.md "Messages", "Visibility, receipts and counts".
 */
import { randomUUID } from 'node:crypto';
import { and, asc, desc, eq, gt, inArray, isNull, lt, lte, notInArray, sql, type SQL } from 'drizzle-orm';
import {
  MAX_MENTIONS,
  extractMentionIds,
  referencedUserIds,
  type ChatType,
  type ContactCardPayload,
  type Message,
  type MessagePage,
  type MessagePreview,
  type MessageType,
  type Poll,
  type ReactionSummary,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../db/index.js';
import {
  blocks,
  chatMembers,
  chatPins,
  chats,
  messageHidden,
  messageReactions,
  messages,
  pollVotes,
  starredMessages,
  type ChatMemberRow,
  type ChatRow,
  type MediaRow,
  type MessageRow,
} from '../db/schema.js';
import type { MessageMetadata, PollDefinition } from '../db/types.js';
import { badRequest, notFound } from '../lib/errors.js';
import { emitToChat, emitToUser } from '../realtime/emit.js';
import { activeMemberIds, getChatAccess, lockChat, visibleTo, windowOf, type VisibilityWindow } from './chats.js';
import type { Effects } from './effects.js';
import { loadMediaMap, toMediaAttachment } from './media.js';
import { rawRows, uniq, uuidArray } from './sql.js';
import { loadStatusesForReplies, toStatusReplyPayload } from './statuses.js';
import { blockersOf, getUserRow, toUserPublic, toUserPublics } from './users.js';
import { bumpMarks, markDeliveredForOnlineRecipients, type Marks } from './watermarks.js';

// ---------------------------------------------------------------------------
// Mentions
// ---------------------------------------------------------------------------

/**
 * `Message.mentions` for a text (send AND edit): `@{uuid}` tokens ∩ active members, sender
 * excluded, ≤ MAX_MENTIONS distinct, in order of appearance. Tokens of non-members stay
 * plain text. Pass `activeIds` when already loaded.
 */
export async function deriveMentions(
  dbx: DbOrTx,
  chatId: string,
  senderId: string | null,
  text: string | null | undefined,
  activeIds?: readonly string[],
): Promise<string[]> {
  const ids = extractMentionIds(text, Number.MAX_SAFE_INTEGER).filter((id) => id !== senderId);
  if (ids.length === 0) return [];
  let members: Set<string>;
  if (activeIds) {
    members = new Set(activeIds);
  } else {
    const rows = await dbx
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), isNull(chatMembers.leftAt), inArray(chatMembers.userId, ids)));
    members = new Set(rows.map((r) => r.userId));
  }
  return ids.filter((id) => members.has(id)).slice(0, MAX_MENTIONS);
}

// ---------------------------------------------------------------------------
// Send
// ---------------------------------------------------------------------------

export interface CreateMessageInput {
  chatId: string;
  /** null only for system messages (call messages: the initiator). */
  senderId: string | null;
  type: MessageType;
  /** Idempotency key (null for server-generated messages; forwards: `<clientId>:<index>`). */
  clientId?: string | null;
  /** Text or caption (mention tokens inside). */
  text?: string | null;
  mediaId?: string | null;
  metadata?: MessageMetadata;
  replyToId?: string | null;
  forwardCount?: number;
  /**
   * Users still in the chat room who must not receive `message:new` (e.g. the member who
   * left earlier in this same transaction and is removed from the room after it).
   */
  exceptUserIds?: string[];
  /**
   * The user whose action created a system message (`senderId` null). Direct chats: a peer
   * who blocked the actor gets the message withheld exactly like a send by the actor (docs
   * "Blocking": never emitted, never unhides their chat, never counts as delivered/read).
   */
  actorId?: string | null;
}

export interface CreateMessageResult {
  message: MessageRow;
  /** false = idempotent retry (same clientId): nothing written, nothing emitted (HTTP 200 vs 201). */
  created: boolean;
  /** The locked chat row after allocation (current `last_seq`). */
  chat: ChatRow;
}

export interface InsertedMessage extends CreateMessageResult {
  /** Register this message's post-commit fan-out into `fx` (no-op for idempotent retries). */
  publish(fx: Effects): void;
}

/**
 * The send transaction WITHOUT registering its fan-out (see `createMessage`). Use it when
 * other steps must precede the message's events, e.g. membership changes register
 * JOIN(u) for new members before the `members_added` message:new.
 *
 * Steps (docs "Send"): (1) lock the chat; (2) same (chat, sender, clientId) exists → return
 * it (no seq burned, no events); (3) `last_seq + 1`, `last_message_at`; (4) insert with
 * expires_at from the chat's timer (never for system/call), mentions ∩ active members;
 * withheld rows for direct-chat recipients who blocked the sender; unhide active hidden
 * members who can see it; sender read+delivered → seq (+ clear marked_unread); delivered →
 * seq for online recipients. Direct chats: `withheld` is derived from the sender, or from
 * `actorId` for system messages.
 */
export async function insertMessage(tx: Tx, input: CreateMessageInput): Promise<InsertedMessage> {
  const locked = await lockChat(tx, input.chatId);

  if (input.clientId && input.senderId) {
    const [existing] = await tx
      .select()
      .from(messages)
      .where(and(eq(messages.chatId, input.chatId), eq(messages.senderId, input.senderId), eq(messages.clientId, input.clientId)))
      .limit(1);
    if (existing) return { message: existing, created: false, chat: locked, publish: () => {} };
  }

  const createdAt = new Date();
  const [chat] = await tx
    .update(chats)
    .set({ lastSeq: sql`${chats.lastSeq} + 1`, lastMessageAt: createdAt })
    .where(eq(chats.id, input.chatId))
    .returning();
  const seq = Number(chat!.lastSeq);
  const isChannel = chat!.type === 'channel';
  const serverMessage = input.type === 'system' || input.type === 'call';
  const expiresAt = !serverMessage && chat!.disappearingSeconds ? new Date(createdAt.getTime() + chat!.disappearingSeconds * 1000) : null;

  // Channels: no per-follower work (no delivered receipts, no unhide, no pushes).
  const memberIds = isChannel ? [] : await activeMemberIds(tx, input.chatId);
  // Direct chats: recipients who blocked the sender — or, for system messages, the acting
  // user (timer changes, pins) — never see it (docs "Blocking").
  const actorId = input.senderId ?? input.actorId ?? null;
  const withheld = chat!.type === 'direct' && actorId ? [...(await blockersOf(tx, actorId, memberIds))] : [];
  const mentions = serverMessage
    ? []
    : await deriveMentions(tx, input.chatId, input.senderId, input.text, isChannel ? undefined : memberIds);

  const [message] = await tx
    .insert(messages)
    .values({
      chatId: input.chatId,
      seq,
      senderId: input.senderId,
      clientId: input.clientId ?? null,
      type: input.type,
      text: input.text ?? null,
      mediaId: input.mediaId ?? null,
      metadata: input.metadata ?? {},
      replyToId: input.replyToId ?? null,
      forwardCount: input.forwardCount ?? 0,
      mentions,
      expiresAt,
      createdAt,
    })
    .returning();

  if (withheld.length) {
    await tx.insert(messageHidden).values(withheld.map((userId) => ({ userId, messageId: message!.id })));
  }

  // Rule 2: a new visible message unhides the chat for active members who had hidden it.
  const unhidden = isChannel
    ? []
    : (
        await tx
          .update(chatMembers)
          .set({ hidden: false })
          .where(
            and(
              eq(chatMembers.chatId, input.chatId),
              eq(chatMembers.hidden, true),
              isNull(chatMembers.leftAt),
              withheld.length ? notInArray(chatMembers.userId, withheld) : undefined,
            ),
          )
          .returning({ userId: chatMembers.userId })
      ).map((r) => r.userId);

  const changedMarks: { userId: string; prev: Marks }[] = [];
  if (input.senderId) {
    const rows = await bumpMarks(tx, input.chatId, [input.senderId], { read: seq, delivered: seq, clearMarkedUnread: true });
    changedMarks.push(...rows.map((r) => ({ userId: r.userId, prev: r.prev })));
  }
  const recipientIds = memberIds.filter((id) => id !== input.senderId && !withheld.includes(id));
  if (!isChannel) changedMarks.push(...(await markDeliveredForOnlineRecipients(tx, { chatId: input.chatId, seq, recipientIds })));

  const row = message!;
  const chatRow = chat!;
  const prevLastSeq = Number(locked.lastSeq);
  return {
    message: row,
    created: true,
    chat: chatRow,
    publish(fx: Effects) {
      for (const userId of unhidden) fx.join(userId, input.chatId);
      fx.messageNew(row, { exceptUserIds: [...withheld, ...(input.exceptUserIds ?? [])] });
      if (input.senderId) fx.chatRead(input.senderId, input.chatId);
      // Withheld recipients learn nothing: not even the tick change the hidden seq causes.
      if (!isChannel) fx.watermarks({ chatId: input.chatId, prevLastSeq, members: changedMarks, skipUserIds: withheld });
      fx.domain('message.created', { message: row, chat: chatRow, recipientIds, withheldUserIds: withheld });
    },
  };
}

/**
 * `createMessage(tx, fx, input)`: the idempotent send transaction (see `insertMessage`) +
 * its fan-out, registered in matrix order: for each member unhidden by it JOIN(u)
 * (room join + chat:upsert); `message:new` → room except withheld recipients; `chat:read` →
 * sender; `chat:watermarks` → members whose ticks changed; domain `message.created` (push).
 * Permission checks (canSend, media ownership, reply targets…) are the caller's.
 */
export async function createMessage(tx: Tx, fx: Effects, input: CreateMessageInput): Promise<CreateMessageResult> {
  const r = await insertMessage(tx, input);
  r.publish(fx);
  return { message: r.message, created: r.created, chat: r.chat };
}

/** Poll definition with fresh stable option ids (forwards also get fresh ids, no votes). */
export function buildPollDefinition(input: { question: string; options: string[]; allowMultiple?: boolean }): PollDefinition {
  return {
    question: input.question,
    options: input.options.map((text) => ({ id: randomUUID().slice(0, 8), text })),
    allowMultiple: input.allowMultiple ?? false,
  };
}

/**
 * Contact card for a send (docs "Send"): with `userId` the server fills name/username and the
 * phone the SENDER may see (UserPublic.phone); unknown/deleted users → 400. Without `userId`:
 * plain data, never linked to an account.
 */
export async function buildContactCard(
  dbx: DbOrTx,
  senderId: string,
  input: { userId?: string | null; name?: string; username?: string | null; phone?: string | null },
): Promise<ContactCardPayload> {
  if (input.userId) {
    const row = await getUserRow(dbx, input.userId);
    if (!row || row.deletedAt) throw badRequest('Unknown contact');
    const pub = await toUserPublic(dbx, senderId, input.userId);
    return { userId: row.id, name: row.displayName, username: row.username, phone: pub?.phone ?? null };
  }
  if (!input.name) throw badRequest('Contact cards need a name');
  return { userId: null, name: input.name, username: input.username ?? null, phone: input.phone ?? null };
}

// ---------------------------------------------------------------------------
// Visibility-checked lookups
// ---------------------------------------------------------------------------

export interface VisibleMessage {
  message: MessageRow;
  chat: ChatRow;
  member: ChatMemberRow;
  window: VisibilityWindow;
}

/**
 * `loadVisibleMessage(dbx, viewerId, messageId, { chatId? })` (docs): the message if it is
 * visible to the viewer (membership window, hidden rows, expiry) and in `chatId` when given;
 * else 404. `lock: true` locks the MESSAGE row `FOR UPDATE` (poll votes). Mutations must
 * additionally check active membership / rights (`getChatAccess` + shared helpers).
 */
export async function loadVisibleMessage(
  dbx: DbOrTx,
  viewerId: string,
  messageId: string,
  opts: { chatId?: string; lock?: boolean } = {},
): Promise<VisibleMessage> {
  let q = dbx
    .select({ message: messages, member: chatMembers, chat: chats })
    .from(messages)
    .innerJoin(chatMembers, and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, viewerId)))
    .innerJoin(chats, eq(chats.id, messages.chatId))
    .where(
      and(
        eq(messages.id, messageId),
        opts.chatId ? eq(messages.chatId, opts.chatId) : undefined,
        sql`${messages.seq} > greatest(${chatMembers.joinedSeq}, ${chatMembers.clearedSeq})`,
        sql`(${chatMembers.leftSeq} is null or ${messages.seq} <= ${chatMembers.leftSeq})`,
        sql`(${messages.expiresAt} is null or ${messages.expiresAt} > now())`,
        sql`not exists (select 1 from ${messageHidden} where ${messageHidden.userId} = ${viewerId} and ${messageHidden.messageId} = ${messages.id})`,
      ),
    )
    .limit(1)
    .$dynamic();
  if (opts.lock) q = q.for('update', { of: messages });
  const [row] = await q;
  if (!row) throw notFound('Message');
  return { message: row.message, chat: row.chat, member: row.member, window: windowOf(row.member) };
}

/**
 * Validate `replyToId` for a send by `senderId` into `chat` (docs "Replies"): a message
 * visible to the sender in the same chat, or — reply privately — in a direct chat with P,
 * P's message in a group where both are active members. System, call and deleted messages
 * can't be quoted (400). Otherwise 404.
 */
export async function resolveReplyTarget(dbx: DbOrTx, senderId: string, chat: Pick<ChatRow, 'id' | 'type'>, replyToId: string): Promise<MessageRow> {
  const quotable = (m: MessageRow) => {
    if (m.type === 'system' || m.type === 'call' || m.deletedAt) throw badRequest('This message cannot be replied to');
    return m;
  };
  const same = await loadVisibleMessage(dbx, senderId, replyToId, { chatId: chat.id }).catch(() => null);
  if (same) return quotable(same.message);
  if (chat.type === 'direct') {
    const [peer] = await dbx
      .select({ userId: chatMembers.userId })
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chat.id), sql`${chatMembers.userId} <> ${senderId}`))
      .limit(1);
    const other = await loadVisibleMessage(dbx, senderId, replyToId).catch(() => null);
    if (peer && other && other.chat.type === 'group' && other.message.senderId === peer.userId && !other.member.leftAt) {
      const [peerMember] = await dbx
        .select({ leftAt: chatMembers.leftAt })
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, other.chat.id), eq(chatMembers.userId, peer.userId)))
        .limit(1);
      if (peerMember && !peerMember.leftAt) return quotable(other.message);
    }
  }
  throw notFound('Message');
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

export interface ToMessagesOptions {
  /** Chat types by chat id when already known (saves a query). */
  chatTypes?: Map<string, ChatType>;
  /** The rows were just created: no reactions/votes/stars can exist (skips those queries). */
  fresh?: boolean;
}

const PREVIEW_MAX_CHARS = 200;

/** Quote text truncated to ~200 chars without splitting a mention token (tokens are kept). */
export function previewText(text: string | null | undefined): string | null {
  if (!text) return null;
  const chars = Array.from(text);
  if (chars.length <= PREVIEW_MAX_CHARS) return text;
  let cut = chars.slice(0, PREVIEW_MAX_CHARS - 1).join('');
  const open = cut.lastIndexOf('@{');
  if (open !== -1 && cut.indexOf('}', open) === -1) cut = cut.slice(0, open);
  return `${cut.trimEnd()}…`;
}

function toPreview(row: MessageRow | undefined, chatType: ChatType | undefined, mediaRows: Map<string, MediaRow>, now: number): MessagePreview | null {
  if (!row) return null; // purged
  if (row.expiresAt && row.expiresAt.getTime() <= now) return null; // expired
  const deleted = !!row.deletedAt;
  const m = !deleted && row.mediaId ? mediaRows.get(row.mediaId) : undefined;
  return {
    id: row.id,
    chatId: row.chatId,
    seq: Number(row.seq),
    senderId: chatType === 'channel' ? null : row.senderId,
    type: row.type,
    text: deleted ? null : previewText(row.text),
    media: m
      ? (({ id, kind, url, thumbnailUrl, mimeType, fileName, durationMs }) => ({ id, kind, url, thumbnailUrl, mimeType, fileName, durationMs }))(toMediaAttachment(m))
      : null,
    deleted,
  };
}

/**
 * `toMessages(dbx, viewerId, rows)` (docs): batch serializer, output in input order, a fixed
 * number of queries per call. Viewer-neutral when `viewerId` is null (socket broadcasts:
 * no `starred`/`myReaction`/`poll.myOptionIds` keys). Channels: `senderId` null, reaction
 * `userIds` and poll `voterIds` always []. Direct chats, viewer-specific only: reactions and votes
 * of users the viewer blocked are left out. Deleted-for-everyone rows become tombstones.
 * `replyTo` is computed from the live row (null when purged/expired, `deleted: true` when
 * deleted); `statusReply` resolves to `available: false` once the status is gone.
 */
export async function toMessages(dbx: DbOrTx, viewerId: string | null, rows: MessageRow[], opts: ToMessagesOptions = {}): Promise<Message[]> {
  if (rows.length === 0) return [];
  const now = Date.now();
  const ids = uniq(rows.map((r) => r.id));
  const live = rows.filter((r) => !r.deletedAt);

  const replyIds = uniq(live.map((r) => r.replyToId).filter((x): x is string => !!x));
  const replyRows = replyIds.length ? await dbx.select().from(messages).where(inArray(messages.id, replyIds)) : [];
  const replyById = new Map(replyRows.map((r) => [r.id, r]));

  const chatTypes = new Map(opts.chatTypes ?? []);
  const missingChats = uniq([...rows.map((r) => r.chatId), ...replyRows.map((r) => r.chatId)]).filter((id) => !chatTypes.has(id));
  if (missingChats.length) {
    for (const c of await dbx.select({ id: chats.id, type: chats.type }).from(chats).where(inArray(chats.id, missingChats))) chatTypes.set(c.id, c.type);
  }
  const isChannel = (chatId: string) => chatTypes.get(chatId) === 'channel';
  const chatOf = new Map(rows.map((r) => [r.id, r.chatId]));

  const mediaRows = await loadMediaMap(dbx, [...live.map((r) => r.mediaId), ...replyRows.map((r) => (r.deletedAt ? null : r.mediaId))]);
  const statusIds = live.map((r) => r.metadata?.statusReply?.statusId).filter((x): x is string => !!x);
  const statusMap = statusIds.length ? await loadStatusesForReplies(dbx, statusIds) : new Map();

  // Reactions & polls (skipped for fresh rows).
  const reactionGroups = new Map<string, { emoji: string; count: number; first: number; userIds: string[] }[]>();
  const myReaction = new Map<string, string>();
  const optionCounts = new Map<string, Map<string, number>>();
  const optionVoters = new Map<string, Map<string, string[]>>();
  const totalVoters = new Map<string, number>();
  const myVotes = new Map<string, string[]>();
  const starred = new Set<string>();
  const reactable = live.filter((r) => r.type !== 'system').map((r) => r.id);
  const pollIds = live.filter((r) => r.type === 'poll' && r.metadata?.poll).map((r) => r.id);

  if (!opts.fresh && reactable.length) {
    const groups = await rawRows<{ message_id: string; emoji: string; n: number; first: string }>(
      dbx,
      sql`select message_id, emoji, count(*)::int as n, min(created_at) as first
          from message_reactions where message_id = any(${uuidArray(reactable)}) group by message_id, emoji`,
    );
    for (const g of groups) {
      const list = reactionGroups.get(g.message_id) ?? [];
      list.push({ emoji: g.emoji, count: Number(g.n), first: new Date(g.first).getTime(), userIds: [] });
      reactionGroups.set(g.message_id, list);
    }
    const named = reactable.filter((id) => !isChannel(chatOf.get(id)!) && reactionGroups.has(id));
    if (named.length) {
      const rs = await dbx
        .select({ messageId: messageReactions.messageId, emoji: messageReactions.emoji, userId: messageReactions.userId })
        .from(messageReactions)
        .where(inArray(messageReactions.messageId, named))
        .orderBy(asc(messageReactions.createdAt), asc(messageReactions.userId));
      for (const r of rs) reactionGroups.get(r.messageId)?.find((g) => g.emoji === r.emoji)?.userIds.push(r.userId);
    }
    if (viewerId) {
      const mine = await dbx
        .select({ messageId: messageReactions.messageId, emoji: messageReactions.emoji })
        .from(messageReactions)
        .where(and(eq(messageReactions.userId, viewerId), inArray(messageReactions.messageId, reactable)));
      for (const r of mine) myReaction.set(r.messageId, r.emoji);
    }
  }

  if (!opts.fresh && pollIds.length) {
    const counts = await rawRows<{ message_id: string; option_id: string; n: number }>(
      dbx,
      sql`select message_id, option_id, count(*)::int as n from poll_votes where message_id = any(${uuidArray(pollIds)}) group by message_id, option_id`,
    );
    for (const c of counts) {
      const m = optionCounts.get(c.message_id) ?? new Map<string, number>();
      m.set(c.option_id, Number(c.n));
      optionCounts.set(c.message_id, m);
    }
    const totals = await rawRows<{ message_id: string; n: number }>(
      dbx,
      sql`select message_id, count(distinct user_id)::int as n from poll_votes where message_id = any(${uuidArray(pollIds)}) group by message_id`,
    );
    for (const t of totals) totalVoters.set(t.message_id, Number(t.n));
    const named = pollIds.filter((id) => !isChannel(chatOf.get(id)!) && optionCounts.has(id));
    if (named.length) {
      const vs = await dbx
        .select({ messageId: pollVotes.messageId, optionId: pollVotes.optionId, userId: pollVotes.userId })
        .from(pollVotes)
        .where(inArray(pollVotes.messageId, named))
        .orderBy(asc(pollVotes.createdAt), asc(pollVotes.userId));
      for (const v of vs) {
        const m = optionVoters.get(v.messageId) ?? new Map<string, string[]>();
        m.set(v.optionId, [...(m.get(v.optionId) ?? []), v.userId]);
        optionVoters.set(v.messageId, m);
      }
    }
    if (viewerId) {
      const mine = await dbx
        .select({ messageId: pollVotes.messageId, optionId: pollVotes.optionId })
        .from(pollVotes)
        .where(and(eq(pollVotes.userId, viewerId), inArray(pollVotes.messageId, pollIds)));
      for (const v of mine) myVotes.set(v.messageId, [...(myVotes.get(v.messageId) ?? []), v.optionId]);
    }
  }

  // Direct chats (viewer-specific responses only): reactions and poll votes of users the
  // viewer blocked are left out (docs "Blocking"); room broadcasts stay viewer-neutral.
  let blockedByViewer = new Set<string>();
  const isDirect = (chatId: string) => chatTypes.get(chatId) === 'direct';
  if (viewerId && (reactable.some((id) => isDirect(chatOf.get(id)!) && reactionGroups.has(id)) || pollIds.some((id) => isDirect(chatOf.get(id)!) && optionCounts.has(id)))) {
    const rows = await dbx.select({ id: blocks.blockedId }).from(blocks).where(eq(blocks.blockerId, viewerId));
    blockedByViewer = new Set(rows.map((r) => r.id));
  }

  if (!opts.fresh && viewerId) {
    const stars = await dbx
      .select({ messageId: starredMessages.messageId })
      .from(starredMessages)
      .where(and(eq(starredMessages.userId, viewerId), inArray(starredMessages.messageId, ids)));
    for (const s of stars) starred.add(s.messageId);
  }

  return rows.map((row) => {
    const channel = isChannel(row.chatId);
    const deleted = !!row.deletedAt;
    const md: MessageMetadata = deleted ? {} : (row.metadata ?? {});
    const mediaRow = !deleted && row.mediaId ? mediaRows.get(row.mediaId) : undefined;
    const filterBlocked = blockedByViewer.size > 0 && isDirect(row.chatId);

    let poll: Poll | null = null;
    if (md.poll) {
      const counts = optionCounts.get(row.id);
      const voters = optionVoters.get(row.id);
      const shown = (optionId: string) => (voters?.get(optionId) ?? []).filter((u) => !blockedByViewer.has(u));
      poll = {
        question: md.poll.question,
        options: md.poll.options.map((o) => ({
          id: o.id,
          text: o.text,
          voteCount: filterBlocked ? shown(o.id).length : (counts?.get(o.id) ?? 0),
          voterIds: channel ? [] : filterBlocked ? shown(o.id) : (voters?.get(o.id) ?? []),
        })),
        allowMultiple: md.poll.allowMultiple,
        totalVoters: filterBlocked ? new Set(md.poll.options.flatMap((o) => shown(o.id))).size : (totalVoters.get(row.id) ?? 0),
      };
      if (viewerId) {
        // Report my votes in option order (deterministic for clients and tests).
        const mine = new Set(myVotes.get(row.id) ?? []);
        poll.myOptionIds = md.poll.options.filter((o) => mine.has(o.id)).map((o) => o.id);
      }
    }

    const groups = (reactionGroups.get(row.id) ?? []).map((g) =>
      filterBlocked ? { ...g, userIds: g.userIds.filter((u) => !blockedByViewer.has(u)) } : g,
    );
    const reactions: ReactionSummary[] = deleted
      ? []
      : groups
          .map((g) => (filterBlocked ? { ...g, count: g.userIds.length } : g))
          .filter((g) => g.count > 0)
          .sort((a, b) => b.count - a.count || a.first - b.first)
          .map((g) => ({ emoji: g.emoji, count: g.count, userIds: channel ? [] : g.userIds }));

    const replyTarget = !deleted && row.replyToId ? replyById.get(row.replyToId) : undefined;
    const message: Message = {
      id: row.id,
      chatId: row.chatId,
      seq: Number(row.seq),
      clientId: row.clientId,
      senderId: channel ? null : row.senderId,
      type: row.type,
      text: deleted ? null : row.text,
      media: mediaRow ? toMediaAttachment(mediaRow) : null,
      location: md.location ?? null,
      contact: md.contact ?? null,
      poll,
      system: md.system ?? null,
      call: md.call ?? null,
      statusReply: md.statusReply ? toStatusReplyPayload(md.statusReply, statusMap.get(md.statusReply.statusId), now) : null,
      replyTo: replyTarget ? toPreview(replyTarget, chatTypes.get(replyTarget.chatId), mediaRows, now) : null,
      forwardCount: row.forwardCount,
      mentions: deleted ? [] : (row.mentions ?? []),
      reactions,
      editedAt: row.editedAt?.toISOString() ?? null,
      deletedAt: row.deletedAt?.toISOString() ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
    if (viewerId) {
      message.starred = starred.has(row.id);
      message.myReaction = myReaction.get(row.id) ?? null;
    }
    return message;
  });
}

/** Load rows by id and serialize (input order, missing ids omitted). */
export async function loadMessages(dbx: DbOrTx, viewerId: string | null, ids: string[]): Promise<Message[]> {
  if (ids.length === 0) return [];
  const rows = await dbx.select().from(messages).where(inArray(messages.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r]));
  return toMessages(
    dbx,
    viewerId,
    ids.map((id) => byId.get(id)).filter((r): r is MessageRow => !!r),
  );
}

// ---------------------------------------------------------------------------
// History paging
// ---------------------------------------------------------------------------

/** Output of `listMessagesQuerySchema` (at most one cursor; exclusive seqs). */
export interface PageQuery {
  before?: number;
  after?: number;
  around?: number;
  limit: number;
}

/**
 * `GET /chats/:c/messages` (docs "History paging"): ascending page of VISIBLE messages with
 * hasMoreBefore/hasMoreAfter and the referenced users side-loaded (viewer-specific).
 * By default the viewer's membership window is used (404 without a non-hidden row; former
 * members read up to left_seq). Pass `window` for special viewers (public channel previews:
 * PUBLIC_WINDOW).
 */
export async function loadMessagePage(
  dbx: DbOrTx,
  viewerId: string,
  chatId: string,
  query: PageQuery,
  opts: { window?: VisibilityWindow; chatType?: ChatType } = {},
): Promise<MessagePage> {
  let window = opts.window;
  let chatType = opts.chatType;
  if (!window) {
    const access = await getChatAccess(dbx, viewerId, chatId);
    window = access.window;
    chatType = access.chat.type;
  }
  const base = and(eq(messages.chatId, chatId), visibleTo(window));
  const limit = Math.max(1, query.limit);
  const pick = (cond: SQL | undefined, dir: 'asc' | 'desc', n: number) =>
    dbx
      .select()
      .from(messages)
      .where(and(base, cond))
      .orderBy(dir === 'asc' ? asc(messages.seq) : desc(messages.seq))
      .limit(n);
  const exists = async (cond: SQL) => (await dbx.select({ x: sql<number>`1` }).from(messages).where(and(base, cond)).limit(1)).length > 0;

  let page: MessageRow[];
  let hasMoreBefore: boolean;
  let hasMoreAfter: boolean;
  if (query.around !== undefined) {
    const k = Math.ceil(limit / 2);
    const down = await pick(lte(messages.seq, query.around), 'desc', k + 1);
    const up = await pick(gt(messages.seq, query.around), 'asc', limit - k + 1);
    hasMoreBefore = down.length > k;
    hasMoreAfter = up.length > limit - k;
    page = [...down.slice(0, k).reverse(), ...up.slice(0, limit - k)];
  } else if (query.after !== undefined) {
    const up = await pick(gt(messages.seq, query.after), 'asc', limit + 1);
    hasMoreAfter = up.length > limit;
    page = up.slice(0, limit);
    hasMoreBefore = await exists(lt(messages.seq, page[0] ? Number(page[0].seq) : query.after + 1));
  } else if (query.before !== undefined) {
    const down = await pick(lt(messages.seq, query.before), 'desc', limit + 1);
    hasMoreBefore = down.length > limit;
    page = down.slice(0, limit).reverse();
    const last = page.at(-1);
    hasMoreAfter = await exists(gt(messages.seq, last ? Number(last.seq) : query.before - 1));
  } else {
    const down = await pick(undefined, 'desc', limit + 1);
    hasMoreBefore = down.length > limit;
    hasMoreAfter = false;
    page = down.slice(0, limit).reverse();
  }

  const serialized = await toMessages(dbx, viewerId, page, chatType ? { chatTypes: new Map([[chatId, chatType]]) } : {});
  const userIds = uniq(serialized.flatMap((m) => referencedUserIds(m)));
  const users = await toUserPublics(dbx, viewerId, userIds);
  return { messages: serialized, hasMoreBefore, hasMoreAfter, users };
}

// ---------------------------------------------------------------------------
// Pins
// ---------------------------------------------------------------------------

/** Pinned message ids of a chat, oldest pin first (`chat:pins` payload). */
export async function pinnedMessageIds(dbx: DbOrTx, chatId: string): Promise<string[]> {
  const rows = await dbx
    .select({ messageId: chatPins.messageId })
    .from(chatPins)
    .where(eq(chatPins.chatId, chatId))
    .orderBy(asc(chatPins.createdAt), asc(chatPins.messageId));
  return rows.map((r) => r.messageId);
}

// ---------------------------------------------------------------------------
// Update / remove fan-out
// ---------------------------------------------------------------------------

/**
 * Viewer-neutral `message:updated` payloads + the active members who must NOT receive them
 * (`joined_seq >= seq`, `cleared_seq >= seq`, or a message_hidden row; channels: nobody).
 * Missing or expired messages are skipped.
 */
export async function messageUpdatedPayloads(
  dbx: DbOrTx,
  messageIds: string[],
): Promise<Map<string, { chatId: string; message: Message; exceptUserIds: string[] }>> {
  const out = new Map<string, { chatId: string; message: Message; exceptUserIds: string[] }>();
  const ids = uniq(messageIds);
  if (ids.length === 0) return out;
  const rows = (await dbx.select().from(messages).where(inArray(messages.id, ids))).filter(
    (r) => !r.expiresAt || r.expiresAt.getTime() > Date.now(),
  );
  if (rows.length === 0) return out;
  const serialized = await toMessages(dbx, null, rows);
  const except = await rawRows<{ message_id: string; user_id: string }>(
    dbx,
    sql`select m.id as message_id, cm.user_id
        from messages m
        join chats c on c.id = m.chat_id and c.type <> 'channel'
        join chat_members cm on cm.chat_id = m.chat_id and cm.left_at is null
        where m.id = any(${uuidArray(rows.map((r) => r.id))})
          and (cm.joined_seq >= m.seq or cm.cleared_seq >= m.seq
               or exists (select 1 from message_hidden h where h.user_id = cm.user_id and h.message_id = m.id))`,
  );
  const exceptBy = new Map<string, string[]>();
  for (const e of except) exceptBy.set(e.message_id, [...(exceptBy.get(e.message_id) ?? []), e.user_id]);
  serialized.forEach((message, i) => {
    out.set(message.id, { chatId: rows[i]!.chatId, message, exceptUserIds: exceptBy.get(message.id) ?? [] });
  });
  return out;
}

/** Post-commit `message:updated` (prefer `Effects.messageUpdated` inside transactions). */
export async function publishMessageUpdated(messageId: string): Promise<void> {
  const p = (await messageUpdatedPayloads(db, [messageId])).get(messageId);
  if (p) emitToChat(p.chatId, 'message:updated', { message: p.message }, { exceptUserIds: p.exceptUserIds });
}

/** Post-commit `message:removed`: → user:<userId> (delete for me) or → room (purge). */
export function publishMessagesRemoved(chatId: string, messageIds: string[], opts: { userId?: string } = {}): void {
  if (messageIds.length === 0) return;
  if (opts.userId) emitToUser(opts.userId, 'message:removed', { chatId, messageIds });
  else emitToChat(chatId, 'message:removed', { chatId, messageIds });
}

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

/**
 * Delete for everyone (docs "Delete"), one tx: lock the chat; `text = null, media_id = null,
 * metadata = '{}', mentions = '{}', deleted_at = now()` (type kept); delete its reactions,
 * pins, stars and poll votes. Registers `message:updated` (tombstone) → room (visible
 * members) and `chat:pins` → room if it was pinned. Rights (`canDeleteForEveryone`) are the
 * caller's; system/call messages are rejected here too (400).
 */
export async function deleteForEveryoneTx(tx: Tx, fx: Effects, messageId: string): Promise<MessageRow> {
  const [current] = await tx.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!current) throw notFound('Message');
  if (current.type === 'system' || current.type === 'call') throw badRequest('This message cannot be deleted for everyone');
  await lockChat(tx, current.chatId);
  const [row] = await tx
    .update(messages)
    .set({ text: null, mediaId: null, metadata: {}, mentions: [], deletedAt: current.deletedAt ?? new Date() })
    .where(eq(messages.id, messageId))
    .returning();
  await tx.delete(messageReactions).where(eq(messageReactions.messageId, messageId));
  await tx.delete(starredMessages).where(eq(starredMessages.messageId, messageId));
  await tx.delete(pollVotes).where(eq(pollVotes.messageId, messageId));
  const pins = await tx.delete(chatPins).where(eq(chatPins.messageId, messageId)).returning({ chatId: chatPins.chatId });
  fx.messageUpdated(messageId);
  if (pins.length) fx.chatPins(current.chatId);
  return row!;
}

/**
 * Delete for me: a message_hidden row (+ my star on it). Registers `message:removed` → my
 * devices. The caller loaded the message with `loadVisibleMessage`.
 */
export async function deleteForMeTx(tx: Tx, fx: Effects, userId: string, message: Pick<MessageRow, 'id' | 'chatId'>): Promise<void> {
  await tx.insert(messageHidden).values({ userId, messageId: message.id }).onConflictDoNothing();
  await tx.delete(starredMessages).where(and(eq(starredMessages.userId, userId), eq(starredMessages.messageId, message.id)));
  fx.messagesRemoved(message.chatId, [message.id], { userId });
}
