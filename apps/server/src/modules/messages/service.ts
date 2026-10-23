/**
 * Messages module service: send, history, forward, edit, delete, reactions, stars, message
 * info, poll votes, starred list and message search.
 * Normative: docs/ARCHITECTURE.md "Messages", "Visibility, receipts and counts", matrix.
 * The send transaction, serializer, paging, visibility lookups and delete fan-out are the
 * domain primitives of services/messages.ts; this module adds the route-level rules
 * (permissions, windows, content validation, rate limits).
 */
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import type { z } from 'zod';
import {
  DEFAULT_POLL_DURATION_HOURS,
  MAX_ALT_TEXT_LENGTH,
  MAX_ATTACHMENTS_PER_MESSAGE,
  MAX_CAPTION_LENGTH,
  MESSAGE_FLAGS,
  PERM,
  USER_RATE_LIMITS,
  canDeleteForEveryone,
  canEditMessage,
  extractMentionIds,
  hasPerm,
  isSpaceChatType,
  type ChatType,
  type MediaKind,
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
  chats,
  messageAttachments,
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
import { uniq } from '../../services/sql.js';
import { resolveStatusReply } from '../../services/statuses.js';
import {
  allowedSpaceMentions,
  assertSpaceVerification,
  spaceSendRules,
  touchSlowmode,
} from '../../services/spaceRules.js';
import { gateExternalEmoji } from '../../services/spaceEmojis.js';
import { resolveStickerForSend } from '../stickers/service.js';
import { enforceAutoMod } from '../../services/automod.js';
import { ensureSpaceReadRow } from '../../services/spaceAccess.js';
import { getUserRows, settingsOf, toUserPublicMap } from '../../services/users.js';
import { toSearchResults } from '../chats/service.js';
import { autoFollowThread } from '../threads/follow.js';
import { removeMyReactions, replaceMyReaction } from './reactions.js';
import { pollHasEnded, pollSendFields } from './polls.js';
import { propagateCrosspostDelete, propagateCrosspostEdit } from '../announcements/service.js';

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

/** Kinds of the files after the first one (any upload but a voice note). */
const EXTRA_MEDIA_KINDS: readonly MediaKind[] = ['image', 'video', 'audio', 'file'];

/** Alt text as stored: trimmed, blank → null, ≤ MAX_ALT_TEXT_LENGTH. */
function altTextOf(text: string | null | undefined): string | null {
  const t = text?.trim();
  if (!t) return null;
  if (t.length > MAX_ALT_TEXT_LENGTH)
    throw badRequest(`descriptions: Alt text is limited to ${MAX_ALT_TEXT_LENGTH} characters`);
  return t;
}

/**
 * The files of a media send (Discord: up to MAX_ATTACHMENTS_PER_MESSAGE), in order: `mediaId`,
 * whose kind is the message's type, then `extraMediaIds` — distinct uploads of mine of any
 * kind but voice (a voice note carries no other file) — each with its alt text
 * (`descriptions`, aligned; blank = none). Ownership and the GC lock are `requireOwnedMedia`'s,
 * file by file (404 someone else's, 400 a wrong kind). Forum posts' first messages too.
 */
export async function mediaAttachmentsOf(
  tx: Tx,
  me: string,
  body: Extract<SendMessageBody, { mediaId: string }>,
): Promise<NonNullable<CreateMessageInput['attachments']>> {
  const extras = body.extraMediaIds ?? [];
  if (extras.length && body.type === 'voice')
    throw badRequest('extraMediaIds: Voice messages carry no other files');
  const ids = [body.mediaId, ...extras];
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE)
    throw badRequest(`extraMediaIds: At most ${MAX_ATTACHMENTS_PER_MESSAGE} files per message`);
  if (new Set(ids).size !== ids.length)
    throw badRequest('extraMediaIds: Each file can be attached only once');
  const descriptions = body.descriptions ?? [];
  if (descriptions.length > ids.length) throw badRequest('descriptions: At most one per file');
  const alt = ids.map((_, i) => altTextOf(descriptions[i]));
  await requireOwnedMedia(tx, body.mediaId, me, { kinds: [body.type] });
  for (const id of extras) await requireOwnedMedia(tx, id, me, { kinds: EXTRA_MEDIA_KINDS });
  return ids.map((mediaId, i) => ({ mediaId, description: alt[i] ?? null }));
}

