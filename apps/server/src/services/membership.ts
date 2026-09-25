/**
 * Membership transitions (docs "Membership transitions (normative)"). ALL chat_members
 * state changes for groups, announcement groups and channels go through
 * `upsertMembership(tx, fx, change)`, which locks the chat, writes the rows and registers the
 * fan-out prefix/suffix in matrix order:
 *
 * - activate (add / join / rejoin / follow / group creation):
 *     system message S created FIRST (if any) → rows upserted with joined_seq = S.seq − 1
 *     (group creation: 0; announcement groups without S: chats.last_seq; channels: 0 with
 *     read = delivered = chats.last_seq) → effects: JOIN(u) per user, then S's message:new.
 * - deactivate (leave / remove; groups and announcement groups):
 *     S first (member_left / member_removed) → left_at, left_seq = S.seq (no S: last_seq),
 *     left_reason, role 'member' → ownership succession (owner_changed after S) → effects:
 *     S's message:new (u still in the room) → [owner_changed message:new, u excluded] →
 *     LEAVE(u) (chat:upsert → u, then room leave; `hide` → room leave + chat:removed) →
 *     domain `member.left` (forced call leave) → chat:upsert → new owner.
 * - unfollow (channels): row deleted → room leave + chat:removed → u.
 *
 * NOT registered here (the module adds them per the matrix, after the call):
 * `fx.memberCountChanged(c)`, `fx.membersChanged(chat)`, community cascade/upserts.
 * Capacity (MAX_GROUP_MEMBERS) and permission checks are the caller's, after the lock.
 */
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import type { MemberRole, SystemEvent } from '@enbox/shared';
import type { DbOrTx, Tx } from '../db/index.js';
import { chatMembers, communities, type ChatRow, type MessageRow } from '../db/schema.js';
import { conflict, forbidden, notFound } from '../lib/errors.js';
import { activeMemberIds, getMembership, lockChat, ownerId } from './chats.js';
import type { Effects } from './effects.js';
import { uniq } from './sql.js';
import { insertSystemMessage, postSystemMessage, systemMessageAllowed } from './system.js';
import { blockedEitherWayIds, getUserRows, lockLiveUsers, ownersWhoSaved, settingsOf } from './users.js';

export type MembershipChange =
  | {
      kind: 'activate';
      chatId: string;
      userIds: string[];
      /** Role for every user (default 'member'); per-user overrides in `roles` (e.g. the creator: owner). */
      role?: MemberRole;
      roles?: Record<string, MemberRole>;
      addedBy?: string | null;
      /**
       * members_added / member_joined_via_link / member_joined — created FIRST so the new
       * members see it (joined_seq = S.seq − 1). Omit for announcement groups and channels.
       */
      systemEvent?: SystemEvent | null;
      /** Group creation: joined_seq = 0 for the initial members (they see group_created, posted after this call). */
      initial?: boolean;
    }
  | {
      kind: 'deactivate';
      chatId: string;
      userId: string;
      reason: 'left' | 'removed';
      /** member_left / member_removed (regular groups). Omit for announcement groups. */
      systemEvent?: SystemEvent | null;
      /** Also hide the row (announcement group when leaving the community): chat:removed instead of chat:upsert. */
      hide?: boolean;
      /** Owner succession when the owner leaves (default: regular groups only; communities mirror their own). */
      succession?: boolean;
    }
  | { kind: 'unfollow'; chatId: string; userId: string };

export interface MembershipResult {
  /** The chat row as of the end of the change (current last_seq). */
  chat: ChatRow;
  /** Users whose membership changed. */
  userIds: string[];
  /** The join/leave system message, if one was created. */
  systemMessage: MessageRow | null;
  /** Deactivate: the member promoted by succession, if any. */
  newOwnerId: string | null;
}

/** The single membership write path (see module doc). Call inside `transact`. */
export async function upsertMembership(tx: Tx, fx: Effects, change: MembershipChange): Promise<MembershipResult> {
  switch (change.kind) {
    case 'activate':
      return activate(tx, fx, change);
    case 'deactivate':
      return deactivate(tx, fx, change);
    case 'unfollow':
      return unfollow(tx, fx, change);
  }
}

