/**
 * Chats: row locks, membership lookups, the message-visibility SQL fragment, permissions
 * and access guards. The viewer-specific `ChatSummary` serializer lives in summaries.ts.
 */
import { and, asc, eq, inArray, isNull, ne, sql, type SQL } from 'drizzle-orm';
import {
  computeChatPermissions,
  type ChatKind,
  type ChatPermissions,
  type MemberRole,
  type Membership,
} from '@enbox/shared';
import type { DbOrTx } from '../db/index.js';
import { blocks, chatMembers, chats, messageHidden, messages, users, type ChatMemberRow, type ChatRow } from '../db/schema.js';
import { blocked as blockedError, forbidden, notFound, notMember } from '../lib/errors.js';
import { uniq } from './sql.js';

// ---------------------------------------------------------------------------
// Locks (docs "Transactions": communities → chats (sorted) → calls → everything else)
// ---------------------------------------------------------------------------

/**
 * `SELECT … FROM chats WHERE id IN (…) ORDER BY id FOR UPDATE`: locks the chat rows in
 * sorted id order (deadlock-free across transactions) and returns the fresh rows, sorted by
 * id. Missing ids are simply absent. Re-locking a row already locked by this tx is a no-op,
 * so helpers may call it defensively to get the current row (e.g. the new `last_seq`).
 */
export async function lockChats(tx: DbOrTx, chatIds: Iterable<string>): Promise<ChatRow[]> {
  const ids = uniq(chatIds).sort();
  if (ids.length === 0) return [];
  return tx.select().from(chats).where(inArray(chats.id, ids)).orderBy(asc(chats.id)).for('update');
}

/** Lock one chat row; 404 when it doesn't exist. */
export async function lockChat(tx: DbOrTx, chatId: string): Promise<ChatRow> {
  const [row] = await lockChats(tx, [chatId]);
  if (!row) throw notFound('Chat');
  return row;
}

// ---------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------

export async function getChat(dbx: DbOrTx, chatId: string): Promise<ChatRow | null> {
  const [row] = await dbx.select().from(chats).where(eq(chats.id, chatId)).limit(1);
  return row ?? null;
}

/** The chat row or 404. (Existence only — pair with a membership check before revealing anything.) */
export async function requireChat(dbx: DbOrTx, chatId: string): Promise<ChatRow> {
  const row = await getChat(dbx, chatId);
  if (!row) throw notFound('Chat');
  return row;
}

/** The user's membership row (active, former or hidden), or null. */
export async function getMembership(dbx: DbOrTx, chatId: string, userId: string): Promise<ChatMemberRow | null> {
  const [row] = await dbx
    .select()
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

/** Ids of the active members/followers (hidden rows included: they are still members). */
export async function activeMemberIds(dbx: DbOrTx, chatId: string): Promise<string[]> {
  const rows = await dbx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), isNull(chatMembers.leftAt)));
  return rows.map((r) => r.userId);
}

export async function activeMemberRows(dbx: DbOrTx, chatId: string): Promise<ChatMemberRow[]> {
  return dbx
    .select()
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), isNull(chatMembers.leftAt)))
    .orderBy(asc(chatMembers.joinedAt), asc(chatMembers.userId));
}

/** `ChatSummary.memberCount`: active members (channels: followers incl. owner/admins). */
export async function activeMemberCount(dbx: DbOrTx, chatId: string): Promise<number> {
  const [row] = await dbx
    .select({ n: sql<number>`count(*)::int` })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), isNull(chatMembers.leftAt)));
  return Number(row?.n ?? 0);
}

/** Active owner + admins (channel / announcement `chat:members-changed` recipients). */
export async function adminIds(dbx: DbOrTx, chatId: string): Promise<string[]> {
  const rows = await dbx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), isNull(chatMembers.leftAt), inArray(chatMembers.role, ['owner', 'admin'])));
  return rows.map((r) => r.userId);
}

/** The active owner's id, or null (groups can be ownerless only transiently / when empty). */
export async function ownerId(dbx: DbOrTx, chatId: string): Promise<string | null> {
  const [row] = await dbx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), isNull(chatMembers.leftAt), eq(chatMembers.role, 'owner')))
    .limit(1);
  return row?.userId ?? null;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