/**
 * Replies mention their author in groups and Space channels (`mentionRepliedAuthor`, default
 * on); direct chats notify anyway and broadcast channels have no reply pings.
 */
function pingsRepliedAuthor(type: ChatType, flag: boolean | undefined): boolean {
  return flag !== false && (type === 'group' || isSpaceChatType(type));
}

/**
 * `POST /chats/:chatId/messages` (docs "Send"): per-user rate limit; active member (404 /
 * 403 not_member) — an existing (chat, sender, clientId) returns the original message (200,
 * nothing written or emitted); `canSend` (403 blocked / forbidden); media uploaded by me with
 * `kind === type`, plus up to 9 more files with alt text (`mediaAttachmentsOf`); contact cards
 * filled server-side; polls with fresh stable option ids;
 * reply targets (same chat or reply privately) and status replies validated. The rest (seq,
 * expiry, mentions, withheld recipients, unhide, marks, fan-out) is `createMessage`.
 */
export async function sendMessage(
  me: string,
  chatId: string,
  body: SendMessageBody,
): Promise<{ message: Message; created: boolean }> {
  assertUserLimit(me, 'sendMessage', USER_RATE_LIMITS.sendMessage);
  // A sticker is an `image` message showing its picture (old clients see the image).
  const type = body.type === 'sticker' ? 'image' : body.type;
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
    // Space channels: attach/poll bits, slowmode, and which @everyone/@role mentions count.
    // A sticker is not a file (no ATTACH_FILES): checked like text, its own rule is below.
    const spaceMentions = access.space
      ? spaceSendRules(access, me, {
          type: body.type === 'sticker' ? 'text' : body.type,
          text: 'text' in body ? body.text : null,
        })
      : undefined;
    if (access.space) await assertSpaceVerification(tx, access, me);
    // Reply targets are looked up through my read row, lazy in Space channels.
    if (access.space && body.replyToId)
      await ensureSpaceReadRow(tx, access.chat, me, access.space.me.member.joinedAt);

    const metadata: MessageMetadata = {};
    const input: CreateMessageInput = {
      chatId,
      senderId: me,
      type,
      clientId: body.clientId,
      metadata,
      spaceMentions,
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
      case 'poll': {
        // Answer emoji (Space channels: gated like text) and the end time (./polls.ts).
        const poll = await pollSendFields(tx, access, body.poll);
        metadata.poll = poll.definition;
        input.pollEndsAt = poll.endsAt;
        break;
      }
      case 'sticker': {
        // A Space of mine's sticker (404), external ones need USE_EXTERNAL_EMOJI here (403).
        const sticker = await resolveStickerForSend(tx, me, access, body.stickerId);
        input.mediaId = sticker.mediaId;
        input.stickerId = sticker.id;
        break;
      }
      default:
        // Every file with its alt text; the caption belongs to the whole message.
        input.attachments = await mediaAttachmentsOf(tx, me, body);
        input.mediaId = body.mediaId;
        input.text = captionOf(body.text);
    }
    // Space channels: other Spaces' custom emoji need USE_EXTERNAL_EMOJI (else `:name:`).
    if (input.text) input.text = await gateExternalEmoji(tx, access, input.text);
    // Flags: /tts (read aloud), and no embeds from a Space channel member without EMBED_LINKS.
    let flags = body.type === 'text' && body.tts ? MESSAGE_FLAGS.TTS : 0;
    if (access.space && input.text && !hasPerm(access.space.bits, PERM.EMBED_LINKS))
      flags |= MESSAGE_FLAGS.SUPPRESS_EMBEDS;
    if (flags) input.flags = flags;
    if (body.replyToId) {
      const target = await resolveReplyTarget(tx, me, access.chat, body.replyToId);
      input.replyToId = target.id;
      // Discord: a reply in a group or Space channel pings its author unless turned off.
      if (
        pingsRepliedAuthor(access.chat.type, body.mentionRepliedAuthor) &&
        target.chatId === chatId &&
        target.senderId
      )
        input.mentionUserIds = [target.senderId];
    }
    if (body.statusReplyToId) {
      metadata.statusReply = await resolveStatusReply(tx, {
        senderId: me,
        chat: access.chat,
        statusId: body.statusReplyToId,
      });
    }
    // Space channels: AutoMod (403 automod_blocked; alerts / timeouts follow the transaction).
    if (access.space) await enforceAutoMod(tx, fx, access, me, input);
    const result = await createMessage(tx, fx, input);
    if (result.created) await touchSlowmode(tx, access, me);
    // Replying in a post or thread follows it.
    if (result.created && access.chat.type === 'space_thread')
      await autoFollowThread(tx, chatId, me, fx);
    return { row: result.message, created: result.created };
  });
  return { message: await toMessageFor(me, row), created };
}