async function activate(tx: Tx, fx: Effects, change: Extract<MembershipChange, { kind: 'activate' }>): Promise<MembershipResult> {
  let chat = await lockChat(tx, change.chatId);
  if (chat.type === 'direct') throw new Error('upsertMembership: direct chats have fixed members');
  // Accounts deleted meanwhile (the caller's checks ran before the deletion committed) are
  // dropped: `lockLiveUsers` waits for a concurrent deletion and re-checks deleted_at.
  const live = await lockLiveUsers(tx, change.userIds);
  const ids = uniq(change.userIds).filter((id) => live.has(id));
  if (ids.length === 0) return { chat, userIds: [], systemMessage: null, newOwnerId: null };
  let systemEvent = change.systemEvent ?? null;
  if (systemEvent?.kind === 'members_added') systemEvent = { ...systemEvent, userIds: systemEvent.userIds.filter((id) => live.has(id)) };

  const existing = await tx
    .select({ userId: chatMembers.userId, leftAt: chatMembers.leftAt })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chat.id), inArray(chatMembers.userId, ids)));
  if (existing.some((r) => !r.leftAt)) throw conflict('Already a member');

  const sys = systemEvent ? await insertSystemMessage(tx, chat, systemEvent) : null;
  if (sys) chat = sys.chat;
  const joinedSeq = change.initial || chat.type === 'channel' ? 0 : sys ? Number(sys.message.seq) - 1 : Number(chat.lastSeq);
  const marks = chat.type === 'channel' ? Number(chat.lastSeq) : joinedSeq;
  const now = new Date();

  await tx
    .insert(chatMembers)
    .values(
      ids.map((userId) => ({
        chatId: chat.id,
        userId,
        role: change.roles?.[userId] ?? change.role ?? 'member',
        addedBy: change.addedBy ?? null,
        joinedAt: now,
        joinedSeq,
        lastReadSeq: marks,
        lastDeliveredSeq: marks,
      })),
    )
    .onConflictDoUpdate({
      target: [chatMembers.chatId, chatMembers.userId],
      // Rejoin: a new window; pin/archive/mute prefs are kept.
      set: {
        role: sql`excluded.role`,
        addedBy: sql`excluded.added_by`,
        joinedAt: sql`excluded.joined_at`,
        joinedSeq: sql`excluded.joined_seq`,
        lastReadSeq: sql`excluded.last_read_seq`,
        lastReadAt: null,
        lastDeliveredSeq: sql`excluded.last_delivered_seq`,
        lastDeliveredAt: null,
        leftAt: null,
        leftSeq: null,
        leftReason: null,
        hidden: false,
        markedUnread: false,
      },
    });

  // Rule 2: JOIN(u) for every new member, THEN the system message's message:new.
  for (const userId of ids) fx.join(userId, chat.id);
  sys?.publish(fx);
  return { chat, userIds: ids, systemMessage: sys?.message ?? null, newOwnerId: null };
}

async function deactivate(tx: Tx, fx: Effects, change: Extract<MembershipChange, { kind: 'deactivate' }>): Promise<MembershipResult> {
  let chat = await lockChat(tx, change.chatId);
  if (chat.type !== 'group') throw new Error('upsertMembership: deactivate is for groups (channels: unfollow)');
  const member = await getMembership(tx, chat.id, change.userId);
  if (!member || member.leftAt) throw notFound('Member');

  let sys: MessageRow | null = null;
  if (change.systemEvent) {
    const inserted = await insertSystemMessage(tx, chat, change.systemEvent);
    inserted.publish(fx); // message:new while u is still in the room (rule 3)
    sys = inserted.message;
    chat = inserted.chat;
  }
  const leftSeq = sys ? Number(sys.seq) : Number(chat.lastSeq);
  await tx
    .update(chatMembers)
    .set({ leftAt: new Date(), leftSeq, leftReason: change.reason, role: 'member', ...(change.hide ? { hidden: true } : {}) })
    .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, change.userId)));

  let newOwnerId: string | null = null;
  const succession = change.succession ?? !chat.isAnnouncement;
  if (member.role === 'owner' && succession) {
    newOwnerId = await ensureOwner(tx, fx, chat.id, { exceptUserIds: [change.userId] });
    chat = await lockChat(tx, chat.id);
  }

  if (change.hide) fx.removeChat(change.userId, chat.id);
  else fx.leave(change.userId, chat.id);
  fx.domain('member.left', { chatId: chat.id, userId: change.userId, reason: change.reason });
  if (newOwnerId) fx.chatUpsert(newOwnerId, chat.id);
  fx.watermarks({
    chatId: chat.id,
    members: [{ userId: change.userId, prev: { read: Number(member.lastReadSeq), delivered: Number(member.lastDeliveredSeq) } }],
  });
  return { chat, userIds: [change.userId], systemMessage: sys, newOwnerId };
}

