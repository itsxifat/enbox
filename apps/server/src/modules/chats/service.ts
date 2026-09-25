/**
 * Chats module service: direct chats, per-member prefs, clear/delete for me, the
 * disappearing timer, member lists, the media gallery and pinned messages.
 * Normative: docs/ARCHITECTURE.md "Chats", "Permissions matrix", mutation → event matrix.
 * Built on the domain primitives in src/services (see services/README.md).
 */
import { and, asc, count, desc, eq, inArray, isNull, lt, ne, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';
import {
  MAX_PINNED_CHATS,
  MAX_PINNED_MESSAGES,
  directChatKey,
  type ChatMember,
  type ChatSummary,
  type Message,
  type MessageSearchResult,
  type chatMediaQuerySchema,
  type updateChatPrefsSchema,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { chatMembers, chatPins, chats, media, messages, starredMessages, type MessageRow } from '../../db/schema.js';
import { badRequest, conflict, limitReached, notFound } from '../../lib/errors.js';
import { storableDate } from '../../lib/validate.js';
import {
  activeMemberRows,
  assertCanSend,
  getChatAccess,
  getMembership,
  lockChat,
  peersWhoBlockedMe,
  requireActiveMember,
  requirePermission,
  visibleTo,
  type ChatAccess,
} from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { mediaUrl } from '../../services/media.js';
import { loadVisibleMessage, toMessages } from '../../services/messages.js';
import { uniq } from '../../services/sql.js';
import { toChatSummaries, toChatSummary } from '../../services/summaries.js';
import { postSystemMessage, systemMessageAllowed } from '../../services/system.js';
import { getUserRow, requireUser, settingsOf, toUserPublicMap } from '../../services/users.js';

export type ChatPrefsPatch = z.output<typeof updateChatPrefsSchema>;
export type ChatMediaQuery = z.output<typeof chatMediaQuerySchema>;
/** The chat part of a `MessageSearchResult` (search, starred list). */
export type ChatPreview = MessageSearchResult['chat'];

async function summaryOrNotFound(viewerId: string, chatId: string): Promise<ChatSummary> {
  const summary = await toChatSummary(db, viewerId, chatId);
  if (!summary) throw notFound('Chat');
  return summary;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

/** `GET /chats`: every non-hidden membership (archived and former included), newest activity first. */
export function listChats(viewerId: string): Promise<ChatSummary[]> {
  return toChatSummaries(db, viewerId);
}

/** `GET /chats/:chatId`: 404 unless the viewer has a non-hidden membership row. */
export function getChat(viewerId: string, chatId: string): Promise<ChatSummary> {
  return summaryOrNotFound(viewerId, chatId);
}

// ---------------------------------------------------------------------------
// Direct chats (docs "Direct chats")
// ---------------------------------------------------------------------------

/**
 * `POST /chats/direct` (idempotent): one chat per user pair (`direct_key`). A new chat gets
 * the caller's row (visible) and the peer's row hidden until the first visible message; no
 * system message and nothing is emitted to the peer. `userId = me` → "Message yourself" (one
 * row). An existing chat hidden for the caller is unhidden (history stays cleared). New
 * chats start with the caller's `defaultDisappearingSeconds`. Unknown users → 404; deleted
 * users → 404 unless a chat with them already exists. Blocks don't prevent opening a chat
 * (sending is gated by `canSend`). Events: JOIN(me) when the chat became visible to me.
 */
export async function openDirectChat(me: string, peerId: string): Promise<ChatSummary> {
  const chatId = await transact(async (tx, fx) => {
    const self = peerId === me;
    const meRow = await requireUser(tx, me);
    const peer = self ? meRow : await getUserRow(tx, peerId);
    if (!peer) throw notFound('User');
    const key = directChatKey(me, peerId);

    const [inserted] = peer.deletedAt
      ? []
      : await tx
          .insert(chats)
          .values({ type: 'direct', directKey: key, createdBy: me, disappearingSeconds: settingsOf(meRow).defaultDisappearingSeconds })
          .onConflictDoNothing({ target: chats.directKey })
          .returning({ id: chats.id });
    let id = inserted?.id;
    if (!id) {
      const [existing] = await tx.select({ id: chats.id }).from(chats).where(eq(chats.directKey, key)).limit(1);
      if (!existing) throw notFound('User'); // deleted account without shared history
      id = existing.id;
    }
    await lockChat(tx, id);

    if (inserted) {
      await tx
        .insert(chatMembers)
        .values([{ chatId: id, userId: me }, ...(self ? [] : [{ chatId: id, userId: peerId, hidden: true }])])
        .onConflictDoNothing();
      fx.join(me, id);
      return id;
    }
    const mine = await getMembership(tx, id, me);
    if (!mine) {
      await tx.insert(chatMembers).values({ chatId: id, userId: me }).onConflictDoNothing();
      fx.join(me, id);
    } else if (mine.hidden) {
      await tx
        .update(chatMembers)
        .set({ hidden: false })
        .where(and(eq(chatMembers.chatId, id), eq(chatMembers.userId, me)));
      fx.join(me, id);
    }
    return id;
  });
  return summaryOrNotFound(me, chatId);
}

// ---------------------------------------------------------------------------
// Prefs, clear, delete for me (docs "Delete / clear / prefs")
// ---------------------------------------------------------------------------

/**
 * Serialize the per-user MAX_PINNED_CHATS check across chats (the chat lock alone only covers
 * one chat): a transaction-scoped advisory lock keyed by the user, taken after the chat lock.
 * Only this code path takes it, so it can never be part of a deadlock cycle (unlike a lock
 * on the `users` row, which profile/account transactions also write).
 */
async function lockPinnedChats(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`enbox:pinned-chats:${userId}`}, 0))`);
}

/**
 * `PATCH /chats/:chatId/prefs`: pin (≤ MAX_PINNED_CHATS → 409 limit_reached), archive, mute
 * until (MUTE_FOREVER_ISO = always, null = unmute), mark unread (never moves the read
 * position). Works for former members too. Events: `chat:upsert` → me.
 */
export async function updatePrefs(me: string, chatId: string, patch: ChatPrefsPatch): Promise<ChatSummary> {
  await transact(async (tx, fx) => {
    const access = await getChatAccess(tx, me, chatId, { lock: true });
    const set: Partial<typeof chatMembers.$inferInsert> = {};
    if (patch.isPinned !== undefined && patch.isPinned !== access.member.isPinned) {
      if (patch.isPinned) {
        await lockPinnedChats(tx, me);
        const [row] = await tx
          .select({ n: count() })
          .from(chatMembers)
          .where(and(eq(chatMembers.userId, me), eq(chatMembers.isPinned, true), ne(chatMembers.chatId, chatId)));
        if ((row?.n ?? 0) >= MAX_PINNED_CHATS) throw limitReached(`You can only pin up to ${MAX_PINNED_CHATS} chats`);
        set.isPinned = true;
        set.pinnedAt = new Date();
      } else {
        set.isPinned = false;
        set.pinnedAt = null;
      }
    }
    if (patch.isArchived !== undefined) set.isArchived = patch.isArchived;
    if (patch.mutedUntil !== undefined) set.mutedUntil = patch.mutedUntil === null ? null : storableDate(patch.mutedUntil, 'mutedUntil');
    if (patch.markedUnread !== undefined) set.markedUnread = patch.markedUnread;
    if (Object.keys(set).length) {
      await tx
        .update(chatMembers)
        .set(set)
        .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, me)));
    }
    if (Object.keys(patch).length) fx.chatUpsert(me, chatId);
  });
  return summaryOrNotFound(me, chatId);
}

/** Remove my stars on messages of the chat with seq ≤ upToSeq (clear / delete chat). */
async function removeStarsUpTo(tx: Tx, userId: string, chatId: string, upToSeq: number): Promise<void> {
  await tx
    .delete(starredMessages)
    .where(
      and(
        eq(starredMessages.userId, userId),
        inArray(
          starredMessages.messageId,
          tx
            .select({ id: messages.id })
            .from(messages)
            .where(and(eq(messages.chatId, chatId), sql`${messages.seq} <= ${upToSeq}`)),
        ),
      ),
    );
}

/** `cleared_seq = chats.last_seq` (monotonic) and my stars in that range removed. */
async function clearHistory(tx: Tx, access: ChatAccess, extra: Partial<typeof chatMembers.$inferInsert> = {}): Promise<number> {
  const clearedSeq = Math.max(Number(access.member.clearedSeq), Number(access.chat.lastSeq));
  await tx
    .update(chatMembers)
    .set({ clearedSeq, ...extra })
    .where(and(eq(chatMembers.chatId, access.chat.id), eq(chatMembers.userId, access.member.userId)));
  await removeStarsUpTo(tx, access.member.userId, access.chat.id, clearedSeq);
  return clearedSeq;
}

/** `POST /chats/:chatId/clear`: clear history for me. Events: `chat:cleared { clearedSeq }` → me. */
export async function clearChat(me: string, chatId: string): Promise<void> {
  await transact(async (tx, fx) => {
    const access = await getChatAccess(tx, me, chatId, { lock: true });
    const clearedSeq = await clearHistory(tx, access);
    fx.toUser(me, 'chat:cleared', { chatId, clearedSeq });
  });
}

/**
 * `DELETE /chats/:chatId`: delete the chat for me = clear + hide (+ unpin, clear
 * marked_unread) and leave the room. Groups only after leaving (409); channels are
 * unfollowed instead (409). History does not come back: a later visible message unhides the
 * chat with only newer messages. Events: room leave → `chat:removed` → me.
 */
export async function deleteChatForMe(me: string, chatId: string): Promise<void> {
  await transact(async (tx, fx) => {
    const access = await getChatAccess(tx, me, chatId, { lock: true });
    if (access.chat.type === 'channel') throw conflict('Unfollow the channel instead');
    if (access.chat.type === 'group' && access.membership === 'active') {
      throw conflict(access.chat.isAnnouncement ? 'Leave the community before deleting this chat' : 'Leave the group before deleting it');
    }
    await clearHistory(tx, access, { hidden: true, isPinned: false, pinnedAt: null, markedUnread: false });
    fx.removeChat(me, chatId);
  });
}

// ---------------------------------------------------------------------------
// Disappearing timer
// ---------------------------------------------------------------------------

/**
 * `PUT /chats/:chatId/disappearing`: active members with `canEditInfo` (direct chats: =
 * canSend, so `403 blocked` when I blocked the peer). Unchanged value → no-op. Events: sys
 * `disappearing_changed` (not channels) → room, then `chat:updated { disappearingSeconds }` → room.
 * Direct chat whose peer blocked me: the change applies, but the system message is withheld
 * from the peer and `chat:updated` skips them (docs "Blocking").
 */
export async function setDisappearing(me: string, chatId: string, seconds: number | null): Promise<ChatSummary> {
  await transact(async (tx, fx) => {
    const access = await requireActiveMember(tx, me, chatId, { lock: true });
    if (access.chat.type === 'direct') assertCanSend(access);
    else requirePermission(access, 'canEditInfo', 'Only admins can change the disappearing messages timer');
    if ((access.chat.disappearingSeconds ?? null) === seconds) return;
    const blockers = await peersWhoBlockedMe(tx, access);
    await tx.update(chats).set({ disappearingSeconds: seconds, updatedAt: new Date() }).where(eq(chats.id, chatId));
    if (systemMessageAllowed(access.chat, 'disappearing_changed')) {
      await postSystemMessage(tx, fx, access.chat, { kind: 'disappearing_changed', actorId: me, seconds });
    }
    fx.chatUpdated(chatId, { disappearingSeconds: seconds }, { exceptUserIds: blockers });
  });
  return summaryOrNotFound(me, chatId);
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

const ROLE_RANK = { owner: 0, admin: 1, member: 2 } as const;

/**
 * `GET /chats/:chatId/members`: active members (channels: followers) — owner, admins, then
 * members, each by join time. Requires `canViewMembers` (channels/announcement groups:
 * admins only → 403); former members → 403 not_member.
 */
export async function listMembers(me: string, chatId: string): Promise<ChatMember[]> {
  const access = await requireActiveMember(db, me, chatId);
  requirePermission(access, 'canViewMembers', 'Only admins can see the member list');
  const rows = await activeMemberRows(db, chatId);
  const users = await toUserPublicMap(
    db,
    me,
    rows.map((r) => r.userId),
  );
  return [...rows]
    .sort((a, b) => ROLE_RANK[a.role] - ROLE_RANK[b.role])
    .filter((r) => users.has(r.userId))
    .map((r) => ({ user: users.get(r.userId)!, role: r.role, joinedAt: r.joinedAt.toISOString() }));
}

// ---------------------------------------------------------------------------
// Media gallery
// ---------------------------------------------------------------------------

/** Messages containing a link (`http(s)://…` or `www.…`). */
const LINK_PATTERN = '(https?://|www\\.)[^[:space:]]+';

function mediaKindCondition(kind: ChatMediaQuery['kind']): SQL {
  switch (kind) {
    case 'media':
      return and(inArray(messages.type, ['image', 'video']), sql`${messages.mediaId} is not null`)!;
    case 'docs':
      return and(inArray(messages.type, ['file', 'audio']), sql`${messages.mediaId} is not null`)!;
    case 'voice':
      return and(eq(messages.type, 'voice'), sql`${messages.mediaId} is not null`)!;
    case 'links':
      return and(sql`${messages.type} not in ('system', 'call')`, sql`${messages.text} ~* ${LINK_PATTERN}`)!;
  }
}

/**
 * `GET /chats/:chatId/media`: the shared-media gallery, newest first (`before` = exclusive
 * seq cursor; fewer than `limit` results = end). Kinds: `media` = images/videos, `docs` =
 * files and audio files, `voice` = voice notes, `links` = messages whose text/caption has a
 * link. Only messages visible to the viewer (former members: their window), not deleted.
 */
export async function listChatMedia(me: string, chatId: string, query: ChatMediaQuery): Promise<Message[]> {
  const access = await getChatAccess(db, me, chatId);
  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.chatId, chatId),
        visibleTo(access.window),
        isNull(messages.deletedAt),
        mediaKindCondition(query.kind),
        query.before !== undefined ? lt(messages.seq, query.before) : undefined,
      ),
    )
    .orderBy(desc(messages.seq))
    .limit(query.limit);
  return toMessages(db, me, rows, { chatTypes: new Map([[chatId, access.chat.type]]) });
}

