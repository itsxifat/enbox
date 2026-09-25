/**
 * Messages module service: send, history, forward, edit, delete, reactions, stars, message
 * info, poll votes, starred list and message search.
 * Normative: docs/ARCHITECTURE.md "Messages", "Visibility, receipts and counts", matrix.
 * The send transaction, serializer, paging, visibility lookups and delete fan-out are the
 * domain primitives of services/messages.ts; this module adds the route-level rules
 * (permissions, windows, content validation, rate limits).
 */
import { and, desc, eq, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  MAX_CAPTION_LENGTH,
  QUICK_REACTIONS,
  USER_RATE_LIMITS,
  canDeleteForEveryone,
  canEditMessage,
  type Message,
  type MessageInfo,
  type MessagePage,
  type MessageSearchResult,
  type forwardSchema,
  type listMessagesQuerySchema,
  type searchMessagesQuerySchema,
  type sendMessageSchema,
  type starredMessagesQuerySchema,
} from '@enbox/shared';
import { db, type Tx } from '../../db/index.js';
import {
  chatMembers,
  messageReactions,
  messages,
  pollVotes,
  starredMessages,
  type MessageRow,
} from '../../db/schema.js';
import type { MessageMetadata } from '../../db/types.js';
import { badRequest, expired, forbidden, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import {
  assertCanSend,
  getChatAccess,
  lockChats,
  memberVisibleSql,
  peersWhoBlockedMe,
  requireActiveMember,
  requirePermission,
  type ChatAccess,
} from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { requireOwnedMedia } from '../../services/media.js';
import {
  buildContactCard,
  buildPollDefinition,
  createMessage,
  deleteForEveryoneTx,
  deleteForMeTx,
  deriveMentions,
  loadMessagePage,
  loadVisibleMessage,
  resolveReplyTarget,
  toMessages,
  type CreateMessageInput,
} from '../../services/messages.js';
import { resolveStatusReply } from '../../services/statuses.js';
import { getUserRows, settingsOf, toUserPublicMap } from '../../services/users.js';
import { toSearchResults } from '../chats/service.js';

export type SendMessageBody = z.output<typeof sendMessageSchema>;
export type ForwardBody = z.output<typeof forwardSchema>;
export type ListMessagesQuery = z.output<typeof listMessagesQuerySchema>;
export type SearchMessagesQuery = z.output<typeof searchMessagesQuerySchema>;
export type StarredMessagesQuery = z.output<typeof starredMessagesQuerySchema>;

/** Max rows of `GET /messages/starred` (the contract has no cursor). */
export const STARRED_LIST_LIMIT = 500;

/** Serialize one row for the viewer (REST responses: `starred`, `myReaction`, `myOptionIds`). */
async function toMessageFor(viewerId: string, row: MessageRow): Promise<Message> {
  const [message] = await toMessages(db, viewerId, [row]);
  return message!;
}

/** Wire-shaped fields the shared `canEditMessage` / `canDeleteForEveryone` helpers need. */
function ruleFields(row: MessageRow) {
  return {
    type: row.type,
    senderId: row.senderId,
    deletedAt: row.deletedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Load a message visible to the viewer and lock its chat (writes to messages / chat_pins lock
 * the chat first), then re-read it under the lock. Former members get `403 not_member`.
 */
async function lockVisibleMessage(
  tx: Tx,
  viewerId: string,
  messageId: string,
): Promise<{ access: ChatAccess; message: MessageRow }> {
  const first = await loadVisibleMessage(tx, viewerId, messageId);
  const access = await requireActiveMember(tx, viewerId, first.message.chatId, { lock: true });
  const { message } = await loadVisibleMessage(tx, viewerId, messageId, { chatId: access.chat.id });
  return { access, message };
}

// ---------------------------------------------------------------------------
// History & send
// ---------------------------------------------------------------------------

/** `GET /chats/:chatId/messages` (docs "History paging"). */
export function listMessages(
  me: string,
  chatId: string,
  query: ListMessagesQuery,
): Promise<MessagePage> {
  return loadMessagePage(db, me, chatId, query);
}

/** Empty / whitespace-only captions are stored as null. */
function captionOf(text: string | undefined): string | null {
  return text && text.trim() ? text : null;
}

/**
 * `POST /chats/:chatId/messages` (docs "Send"): per-user rate limit; active member (404 /
 * 403 not_member) — an existing (chat, sender, clientId) returns the original message (200,
 * nothing written or emitted); `canSend` (403 blocked / forbidden); media uploaded by me with
 * `kind === type`; contact cards filled server-side; polls with fresh stable option ids;
 * reply targets (same chat or reply privately) and status replies validated. The rest (seq,
 * expiry, mentions, withheld recipients, unhide, marks, fan-out) is `createMessage`.
 */
export async function sendMessage(
  me: string,
  chatId: string,
  body: SendMessageBody,
): Promise<{ message: Message; created: boolean }> {
  assertUserLimit(me, 'sendMessage', USER_RATE_LIMITS.sendMessage);
  const { row, created } = await transact(async (tx, fx) => {
    const access = await requireActiveMember(tx, me, chatId, { lock: true });
    const [existing] = await tx
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.chatId, chatId),
          eq(messages.senderId, me),
          eq(messages.clientId, body.clientId),
        ),
      )
      .limit(1);
    if (existing) return { row: existing, created: false };
    assertCanSend(access);

    const metadata: MessageMetadata = {};
    const input: CreateMessageInput = {
      chatId,
      senderId: me,
      type: body.type,
      clientId: body.clientId,
      metadata,
    };
    switch (body.type) {
      case 'text':
        input.text = body.text;
        break;
      case 'location':
        metadata.location = body.location;
        break;
      case 'contact':
        metadata.contact = await buildContactCard(tx, me, body.contact);
        break;
      case 'poll':
        metadata.poll = buildPollDefinition(body.poll);
        break;
      default:
        await requireOwnedMedia(tx, body.mediaId, me, { kinds: [body.type] });
        input.mediaId = body.mediaId;
        input.text = captionOf(body.text);
    }
    if (body.replyToId)
      input.replyToId = (await resolveReplyTarget(tx, me, access.chat, body.replyToId)).id;
    if (body.statusReplyToId) {
      metadata.statusReply = await resolveStatusReply(tx, {
        senderId: me,
        chat: access.chat,
        statusId: body.statusReplyToId,
      });
    }
    const result = await createMessage(tx, fx, input);
    return { row: result.message, created: result.created };
  });
  return { message: await toMessageFor(me, row), created };
}