// ---------------------------------------------------------------------------
// Forward
// ---------------------------------------------------------------------------

type AttachmentInput = NonNullable<CreateMessageInput['attachments']>[number];

/**
 * The `message_attachments` rows of messages (several files or alt text) as send inputs, in
 * order, by message id: one query for a whole batch. Messages with just `media_id` have none.
 */
async function attachmentInputsOf(
  tx: Tx,
  messageIds: string[],
): Promise<Map<string, AttachmentInput[]>> {
  const out = new Map<string, AttachmentInput[]>();
  if (messageIds.length === 0) return out;
  const rows = await tx
    .select({
      messageId: messageAttachments.messageId,
      mediaId: messageAttachments.mediaId,
      description: messageAttachments.description,
    })
    .from(messageAttachments)
    .where(inArray(messageAttachments.messageId, uniq(messageIds)))
    .orderBy(asc(messageAttachments.messageId), asc(messageAttachments.position));
  for (const r of rows)
    out.set(r.messageId, [
      ...(out.get(r.messageId) ?? []),
      { mediaId: r.mediaId, description: r.description },
    ]);
  return out;
}

/**
 * What a forwarded copy keeps (docs "Forward"): type, text, media — every attachment with its
 * alt text (`attachments`, the source's rows) — and a fresh location/contact/poll (a poll that
 * had an end ends DEFAULT_POLL_DURATION_HOURS after the forward, else never). `forwardedFrom`:
 * the source's own (a forward of a forward points at the first original), else the source,
 * with `spaceId` its chat's Space (null outside Spaces).
 */
function forwardedContent(
  src: MessageRow,
  attachments: AttachmentInput[] | undefined,
  spaceId: string | null,
): Pick<
  CreateMessageInput,
  | 'type'
  | 'text'
  | 'mediaId'
  | 'attachments'
  | 'stickerId'
  | 'metadata'
  | 'forwardedFrom'
  | 'pollEndsAt'
> {
  const md = src.metadata ?? {};
  const metadata: MessageMetadata = {};
  if (md.location) metadata.location = { ...md.location };
  if (md.contact) metadata.contact = { ...md.contact };
  if (md.poll) {
    metadata.poll = buildPollDefinition({
      question: md.poll.question,
      options: md.poll.options.map((o) => o.text),
      allowMultiple: md.poll.allowMultiple,
      emojis: md.poll.options.map((o) => o.emoji ?? null),
    });
  }
  return {
    type: src.type,
    text: src.text,
    mediaId: src.mediaId,
    ...(src.mediaId && attachments?.length ? { attachments } : {}),
    stickerId: src.stickerId,
    metadata,
    forwardedFrom: src.forwardedFrom ?? {
      chatId: src.chatId,
      messageId: src.id,
      spaceId,
      createdAt: src.createdAt.toISOString(),
    },
    pollEndsAt:
      md.poll && src.pollEndsAt
        ? new Date(Date.now() + DEFAULT_POLL_DURATION_HOURS * 60 * 60_000)
        : null,
  };
}

/**
 * `POST /messages/forward`: one transaction locking every target chat (sorted); targets need
 * `canSend`; sources must be visible to me (404), not deleted, not system/call (400). Each
 * copy is a normal send in its target chat with `client_id = <clientId>:<sourceIndex>`
 * (idempotent retries), `forward_count = source + 1` and `forwarded_from` (the original, see
 * `forwardedContent`); never reply links, status replies, reactions, votes or expiry (the
 * target's timer applies); mentions re-derived. `comment`: after a chat's copies, my own text
 * message there (`client_id = <clientId>:c`, idempotent too), checked like a send (other
 * Spaces' emoji, embeds, AutoMod) and mentioning the normal way (@everyone and @role as my
 * bits allow). Space channels: slowmode counts the forward as one send (retries pass).
 * Rate limit: one `sendMessage` unit per message created, copies and comments (docs "Rate
 * limits"); a forward creating more than one window allows is a `400 validation_error` (it
 * could never pass). Result: the copies only, target-major, sources in request order (the
 * comments reach clients as `message:new`); `created` = anything new (copies or comments).
 */