export function membershipOf(member: Pick<ChatMemberRow, 'leftAt' | 'leftReason'>): Membership {
  if (!member.leftAt) return 'active';
  return member.leftReason === 'removed' ? 'removed' : 'left';
}

export function isActive(member: Pick<ChatMemberRow, 'leftAt'> | null | undefined): member is ChatMemberRow {
  return !!member && !member.leftAt;
}

export function isAdminRole(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** Wording kind of a chat row ('announcement' for community announcement groups). */
export function chatKindOfRow(chat: Pick<ChatRow, 'type' | 'isAnnouncement'>): ChatKind {
  return chat.type === 'group' && chat.isAnnouncement ? 'announcement' : chat.type;
}

// ---------------------------------------------------------------------------
// Visibility (docs "Message visibility")
// ---------------------------------------------------------------------------

/**
 * A member's visible window. Message m (seq s) is visible when s > joinedSeq, s > clearedSeq,
 * (leftSeq null or s <= leftSeq), no message_hidden row for (userId, m) and m not expired.
 * `userId: null` (e.g. a public-channel preview for a non-follower) skips the hidden check.
 */
export interface VisibilityWindow {
  userId: string | null;
  joinedSeq: number;
  clearedSeq: number;
  leftSeq: number | null;
}

/** Full-history window of a non-member (public channel previews). */
export const PUBLIC_WINDOW: Readonly<VisibilityWindow> = Object.freeze({ userId: null, joinedSeq: 0, clearedSeq: 0, leftSeq: null });

export function windowOf(member: Pick<ChatMemberRow, 'userId' | 'joinedSeq' | 'clearedSeq' | 'leftSeq'>): VisibilityWindow {
  return { userId: member.userId, joinedSeq: Number(member.joinedSeq), clearedSeq: Number(member.clearedSeq), leftSeq: member.leftSeq == null ? null : Number(member.leftSeq) };
}

/** Highest seq a member may ever see (their window end): chat.lastSeq, or left_seq for former members. */
export function windowEnd(chat: Pick<ChatRow, 'lastSeq'>, member: Pick<ChatMemberRow, 'leftSeq'> | null): number {
  return member?.leftSeq != null ? Number(member.leftSeq) : Number(chat.lastSeq);
}

/**
 * `visibleTo(window)`: THE visibility condition on the `messages` table (drizzle queries that
 * select from `messages` without an alias). Every listing uses it: history, search, media,
 * pins, starred, lastMessage, unread counts, loadVisibleMessage.
 */
export function visibleTo(w: VisibilityWindow): SQL {
  const parts: SQL[] = [
    sql`${messages.seq} > ${Math.max(w.joinedSeq, w.clearedSeq)}`,
    sql`(${messages.expiresAt} is null or ${messages.expiresAt} > now())`,
  ];
  if (w.leftSeq != null) parts.push(sql`${messages.seq} <= ${w.leftSeq}`);
  if (w.userId) {
    parts.push(
      sql`not exists (select 1 from ${messageHidden} where ${messageHidden.userId} = ${w.userId} and ${messageHidden.messageId} = ${messages.id})`,
    );
  }
  return sql`(${sql.join(parts, sql` and `)})`;
}

/**
 * The same condition for raw SQL that joins `messages` (alias `m`) with the member's
 * `chat_members` row (alias `cm`) — batch queries over many (chat, member) pairs.
 */
export function memberVisibleSql(m = 'm', cm = 'cm'): SQL {
  return sql.raw(
    `(${m}.seq > greatest(${cm}.joined_seq, ${cm}.cleared_seq)` +
      ` and (${cm}.left_seq is null or ${m}.seq <= ${cm}.left_seq)` +
      ` and (${m}.expires_at is null or ${m}.expires_at > now())` +
      ` and not exists (select 1 from message_hidden mh where mh.user_id = ${cm}.user_id and mh.message_id = ${m}.id))`,
  );
}

/**
 * For `chat:pins`: the active, non-hidden members that have a `message_hidden` row (deleted
 * for me / withheld) on some of `messageIds`, with those ids. One query.
 */
export async function hiddenPinsByMember(dbx: DbOrTx, chatId: string, messageIds: string[]): Promise<Map<string, Set<string>>> {
  const out = new Map<string, Set<string>>();
  if (messageIds.length === 0) return out;
  const rows = await dbx
    .select({ userId: messageHidden.userId, messageId: messageHidden.messageId })
    .from(messageHidden)
    .innerJoin(chatMembers, and(eq(chatMembers.userId, messageHidden.userId), eq(chatMembers.chatId, chatId)))
    .where(and(inArray(messageHidden.messageId, messageIds), isNull(chatMembers.leftAt), eq(chatMembers.hidden, false)));
  for (const r of rows) {
    let set = out.get(r.userId);
    if (!set) out.set(r.userId, (set = new Set()));
    set.add(r.messageId);
  }
  return out;
}

/** Highest visible seq in the window (≤ `upTo` when given), or null when nothing is visible. */
export async function maxVisibleSeq(dbx: DbOrTx, chatId: string, w: VisibilityWindow, upTo?: number): Promise<number | null> {
  const [row] = await dbx
    .select({ seq: messages.seq })
    .from(messages)
    .where(and(eq(messages.chatId, chatId), visibleTo(w), upTo !== undefined ? sql`${messages.seq} <= ${upTo}` : undefined))
    .orderBy(sql`${messages.seq} desc`)
    .limit(1);
  return row ? Number(row.seq) : null;
}

// ---------------------------------------------------------------------------
// Permissions & access guards
// ---------------------------------------------------------------------------

/** Direct-chat peer facts needed by the permissions matrix. */
export interface PeerInfo {
  id: string;
  /** The VIEWER blocked the peer. */
  isBlocked: boolean;
  isDeleted: boolean;
}

/**
 * `ChatSummary.permissions` for a viewer, via the shared `computeChatPermissions` (server
 * guards and clients agree by construction). Former members get all false.
 */
export function computePermissions(
  chat: Pick<ChatRow, 'type' | 'isAnnouncement' | 'groupSettings' | 'channelSettings'>,
  member: Pick<ChatMemberRow, 'role' | 'leftAt' | 'leftReason'>,
  peer: PeerInfo | null,
  viewerId: string,
): ChatPermissions {
  return computeChatPermissions(
    {
      type: chat.type,
      isAnnouncement: chat.isAnnouncement,
      myRole: member.leftAt ? 'member' : member.role,
      membership: membershipOf(member),
      groupSettings: chat.type === 'group' ? chat.groupSettings : null,
      channelSettings: chat.type === 'channel' ? chat.channelSettings : null,
      peer,
    },
    viewerId,
  );
}

/** Everything a route guard needs about the viewer in a chat. */
export interface ChatAccess {
  chat: ChatRow;
  member: ChatMemberRow;
  membership: Membership;
  permissions: ChatPermissions;
  /** Direct chats: the other participant (the viewer in a self chat); null otherwise. */
  peer: PeerInfo | null;
  /** The viewer's visibility window. */
  window: VisibilityWindow;
}

/** Load the direct-chat peer facts for a viewer (self chat → the viewer). */
export async function loadPeerInfo(dbx: DbOrTx, chatId: string, viewerId: string): Promise<PeerInfo> {
  const [other] = await dbx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chatId), ne(chatMembers.userId, viewerId)))
    .limit(1);
  const peerId = other?.userId ?? viewerId;
  if (peerId === viewerId) return { id: viewerId, isBlocked: false, isDeleted: false };
  const [u] = await dbx.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, peerId)).limit(1);
  const [b] = await dbx
    .select({ x: sql<number>`1` })
    .from(blocks)
    .where(and(eq(blocks.blockerId, viewerId), eq(blocks.blockedId, peerId)))
    .limit(1);
  return { id: peerId, isBlocked: !!b, isDeleted: !!u?.deletedAt };
}