// ---------------------------------------------------------------------------
// Forward
// ---------------------------------------------------------------------------

/** What a forwarded copy keeps (docs "Forward"): type, text, media, fresh location/contact/poll. */
function forwardedContent(
  src: MessageRow,
): Pick<CreateMessageInput, 'type' | 'text' | 'mediaId' | 'metadata'> {
  const md = src.metadata ?? {};
  const metadata: MessageMetadata = {};
  if (md.location) metadata.location = { ...md.location };
  if (md.contact) metadata.contact = { ...md.contact };
  if (md.poll) {
    metadata.poll = buildPollDefinition({
      question: md.poll.question,
      options: md.poll.options.map((o) => o.text),
      allowMultiple: md.poll.allowMultiple,
    });
  }
  return { type: src.type, text: src.text, mediaId: src.mediaId, metadata };
}

/**
 * `POST /messages/forward`: one transaction locking every target chat (sorted); targets need
 * `canSend`; sources must be visible to me (404), not deleted, not system/call (400). Each
 * copy is a normal send in its target chat with `client_id = <clientId>:<sourceIndex>`
 * (idempotent retries) and `forward_count = source + 1`; never reply links, status replies,
 * reactions, votes or expiry (the target's timer applies); mentions re-derived. Rate limit:
 * one `sendMessage` unit per copy (docs "Rate limits"); a forward creating more copies than
 * one window allows (`messageIds × chatIds` > USER_RATE_LIMITS.sendMessage.limit) is a
 * `400 validation_error` (it could never pass). Result: target-major, sources in request order.
 */