// ---------------------------------------------------------------------------
// Pins (docs "Pins and disappearing messages")
// ---------------------------------------------------------------------------

/** Pinned messages visible to the viewer, oldest pin first (same order as `chat:pins`). */
async function visiblePins(dbx: DbOrTx, viewerId: string, access: ChatAccess): Promise<Message[]> {
  const rows = await dbx
    .select({ message: messages })
    .from(chatPins)
    .innerJoin(messages, eq(messages.id, chatPins.messageId))
    .where(and(eq(chatPins.chatId, access.chat.id), visibleTo(access.window)))
    .orderBy(asc(chatPins.createdAt), asc(chatPins.messageId));
  return toMessages(
    dbx,
    viewerId,
    rows.map((r) => r.message),
    { chatTypes: new Map([[access.chat.id, access.chat.type]]) },
  );
}

/** `GET /chats/:chatId/pins` (active members; former → 403 not_member). */
export async function listPins(me: string, chatId: string): Promise<Message[]> {
  const access = await requireActiveMember(db, me, chatId);
  return visiblePins(db, me, access);
}

/**
 * `POST /chats/:chatId/pins`: `canPin`; the message must be in the chat, visible to me, not
 * deleted, not system/call. At most MAX_PINNED_MESSAGES: pinning another replaces the oldest.
 * Already pinned → no-op. Events: sys `message_pinned` (not channels) → room, `chat:pins` → room.
 * Direct chat whose peer blocked me: both skip the peer (docs "Blocking").
 */