export interface ChatAccessOptions {
  /** Accept a hidden ("deleted for me") row instead of 404. */
  allowHidden?: boolean;
  /** Lock the chat row first (`lockChat`) so the checks hold for the rest of the transaction. */
  lock?: boolean;
  /** The chat row, when the caller already holds (locked) it. */
  chat?: ChatRow;
}

/**
 * The viewer's access to a chat. 404 when the chat doesn't exist, the viewer has no
 * membership row, or the row is hidden ("deleted for me") unless `allowHidden`. Former
 * members get an access object with `membership !== 'active'` and all permissions false (see
 * requireActiveMember). In mutations pass `lock: true` (or a locked `chat`) so permission and
 * membership checks happen under the chat lock.
 */
export async function getChatAccess(dbx: DbOrTx, viewerId: string, chatId: string, opts: ChatAccessOptions = {}): Promise<ChatAccess> {
  let chat = opts.chat ?? (opts.lock ? await lockChat(dbx, chatId) : undefined);
  let member: ChatMemberRow | undefined;
  if (chat) {
    member = (await getMembership(dbx, chatId, viewerId)) ?? undefined;
  } else {
    const [row] = await dbx
      .select({ chat: chats, member: chatMembers })
      .from(chatMembers)
      .innerJoin(chats, eq(chats.id, chatMembers.chatId))
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, viewerId)))
      .limit(1);
    chat = row?.chat;
    member = row?.member;
  }
  if (!chat || !member || (member.hidden && !opts.allowHidden)) throw notFound('Chat');
  const peer = chat.type === 'direct' ? await loadPeerInfo(dbx, chatId, viewerId) : null;
  return {
    chat,
    member,
    membership: membershipOf(member),
    permissions: computePermissions(chat, member, peer, viewerId),
    peer,
    window: windowOf(member),
  };
}