export async function forwardMessages(
  me: string,
  body: ForwardBody,
): Promise<{ messages: Message[]; created: boolean }> {
  const rule = USER_RATE_LIMITS.sendMessage;
  const copies = body.messageIds.length * body.chatIds.length;
  if (copies > rule.limit)
    throw badRequest(`A forward can create at most ${rule.limit} messages (messages × chats)`);
  assertUserLimit(me, 'sendMessage', rule, copies);
  const { rows, created } = await transact(async (tx, fx) => {
    // Unlocked membership pre-check: never queue on the row lock of a chat I can't see.
    for (const chatId of body.chatIds) await getChatAccess(tx, me, chatId);
    const locked = new Map((await lockChats(tx, body.chatIds)).map((c) => [c.id, c]));
    for (const chatId of body.chatIds) {
      const chat = locked.get(chatId);
      if (!chat) throw notFound('Chat');
      assertCanSend(await getChatAccess(tx, me, chatId, { chat }));
    }
    const sources: MessageRow[] = [];
    for (const id of body.messageIds) {
      const { message } = await loadVisibleMessage(tx, me, id);
      if (message.type === 'system' || message.type === 'call')
        throw badRequest('This message cannot be forwarded');
      if (message.deletedAt) throw badRequest('This message was deleted');
      sources.push(message);
    }
    const out: MessageRow[] = [];
    let anyCreated = false;
    for (const chatId of body.chatIds) {
      for (const [index, src] of sources.entries()) {
        const r = await createMessage(tx, fx, {
          chatId,
          senderId: me,
          clientId: `${body.clientId}:${index}`,
          forwardCount: src.forwardCount + 1,
          ...forwardedContent(src),
        });
        anyCreated ||= r.created;
        out.push(r.message);
      }
    }
    return { rows: out, created: anyCreated };
  });
  return { messages: await toMessages(db, me, rows), created };
}

// ---------------------------------------------------------------------------
// Edit & delete
// ---------------------------------------------------------------------------

const EDITABLE_TYPES = new Set<MessageRow['type']>([
  'text',
  'image',
  'video',
  'audio',
  'voice',
  'file',
]);

/**
 * `PATCH /messages/:messageId` (docs "Edit"): text and captions only (400), not deleted (403),
 * the sender — any channel admin for channel posts — who can still send (403), within
 * EDIT_WINDOW_MS (410). Text messages need text; captions may be emptied (null). Mentions
 * re-derived, `edited_at` set. Unchanged text → no-op. Events: `message:updated` → room
 * (direct chat whose peer blocked me: not to the peer — docs "Blocking").
 */
export async function editMessage(me: string, messageId: string, text: string): Promise<Message> {
  const row = await transact(async (tx, fx) => {
    const { access, message } = await lockVisibleMessage(tx, me, messageId);
    if (!EDITABLE_TYPES.has(message.type)) throw badRequest('This message cannot be edited');
    if (message.deletedAt) throw forbidden('This message was deleted');
    const isAuthor =
      access.chat.type === 'channel' ? access.permissions.canSend : message.senderId === me;
    if (!isAuthor) throw forbidden('You can only edit your own messages');
    if (!access.permissions.canSend)
      throw forbidden('You can no longer send messages in this chat');
    if (
      !canEditMessage(
        ruleFields(message),
        { type: access.chat.type, permissions: access.permissions },
        me,
      )
    ) {
      throw expired('This message can no longer be edited');
    }
    let next: string | null;
    if (message.type === 'text') {
      if (!text) throw badRequest('text: Text messages need text');
      next = text;
    } else {
      if (text.length > MAX_CAPTION_LENGTH)
        throw badRequest(`text: Captions are limited to ${MAX_CAPTION_LENGTH} characters`);
      next = text || null;
    }
    if (next === message.text) return message;
    const mentions = await deriveMentions(tx, message.chatId, message.senderId, next);
    const [updated] = await tx
      .update(messages)
      .set({ text: next, mentions, editedAt: new Date() })
      .where(eq(messages.id, messageId))
      .returning();
    fx.messageUpdated(messageId, { exceptUserIds: await peersWhoBlockedMe(tx, access) });
    return updated!;
  });
  return toMessageFor(me, row);
}