export async function pinMessage(me: string, chatId: string, messageId: string): Promise<Message[]> {
  await transact(async (tx, fx) => {
    const access = await requireActiveMember(tx, me, chatId, { lock: true });
    requirePermission(access, 'canPin', 'Only admins can pin messages');
    const { message } = await loadVisibleMessage(tx, me, messageId, { chatId });
    if (message.deletedAt || message.type === 'system' || message.type === 'call') throw badRequest('This message cannot be pinned');
    const pins = await tx
      .select({ messageId: chatPins.messageId, createdAt: chatPins.createdAt })
      .from(chatPins)
      .where(eq(chatPins.chatId, chatId))
      .orderBy(asc(chatPins.createdAt), asc(chatPins.messageId));
    if (pins.some((p) => p.messageId === messageId)) return;
    const excess = pins.length - MAX_PINNED_MESSAGES + 1;
    if (excess > 0) {
      await tx.delete(chatPins).where(
        and(
          eq(chatPins.chatId, chatId),
          inArray(
            chatPins.messageId,
            pins.slice(0, excess).map((p) => p.messageId),
          ),
        ),
      );
    }
    // Strictly after the newest pin so "oldest pin" is well defined even within one millisecond.
    const newest = pins.at(-1)?.createdAt.getTime() ?? 0;
    await tx.insert(chatPins).values({ chatId, messageId, pinnedBy: me, createdAt: new Date(Math.max(Date.now(), newest + 1)) });
    if (systemMessageAllowed(access.chat, 'message_pinned')) {
      await postSystemMessage(tx, fx, access.chat, { kind: 'message_pinned', actorId: me, messageId });
    }
    fx.chatPins(chatId, { exceptUserIds: await peersWhoBlockedMe(tx, access) });
  });
  return listPins(me, chatId);
}