/** Like getChatAccess, plus `403 not_member` for former members (members, pins, invite, calls, message mutations). */
export async function requireActiveMember(dbx: DbOrTx, viewerId: string, chatId: string, opts: ChatAccessOptions = {}): Promise<ChatAccess> {
  const access = await getChatAccess(dbx, viewerId, chatId, opts);
  if (access.membership !== 'active') throw notMember();
  return access;
}

/**
 * Guard for sending/forwarding into a chat (docs "Send", "Blocking"): 403 `blocked`
 * ("Unblock to send") when I blocked the direct-chat peer, 403 `forbidden` when the peer is
 * deleted or `permissions.canSend` is false. (A peer who blocked ME is never revealed: the
 * send succeeds and is withheld.)
 */
export function assertCanSend(access: ChatAccess): void {
  if (access.membership !== 'active') throw notMember();
  if (access.chat.type === 'direct' && access.peer && access.peer.id !== access.member.userId) {
    if (access.peer.isBlocked) throw blockedError('Unblock this contact to send a message');
    if (access.peer.isDeleted) throw forbidden('This account was deleted');
  }
  if (!access.permissions.canSend) throw forbidden('Only admins can send messages');
}

/**
 * Direct chats: `[peerId]` when the peer blocked the viewer (the viewer's timer changes, pins,
 * edits, reactions and votes must not reach them — docs "Blocking"), else `[]`. Use as the
 * `exceptUserIds` of the room events such a mutation registers.
 */
export async function peersWhoBlockedMe(dbx: DbOrTx, access: Pick<ChatAccess, 'chat' | 'member' | 'peer'>): Promise<string[]> {
  const me = access.member.userId;
  if (access.chat.type !== 'direct' || !access.peer || access.peer.id === me) return [];
  const [row] = await dbx
    .select({ x: sql<number>`1` })
    .from(blocks)
    .where(and(eq(blocks.blockerId, access.peer.id), eq(blocks.blockedId, me)))
    .limit(1);
  return row ? [access.peer.id] : [];
}

/** 403 unless the viewer has `perm` (not_member for former members). */
export function requirePermission(access: ChatAccess, perm: keyof ChatPermissions, message?: string): void {
  if (access.membership !== 'active') throw notMember();
  if (!access.permissions[perm]) throw forbidden(message);
}