/**
 * `DELETE /messages/:messageId?for=me|everyone` (docs "Delete").
 * - me: any message visible to me (former members too): hidden row + my star;
 *   `message:removed` → my devices.
 * - everyone: active members; never system/call (400); already deleted → no-op; the sender
 *   within DELETE_FOR_EVERYONE_WINDOW_MS (410 after), group/channel admins any time, never
 *   admins in direct chats (403). Scrubs content and removes reactions/pins/stars/votes;
 *   `message:updated` (tombstone) → room, `chat:pins` → room if it was pinned.
 */
export async function deleteMessage(
  me: string,
  messageId: string,
  scope: 'me' | 'everyone',
): Promise<void> {
  if (scope === 'me') {
    await transact(async (tx, fx) => {
      const { message } = await loadVisibleMessage(tx, me, messageId);
      await deleteForMeTx(tx, fx, me, message);
    });
    return;
  }
  await transact(async (tx, fx) => {
    const { access, message } = await lockVisibleMessage(tx, me, messageId);
    if (message.type === 'system' || message.type === 'call')
      throw badRequest('This message cannot be deleted for everyone');
    if (message.deletedAt) return;
    if (!access.permissions.canDeleteForEveryoneAsAdmin && message.senderId !== me) {
      throw forbidden('You can only delete your own messages for everyone');
    }
    if (
      !canDeleteForEveryone(
        ruleFields(message),
        { type: access.chat.type, membership: access.membership, permissions: access.permissions },
        me,
      )
    ) {
      throw expired('This message can no longer be deleted for everyone');
    }
    await deleteForEveryoneTx(tx, fx, messageId);
  });
}

// ---------------------------------------------------------------------------
// Reactions, stars, votes
// ---------------------------------------------------------------------------

/** Compare emoji ignoring variation selector 16 ('❤' vs '❤️'). */
const stripVs16 = (s: string) => s.replace(/️/g, '');
const QUICK = new Set(QUICK_REACTIONS.map(stripVs16));

/**
 * Load a message for a reaction/vote: visible (404), message row locked (serializes
 * concurrent votes/reactions and a concurrent delete-for-everyone), active membership (403).
 * `hideFrom`: the direct-chat peer when they blocked me (my reactions and votes are never
 * emitted to them — docs "Blocking").
 */
async function lockMessageForInteraction(tx: Tx, me: string, messageId: string) {
  const v = await loadVisibleMessage(tx, me, messageId, { lock: true });
  const access = await requireActiveMember(tx, me, v.chat.id);
  return { ...v, hideFrom: await peersWhoBlockedMe(tx, access) };
}

/**
 * `PUT /messages/:messageId/reaction` (docs "Reactions"): one reaction per user (replaces);
 * not on system or deleted messages (400); channels follow `channelSettings.reactions`
 * ('none' → 403, 'quick' → QUICK_REACTIONS only, else 403). Events: `message:updated` → room.
 */
export async function react(me: string, messageId: string, emoji: string): Promise<Message> {
  const row = await transact(async (tx, fx) => {
    const { message, chat, hideFrom } = await lockMessageForInteraction(tx, me, messageId);
    if (message.type === 'system' || message.deletedAt)
      throw badRequest('You cannot react to this message');
    if (chat.type === 'channel') {
      const mode = chat.channelSettings?.reactions ?? 'all';
      if (mode === 'none') throw forbidden('Reactions are turned off in this channel');
      if (mode === 'quick' && !QUICK.has(stripVs16(emoji)))
        throw forbidden('Only quick reactions are allowed in this channel');
    }
    const [current] = await tx
      .select({ emoji: messageReactions.emoji })
      .from(messageReactions)
      .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, me)))
      .limit(1);
    if (current?.emoji !== emoji) {
      await tx
        .insert(messageReactions)
        .values({ messageId, userId: me, emoji })
        .onConflictDoUpdate({
          target: [messageReactions.messageId, messageReactions.userId],
          set: { emoji, createdAt: new Date() },
        });
      fx.messageUpdated(messageId, { exceptUserIds: hideFrom });
    }
    return message;
  });
  return toMessageFor(me, row);
}