export async function forwardMessages(
  me: string,
  body: ForwardBody,
): Promise<{ messages: Message[]; created: boolean }> {
  const rule = USER_RATE_LIMITS.sendMessage;
  const total = (body.messageIds.length + (body.comment ? 1 : 0)) * body.chatIds.length;
  if (total > rule.limit)
    throw badRequest(`A forward can create at most ${rule.limit} messages (messages × chats)`);
  assertUserLimit(me, 'sendMessage', rule, total);
  const commentId = `${body.clientId}:c`;
  const { rows, created } = await transact(async (tx, fx) => {
    // Unlocked membership pre-check: never queue on the row lock of a chat I can't see.
    for (const chatId of body.chatIds) await getChatAccess(tx, me, chatId);
    const locked = new Map((await lockChats(tx, body.chatIds)).map((c) => [c.id, c]));
    const targets = new Map<string, ChatAccess>();
    for (const chatId of body.chatIds) {
      const chat = locked.get(chatId);
      if (!chat) throw notFound('Chat');
      const access = await getChatAccess(tx, me, chatId, { chat });
      assertCanSend(access);
      if (access.space) await assertSpaceVerification(tx, access, me);
      targets.set(chatId, access);
    }
    const sources: { row: MessageRow; spaceId: string | null }[] = [];
    for (const id of body.messageIds) {
      const { message, chat } = await loadVisibleMessage(tx, me, id);
      if (message.type === 'system' || message.type === 'call')
        throw badRequest('This message cannot be forwarded');
      if (message.deletedAt) throw badRequest('This message was deleted');
      sources.push({ row: message, spaceId: chat.spaceId });
    }
    // Copies keep every file of their source with its alt text.
    const files = await attachmentInputsOf(
      tx,
      sources.filter((s) => s.row.mediaId).map((s) => s.row.id),
    );
    // A retry finds what an earlier attempt created: no slowmode or AutoMod for those again.
    const clientIds = sources.map((_, i) => `${body.clientId}:${i}`);
    if (body.comment) clientIds.push(commentId);
    const done = new Set(
      (
        await tx
          .select({ chatId: messages.chatId, clientId: messages.clientId })
          .from(messages)
          .where(
            and(
              inArray(messages.chatId, body.chatIds),
              eq(messages.senderId, me),
              inArray(messages.clientId, clientIds),
            ),
          )
      ).map((r) => `${r.chatId}:${r.clientId}`),
    );
    const out: MessageRow[] = [];
    let anyCreated = false;
    for (const chatId of body.chatIds) {
      const access = targets.get(chatId)!;
      const fresh = clientIds.some((c) => !done.has(`${chatId}:${c}`));
      const spaceMentions =
        access.space && fresh
          ? spaceSendRules(access, me, { type: 'text', text: body.comment })
          : undefined;
      let createdHere = false;
      for (const [index, src] of sources.entries()) {
        const r = await createMessage(tx, fx, {
          chatId,
          senderId: me,
          clientId: `${body.clientId}:${index}`,
          forwardCount: src.row.forwardCount + 1,
          ...forwardedContent(src.row, files.get(src.row.id), src.spaceId),
        });
        createdHere ||= r.created;
        out.push(r.message);
      }
      if (body.comment) {
        const input: CreateMessageInput = {
          chatId,
          senderId: me,
          type: 'text',
          clientId: commentId,
          text: body.comment,
          spaceMentions,
        };
        if (access.space && !done.has(`${chatId}:${commentId}`)) {
          input.text = await gateExternalEmoji(tx, access, body.comment);
          if (!hasPerm(access.space.bits, PERM.EMBED_LINKS))
            input.flags = MESSAGE_FLAGS.SUPPRESS_EMBEDS;
          await enforceAutoMod(tx, fx, access, me, input);
        }
        const r = await createMessage(tx, fx, input);
        createdHere ||= r.created;
      }
      if (createdHere) await touchSlowmode(tx, access, me);
      anyCreated ||= createdHere;
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
    if (!EDITABLE_TYPES.has(message.type) || message.stickerId)
      throw badRequest('This message cannot be edited');
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
    if (next) next = await gateExternalEmoji(tx, access, next);
    if (next === message.text) return message;
    // Space channels: AutoMod re-checks edits (blocked → the edit is refused).
    if (access.space) await enforceAutoMod(tx, fx, access, me, { text: next }, { edit: true });
    // A reply's ping (its author, mentioned without a token) survives the edit.
    const tokenIds = new Set(extractMentionIds(message.text, Number.MAX_SAFE_INTEGER));
    const replyPing = message.replyToId ? message.mentions.filter((id) => !tokenIds.has(id)) : [];
    const mentions = await deriveMentions(tx, message.chatId, message.senderId, next, undefined, {
      spaceId: access.chat.spaceId,
      extraIds: replyPing,
    });
    // Space channels: re-derived flags, no new pings (edits never notify again).
    const space = access.space ? allowedSpaceMentions(access, next) : null;
    const [updated] = await tx
      .update(messages)
      .set({
        text: next,
        mentions,
        editedAt: new Date(),
        ...(space ? { mentionEveryone: space.everyone, mentionRoleIds: space.roleIds } : {}),
      })
      .where(eq(messages.id, messageId))
      .returning();
    fx.messageUpdated(messageId, { exceptUserIds: await peersWhoBlockedMe(tx, access) });
    return updated!;
  });
  propagateCrosspostEdit(row); // published announcements: the followers' copies follow
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
  propagateCrosspostDelete(messageId); // published announcements: their copies go too
}

// ---------------------------------------------------------------------------
// Reactions, stars, votes
// ---------------------------------------------------------------------------

/**
 * Load a message for a vote: visible (404), message row locked (serializes concurrent votes
 * and a concurrent delete-for-everyone), active membership (403). `hideFrom`: the
 * direct-chat peer when they blocked me (my votes are never emitted to them — docs
 * "Blocking").
 */
async function lockMessageForInteraction(tx: Tx, me: string, messageId: string) {
  const v = await loadVisibleMessage(tx, me, messageId, { lock: true });
  const access = await requireActiveMember(tx, me, v.chat.id);
  return { ...v, access, hideFrom: await peersWhoBlockedMe(tx, access) };
}

/**
 * `PUT /messages/:messageId/reaction` (the APK's single-reaction route): replace semantics —
 * my other reactions on the message are removed, then this one is added. Rules and delta
 * events: ./reactions.ts. Returns the message for me (`myReaction` = this one).
 */
export async function react(me: string, messageId: string, emoji: string): Promise<Message> {
  return toMessageFor(me, await replaceMyReaction(me, messageId, emoji));
}

/** `DELETE /messages/:messageId/reaction`: remove all of mine (no-op without any). See ./reactions.ts. */
export async function unreact(me: string, messageId: string): Promise<Message> {
  return toMessageFor(me, await removeMyReactions(me, messageId));
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
 * (empty = retract). Unknown options or several on a single-choice poll → 400; an ended poll
 * (closed, or its end time passed) → 410 expired. Unchanged → no event. Events:
 * `message:updated` → room. Returns the poll with `myOptionIds`.
 */
export async function vote(me: string, messageId: string, optionIds: string[]): Promise<Message> {
  const row = await transact(async (tx, fx) => {
    const { message, hideFrom } = await lockMessageForInteraction(tx, me, messageId);
    const poll = message.metadata?.poll;
    if (message.type !== 'poll' || message.deletedAt || !poll)
      throw badRequest('This message is not a poll');
    if (pollHasEnded(message)) throw expired('This poll has ended');
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
    .select({ message: messages, spaceId: chats.spaceId })
    .from(starredMessages)
    .innerJoin(messages, eq(messages.id, starredMessages.messageId))
    .innerJoin(chats, eq(chats.id, messages.chatId))
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
  // A Space channel's read row outlives the access (a role removed, a channel made private):
  // re-check VIEW from the computed permissions, once per channel.
  const denied = new Set<string>();
  for (const chatId of uniq(rows.filter((r) => r.spaceId).map((r) => r.message.chatId))) {
    await getChatAccess(db, me, chatId).catch(() => denied.add(chatId));
  }
  return toSearchResults(
    db,
    me,
    rows.filter((r) => !denied.has(r.message.chatId)).map((r) => r.message),
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
        // Space channels: only through the access check above (one chat) — across chats they
        // are searched by `GET /spaces/:spaceId/messages/search`, which re-checks permissions
        // (a read row outlives a removed role).
        query.chatId
          ? eq(messages.chatId, query.chatId)
          : sql`not exists (select 1 from chats c where c.id = ${messages.chatId} and c.space_id is not null)`,
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