async function unfollow(tx: Tx, fx: Effects, change: Extract<MembershipChange, { kind: 'unfollow' }>): Promise<MembershipResult> {
  const chat = await lockChat(tx, change.chatId);
  if (chat.type !== 'channel') throw new Error('upsertMembership: unfollow is for channels');
  const member = await getMembership(tx, chat.id, change.userId);
  if (!member || member.leftAt) throw notFound('Channel');
  if (member.role === 'owner') throw conflict('Transfer ownership or delete the channel before unfollowing');
  await tx.delete(chatMembers).where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, change.userId)));
  fx.removeChat(change.userId, chat.id);
  fx.domain('member.left', { chatId: chat.id, userId: change.userId, reason: 'unfollowed' });
  return { chat, userIds: [change.userId], systemMessage: null, newOwnerId: null };
}

/**
 * Ownership succession (docs): if the chat has no active owner, promote the oldest admin (by
 * joined_at), else — groups only — the oldest active member. Regular groups get an
 * `owner_changed { userId }` system message (registered now; `exceptUserIds` = members that
 * left earlier in this tx). Channels (account deletion): admins only — null means "no
 * admin: delete the channel". Returns the promoted user, or null (owner exists / nobody left).
 * The caller registers `fx.chatUpsert(newOwner, chatId)` (after LEAVE, per the matrix).
 */
export async function ensureOwner(
  tx: Tx,
  fx: Effects,
  chatId: string,
  opts: { exceptUserIds?: string[]; systemMessage?: boolean } = {},
): Promise<string | null> {
  const chat = await lockChat(tx, chatId);
  if (chat.type === 'direct') return null;
  if (await ownerId(tx, chat.id)) return null;
  const [candidate] = await tx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(
      and(
        eq(chatMembers.chatId, chat.id),
        isNull(chatMembers.leftAt),
        chat.type === 'channel' ? eq(chatMembers.role, 'admin') : undefined,
      ),
    )
    .orderBy(desc(sql`${chatMembers.role} = 'admin'`), asc(chatMembers.joinedAt), asc(chatMembers.userId))
    .limit(1);
  if (!candidate) return null;
  await tx
    .update(chatMembers)
    .set({ role: 'owner' })
    .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, candidate.userId)));
  const withMessage = opts.systemMessage ?? systemMessageAllowed(chat, 'owner_changed');
  if (withMessage) {
    await postSystemMessage(tx, fx, chat, { kind: 'owner_changed', userId: candidate.userId }, { exceptUserIds: opts.exceptUserIds });
  }
  return candidate.userId;
}

/**
 * Promote/demote an active member (never the owner: 403). Registers the optional system
 * message (admin_promoted / admin_demoted, where allowed) → room and `chat:upsert` → u.
 * The caller adds `fx.membersChanged(chat)` (and community upserts). Returns false when the
 * role was already `role`.
 */
export async function changeRole(
  tx: Tx,
  fx: Effects,
  input: { chatId: string; userId: string; role: 'admin' | 'member'; systemEvent?: SystemEvent | null },
): Promise<boolean> {
  const chat = await lockChat(tx, input.chatId);
  const member = await getMembership(tx, chat.id, input.userId);
  if (!member || member.leftAt) throw notFound('Member');
  if (member.role === 'owner') throw forbidden('The owner cannot be demoted');
  if (member.role === input.role) return false;
  if (input.systemEvent && systemMessageAllowed(chat, input.systemEvent.kind)) await postSystemMessage(tx, fx, chat, input.systemEvent);
  await tx
    .update(chatMembers)
    .set({ role: input.role })
    .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, input.userId)));
  fx.chatUpsert(input.userId, chat.id);
  return true;
}

/**
 * Explicit ownership transfer (docs): `from` must be the active owner (403), `to` an active
 * member/follower (404). Demotes the old owner to admin in one statement, THEN promotes the
 * new one (per-row unique owner index). Registers the optional `owner_transferred` system
 * message → room, then `chat:upsert` → old and new owner. Caller adds `fx.membersChanged`.
 */