/** `DELETE /messages/:messageId/reaction`: remove mine (no-op without one). Events: `message:updated` → room. */
export async function unreact(me: string, messageId: string): Promise<Message> {
  const row = await transact(async (tx, fx) => {
    const { message, hideFrom } = await lockMessageForInteraction(tx, me, messageId);
    const removed = await tx
      .delete(messageReactions)
      .where(and(eq(messageReactions.messageId, messageId), eq(messageReactions.userId, me)))
      .returning({ emoji: messageReactions.emoji });
    if (removed.length) fx.messageUpdated(messageId, { exceptUserIds: hideFrom });
    return message;
  });
  return toMessageFor(me, row);
}

/** `PUT/DELETE /messages/:messageId/star`: private, no events. Visible messages only; not system/deleted (400). */
export async function setStar(me: string, messageId: string, starred: boolean): Promise<void> {
  await transact(async (tx) => {
    const { message } = await loadVisibleMessage(tx, me, messageId, { lock: starred });
    if (!starred) {
      await tx
        .delete(starredMessages)
        .where(and(eq(starredMessages.userId, me), eq(starredMessages.messageId, messageId)));
      return;
    }
    if (message.type === 'system' || message.deletedAt)
      throw badRequest('This message cannot be starred');
    await tx.insert(starredMessages).values({ userId: me, messageId }).onConflictDoNothing();
  });
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x) => b.includes(x));

/**
 * `PUT /messages/:messageId/vote` (docs "Polls"): under the message row lock, replace my votes
 * (empty = retract). Unknown options or several on a single-choice poll → 400. Unchanged →
 * no event. Events: `message:updated` → room. Returns the poll with `myOptionIds`.
 */
export async function vote(me: string, messageId: string, optionIds: string[]): Promise<Message> {
  const row = await transact(async (tx, fx) => {
    const { message, hideFrom } = await lockMessageForInteraction(tx, me, messageId);
    const poll = message.metadata?.poll;
    if (message.type !== 'poll' || message.deletedAt || !poll)
      throw badRequest('This message is not a poll');
    const valid = new Set(poll.options.map((o) => o.id));
    if (optionIds.some((id) => !valid.has(id))) throw badRequest('optionIds: Unknown poll option');
    if (!poll.allowMultiple && optionIds.length > 1)
      throw badRequest('optionIds: This poll allows a single choice');
    const where = and(eq(pollVotes.messageId, messageId), eq(pollVotes.userId, me));
    const current = (
      await tx.select({ optionId: pollVotes.optionId }).from(pollVotes).where(where)
    ).map((r) => r.optionId);
    if (sameSet(current, optionIds)) return message;
    await tx.delete(pollVotes).where(where);
    if (optionIds.length)
      await tx
        .insert(pollVotes)
        .values(optionIds.map((optionId) => ({ messageId, userId: me, optionId })));
    fx.messageUpdated(messageId, { exceptUserIds: hideFrom });
    return message;
  });
  return toMessageFor(me, row);
}

// ---------------------------------------------------------------------------
// Message info
// ---------------------------------------------------------------------------

/**
 * `GET /messages/:messageId/info` (docs "Watermarks"): 404 in channels; like the member list
 * it needs an active membership (former members → 403 not_member) and `canViewMembers`
 * (announcement groups: admins only → 403); sender only (403).
 * Lists the other active members who joined before the message, split by their watermarks
 * (read ≥ seq → readBy, delivered ≥ seq → deliveredTo, else pending) — consistent with the
 * tick watermarks. Direct chats where either side has read receipts off never report reads.
 * `at` = when that member's watermark last advanced (approximate, nullable).
 */