/**
 * `DELETE /chats/:chatId/pins/:messageId`: `canPin`; not pinned → no-op. Events: `chat:pins` →
 * room (direct chat whose peer blocked me: not to the peer).
 */
export async function unpinMessage(me: string, chatId: string, messageId: string): Promise<Message[]> {
  await transact(async (tx, fx) => {
    const access = await requireActiveMember(tx, me, chatId, { lock: true });
    requirePermission(access, 'canPin', 'Only admins can unpin messages');
    const removed = await tx
      .delete(chatPins)
      .where(and(eq(chatPins.chatId, chatId), eq(chatPins.messageId, messageId)))
      .returning({ messageId: chatPins.messageId });
    if (removed.length) fx.chatPins(chatId, { exceptUserIds: await peersWhoBlockedMe(tx, access) });
  });
  return listPins(me, chatId);
}

// ---------------------------------------------------------------------------
// Chat previews (search results, starred list)
// ---------------------------------------------------------------------------

/**
 * `Pick<ChatSummary, 'id' | 'type' | 'name' | 'avatarUrl' | 'peer'>` for many chats as seen by
 * the viewer, in a fixed number of queries (chats, direct members, peer users).
 */
export async function chatPreviews(dbx: DbOrTx, viewerId: string, chatIds: Iterable<string>): Promise<Map<string, ChatPreview>> {
  const ids = uniq(chatIds);
  const out = new Map<string, ChatPreview>();
  if (ids.length === 0) return out;
  const rows = await dbx
    .select({ id: chats.id, type: chats.type, name: chats.name, avatarKey: media.storageKey })
    .from(chats)
    .leftJoin(media, eq(media.id, chats.avatarMediaId))
    .where(inArray(chats.id, ids));
  const directIds = rows.filter((r) => r.type === 'direct').map((r) => r.id);
  const peerOf = new Map<string, string>();
  if (directIds.length) {
    const members = await dbx
      .select({ chatId: chatMembers.chatId, userId: chatMembers.userId })
      .from(chatMembers)
      .where(inArray(chatMembers.chatId, directIds));
    for (const id of directIds) {
      peerOf.set(id, members.find((m) => m.chatId === id && m.userId !== viewerId)?.userId ?? viewerId);
    }
  }
  const peers = await toUserPublicMap(dbx, viewerId, peerOf.values());
  for (const r of rows) {
    const direct = r.type === 'direct';
    out.set(r.id, {
      id: r.id,
      type: r.type,
      name: direct ? null : r.name,
      avatarUrl: !direct && r.avatarKey ? mediaUrl(r.avatarKey) : null,
      peer: direct ? (peers.get(peerOf.get(r.id)!) ?? null) : null,
    });
  }
  return out;
}

/** Serialize rows as `MessageSearchResult[]` (viewer-specific messages + chat previews), input order. */
export async function toSearchResults(dbx: DbOrTx, viewerId: string, rows: MessageRow[]): Promise<MessageSearchResult[]> {
  if (rows.length === 0) return [];
  const previews = await chatPreviews(
    dbx,
    viewerId,
    rows.map((r) => r.chatId),
  );
  const chatTypes = new Map([...previews.values()].map((p) => [p.id, p.type]));
  const serialized = await toMessages(dbx, viewerId, rows, { chatTypes });
  return serialized.filter((m) => previews.has(m.chatId)).map((message) => ({ message, chat: previews.get(message.chatId)! }));
}