export async function transferOwnership(
  tx: Tx,
  fx: Effects,
  input: { chatId: string; fromUserId: string; toUserId: string; systemEvent?: SystemEvent | null },
): Promise<void> {
  const chat = await lockChat(tx, input.chatId);
  const from = await getMembership(tx, chat.id, input.fromUserId);
  if (!from || from.leftAt || from.role !== 'owner') throw forbidden('Only the owner can transfer ownership');
  const to = await getMembership(tx, chat.id, input.toUserId);
  if (!to || to.leftAt) throw notFound('Member');
  if (input.fromUserId === input.toUserId) return;
  if (input.systemEvent && systemMessageAllowed(chat, input.systemEvent.kind)) await postSystemMessage(tx, fx, chat, input.systemEvent);
  await tx
    .update(chatMembers)
    .set({ role: 'admin' })
    .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, input.fromUserId)));
  await tx
    .update(chatMembers)
    .set({ role: 'owner' })
    .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, input.toUserId)));
  fx.chatUpsert([input.fromUserId, input.toUserId], chat.id);
}

// ---------------------------------------------------------------------------
// Add rules (groups and communities share them)
// ---------------------------------------------------------------------------

export type AddFailureReason = 'already_member' | 'not_found' | 'limit_reached';

export interface AddTargets {
  /** May be added directly (capacity is still the caller's check → `limit_reached`). */
  eligible: string[];
  /** Block in either direction, or the target's `groupsAddPermission` forbids it (indistinguishable). */
  needsInvite: string[];
  failed: { userId: string; reason: AddFailureReason }[];
}

/**
 * Classify add targets (docs "Groups → Adding"): unknown/deleted → `not_found`; already an
 * active member of `activeIds` (pass the chat's/community's active member ids, read under the
 * lock) → `already_member`; block either way or `groupsAddPermission` = nobody / contacts
 * without the target having saved the adder → `needsInvite`. Order preserved.
 */
export async function evaluateAddTargets(
  dbx: DbOrTx,
  input: { adderId: string; userIds: string[]; activeIds?: Iterable<string> },
): Promise<AddTargets> {
  const ids = uniq(input.userIds);
  const active = new Set(input.activeIds ?? []);
  const rows = await getUserRows(dbx, ids);
  const out: AddTargets = { eligible: [], needsInvite: [], failed: [] };
  const candidates: string[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    if (!row || row.deletedAt) out.failed.push({ userId: id, reason: 'not_found' });
    else if (active.has(id)) out.failed.push({ userId: id, reason: 'already_member' });
    else candidates.push(id);
  }
  const blocked = await blockedEitherWayIds(dbx, input.adderId, candidates);
  const contactsOnly = candidates.filter((id) => id !== input.adderId && settingsOf(rows.get(id)!).groupsAddPermission === 'contacts');
  const savedAdder = await ownersWhoSaved(dbx, input.adderId, contactsOnly);
  for (const id of candidates) {
    if (id === input.adderId) {
      out.eligible.push(id);
      continue;
    }
    const perm = settingsOf(rows.get(id)!).groupsAddPermission;
    const allowed = perm === 'everyone' || (perm === 'contacts' && savedAdder.has(id));
    if (blocked.has(id) || !allowed) out.needsInvite.push(id);
    else out.eligible.push(id);
  }
  return out;
}

/** Convenience: evaluateAddTargets against the chat's current active members. */
export async function evaluateGroupAdd(dbx: DbOrTx, input: { adderId: string; chatId: string; userIds: string[] }): Promise<AddTargets> {
  return evaluateAddTargets(dbx, { adderId: input.adderId, userIds: input.userIds, activeIds: await activeMemberIds(dbx, input.chatId) });
}

/**
 * "Removed members cannot rejoin themselves" (docs): true when the user's row in this chat
 * has left_reason 'removed', or — for a group linked to a community — their announcement-group
 * row does. Invite joins and community-page joins → 403 when true.
 */
export async function wasRemovedByAdmin(dbx: DbOrTx, chat: Pick<ChatRow, 'id' | 'communityId'>, userId: string): Promise<boolean> {
  const own = await getMembership(dbx, chat.id, userId);
  if (own?.leftAt && own.leftReason === 'removed') return true;
  if (chat.communityId) return wasRemovedFromCommunity(dbx, chat.communityId, userId);
  return false;
}

/** The user's announcement-group row of this community has left_reason 'removed'. */
export async function wasRemovedFromCommunity(dbx: DbOrTx, communityId: string, userId: string): Promise<boolean> {
  const [c] = await dbx.select({ ann: communities.announcementChatId }).from(communities).where(eq(communities.id, communityId)).limit(1);
  if (!c?.ann) return false;
  const row = await getMembership(dbx, c.ann, userId);
  return !!row?.leftAt && row.leftReason === 'removed';
}