export async function messageInfo(me: string, messageId: string): Promise<MessageInfo> {
  const { message, chat } = await loadVisibleMessage(db, me, messageId);
  if (chat.type === 'channel') throw notFound('Message');
  const access = await requireActiveMember(db, me, chat.id, { chat });
  requirePermission(access, 'canViewMembers', 'Only admins can see message info');
  if (message.senderId !== me) throw forbidden('Only the sender can see message info');
  const seq = Number(message.seq);
  const members = await db
    .select()
    .from(chatMembers)
    .where(
      and(
        eq(chatMembers.chatId, chat.id),
        isNull(chatMembers.leftAt),
        ne(chatMembers.userId, me),
        sql`${chatMembers.joinedSeq} < ${seq}`,
      ),
    )
    .orderBy(chatMembers.joinedAt, chatMembers.userId);
  const info: MessageInfo = { messageId, readBy: [], deliveredTo: [], pending: [] };
  if (members.length === 0) return info;

  let readsHidden = false;
  if (chat.type === 'direct') {
    const rows = await getUserRows(db, [me, ...members.map((m) => m.userId)]);
    readsHidden = [...rows.values()].some((u) => !u.deletedAt && !settingsOf(u).readReceipts);
  }
  const users = await toUserPublicMap(
    db,
    me,
    members.map((m) => m.userId),
  );
  for (const m of members) {
    const user = users.get(m.userId);
    if (!user) continue;
    if (!readsHidden && Number(m.lastReadSeq) >= seq)
      info.readBy.push({ user, at: m.lastReadAt?.toISOString() ?? null });
    else if (Number(m.lastDeliveredSeq) >= seq)
      info.deliveredTo.push({ user, at: m.lastDeliveredAt?.toISOString() ?? null });
    else info.pending.push(user);
  }
  return info;
}

// ---------------------------------------------------------------------------
// Starred list & search
// ---------------------------------------------------------------------------

/**
 * `GET /messages/starred`: my starred messages that are still visible to me, newest star
 * first (≤ STARRED_LIST_LIMIT), with chat previews. `chatId`: only that chat's (404 unless
 * I have a non-hidden row, like search; former members: their window).
 */
export async function listStarred(
  me: string,
  opts: StarredMessagesQuery = {},
): Promise<MessageSearchResult[]> {
  if (opts.chatId) await getChatAccess(db, me, opts.chatId);
  const rows = await db
    .select({ message: messages })
    .from(starredMessages)
    .innerJoin(messages, eq(messages.id, starredMessages.messageId))
    .innerJoin(
      chatMembers,
      and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, starredMessages.userId)),
    )
    .where(
      and(
        eq(starredMessages.userId, me),
        opts.chatId ? eq(messages.chatId, opts.chatId) : undefined,
        memberVisibleSql('messages', 'chat_members'),
      ),
    )
    .orderBy(desc(starredMessages.createdAt), desc(messages.seq))
    .limit(STARRED_LIST_LIMIT);
  return toSearchResults(
    db,
    me,
    rows.map((r) => r.message),
  );
}

/** Escape LIKE wildcards (`%`, `_`) and the escape character itself (default escape: backslash). */
export function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * `GET /search/messages`: case-insensitive substring search over the text/captions of
 * messages visible to me (my membership windows: nothing before `joined_seq`, after
 * `left_seq`, cleared, hidden or expired), not deleted, optionally in one chat (404 unless I
 * have a non-hidden row), newest first, ≤ `limit`.
 */
export async function searchMessages(
  me: string,
  query: SearchMessagesQuery,
): Promise<MessageSearchResult[]> {
  if (query.chatId) await getChatAccess(db, me, query.chatId);
  const pattern = `%${escapeLike(query.q)}%`;
  const rows = await db
    .select({ message: messages })
    .from(messages)
    .innerJoin(
      chatMembers,
      and(eq(chatMembers.chatId, messages.chatId), eq(chatMembers.userId, me)),
    )
    .where(
      and(
        query.chatId ? eq(messages.chatId, query.chatId) : undefined,
        memberVisibleSql('messages', 'chat_members'),
        isNull(messages.deletedAt),
        sql`${messages.type} not in ('system', 'call')`,
        sql`${messages.text} ilike ${pattern}`,
      ),
    )
    .orderBy(desc(messages.createdAt), desc(messages.seq))
    .limit(query.limit);
  return toSearchResults(
    db,
    me,
    rows.map((r) => r.message),
  );
}
