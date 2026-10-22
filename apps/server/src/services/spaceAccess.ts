/**
 * Space permission context and channel access (docs/design/spaces-at-scale.md "Access").
 *
 * Access to a space channel is COMPUTED: the viewer must be a Space member and have
 * VIEW_CHANNEL after the channel's overwrites (shared permissions.ts). The viewer's
 * `chat_members` row for the channel is only lazy read state; without one, a synthetic row
 * (joined_seq 0, nothing read) stands in, and writers that need a real row call
 * `ensureSpaceReadRow` first.
 *
 * A Space's roles are cached per process and validated against `spaces.perm_version`, which
 * every role/overwrite/member-role change bumps in its transaction; version and roles are
 * read in one statement, so a cache entry is never newer or older than its version.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  PERM,
  computeBasePermissions,
  computeChannelPermissions,
  hasPerm,
  isSpaceAdmin,
  isSpaceChatType,
  spaceChannelPermissions,
  type PermissionOverwrite,
  type SpaceChannelType,
} from '@enbox/shared';
import type { DbOrTx } from '../db/index.js';
import {
  chatMembers,
  spaceChannelOverwrites,
  spaceMemberRoles,
  spaceMembers,
  spaceRoles,
  spaces,
  type ChatMemberRow,
  type ChatRow,
  type SpaceMemberRow,
  type SpaceRoleRow,
  type SpaceRow,
} from '../db/schema.js';
import { forbidden, notFound } from '../lib/errors.js';
import type { ChatAccess } from './chats.js';
import { rawRows } from './sql.js';

// ---------------------------------------------------------------------------
// Roles (cached per perm_version)
// ---------------------------------------------------------------------------

export interface SpacePermCtx {
  spaceId: string;
  ownerId: string;
  permVersion: number;
  roles: SpaceRoleRow[];
  everyoneRoleId: string;
}

const ROLE_CACHE_MAX = 5_000;
const roleCache = new Map<string, SpacePermCtx>();

function remember(ctx: SpacePermCtx): void {
  if (roleCache.size >= ROLE_CACHE_MAX) {
    // Oldest entry first (Map keeps insertion order).
    const first = roleCache.keys().next().value;
    if (first) roleCache.delete(first);
  }
  roleCache.delete(ctx.spaceId);
  roleCache.set(ctx.spaceId, ctx);
}

/** The Space's owner, version and roles (one statement; cached while the version holds). */
export async function loadSpacePermCtx(dbx: DbOrTx, spaceId: string): Promise<SpacePermCtx | null> {
  const [head] = await dbx
    .select({ ownerId: spaces.ownerId, permVersion: spaces.permVersion })
    .from(spaces)
    .where(eq(spaces.id, spaceId))
    .limit(1);
  if (!head) return null;
  const cached = roleCache.get(spaceId);
  if (cached && cached.permVersion === head.permVersion && cached.ownerId === head.ownerId)
    return cached;
  return reloadSpacePermCtx(dbx, spaceId);
}

async function reloadSpacePermCtx(dbx: DbOrTx, spaceId: string): Promise<SpacePermCtx | null> {
  const rows = await dbx
    .select({ ownerId: spaces.ownerId, permVersion: spaces.permVersion, role: spaceRoles })
    .from(spaces)
    .leftJoin(spaceRoles, eq(spaceRoles.spaceId, spaces.id))
    .where(eq(spaces.id, spaceId));
  if (rows.length === 0) return null;
  const roles = rows
    .map((r) => r.role)
    .filter((r): r is SpaceRoleRow => !!r)
    .sort((a, b) => a.position - b.position);
  const everyone = roles.find((r) => r.isDefault);
  if (!everyone) throw new Error(`space ${spaceId} has no @everyone role`);
  const ctx: SpacePermCtx = {
    spaceId,
    ownerId: rows[0]!.ownerId,
    permVersion: rows[0]!.permVersion,
    roles,
    everyoneRoleId: everyone.id,
  };
  remember(ctx);
  return ctx;
}

/** Forget a cached Space (tests; deletions). */
export function forgetSpacePermCtx(spaceId?: string): void {
  if (spaceId) roleCache.delete(spaceId);
  else roleCache.clear();
}

/** `spaces.perm_version + 1` (call in every transaction that changes roles, overwrites or member roles). */
export async function bumpPermVersion(tx: DbOrTx, spaceId: string): Promise<void> {
  await tx
    .update(spaces)
    .set({ permVersion: sql`${spaces.permVersion} + 1`, updatedAt: new Date() })
    .where(eq(spaces.id, spaceId));
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface MemberCtx {
  member: SpaceMemberRow;
  /** Without @everyone. */
  roleIds: string[];
}

/** Member rows with their role ids, keyed by user id. */
export async function loadSpaceMembers(
  dbx: DbOrTx,
  spaceId: string,
  userIds: readonly string[],
): Promise<Map<string, MemberCtx>> {
  const out = new Map<string, MemberCtx>();
  if (userIds.length === 0) return out;
  const rows = await dbx
    .select()
    .from(spaceMembers)
    .where(and(eq(spaceMembers.spaceId, spaceId), inArray(spaceMembers.userId, [...userIds])));
  for (const member of rows) out.set(member.userId, { member, roleIds: [] });
  if (out.size === 0) return out;
  const roles = await dbx
    .select({ userId: spaceMemberRoles.userId, roleId: spaceMemberRoles.roleId })
    .from(spaceMemberRoles)
    .where(
      and(eq(spaceMemberRoles.spaceId, spaceId), inArray(spaceMemberRoles.userId, [...out.keys()])),
    );
  for (const r of roles) out.get(r.userId)?.roleIds.push(r.roleId);
  return out;
}

export async function loadSpaceMember(
  dbx: DbOrTx,
  spaceId: string,
  userId: string,
): Promise<MemberCtx | null> {
  return (await loadSpaceMembers(dbx, spaceId, [userId])).get(userId) ?? null;
}

export function isTimedOut(member: Pick<SpaceMemberRow, 'timedOutUntil'>, now = Date.now()) {
  return !!member.timedOutUntil && member.timedOutUntil.getTime() > now;
}

/** A member's Space-wide permission bits. */
export function baseBits(ctx: SpacePermCtx, userId: string, m: MemberCtx): number {
  return computeBasePermissions({
    ownerId: ctx.ownerId,
    viewerId: userId,
    everyoneRoleId: ctx.everyoneRoleId,
    roles: ctx.roles,
    memberRoleIds: m.roleIds,
  });
}

/** A member's bits in one channel (0 = cannot see it). */
export function channelBits(
  ctx: SpacePermCtx,
  userId: string,
  m: MemberCtx,
  channelType: SpaceChannelType,
  overwrites: readonly PermissionOverwrite[],
  base = baseBits(ctx, userId, m),
): number {
  return computeChannelPermissions(base, {
    channelType,
    overwrites,
    everyoneRoleId: ctx.everyoneRoleId,
    memberRoleIds: m.roleIds,
    viewerId: userId,
    timedOut: isTimedOut(m.member) && !isSpaceAdmin(base),
  });
}

/** Overwrites per channel id. */
export async function loadChannelOverwrites(
  dbx: DbOrTx,
  chatIds: readonly string[],
): Promise<Map<string, PermissionOverwrite[]>> {
  const out = new Map<string, PermissionOverwrite[]>();
  for (const id of chatIds) out.set(id, []);
  if (chatIds.length === 0) return out;
  const rows = await dbx
    .select()
    .from(spaceChannelOverwrites)
    .where(inArray(spaceChannelOverwrites.chatId, [...chatIds]));
  for (const r of rows)
    out.get(r.chatId)?.push({
      targetType: r.targetType,
      targetId: r.targetId,
      allow: r.allow,
      deny: r.deny,
    });
  return out;
}

// ---------------------------------------------------------------------------
// Guards
// ---------------------------------------------------------------------------

export interface SpaceAccess {
  ctx: SpacePermCtx;
  me: MemberCtx;
  /** My Space-wide bits. */
  base: number;
}

/** 404 unless `userId` is a member of the Space. */
export async function requireSpaceMember(
  dbx: DbOrTx,
  spaceId: string,
  userId: string,
): Promise<SpaceAccess> {
  const ctx = await loadSpacePermCtx(dbx, spaceId);
  const me = ctx ? await loadSpaceMember(dbx, spaceId, userId) : null;
  if (!ctx || !me) throw notFound('Space');
  return { ctx, me, base: baseBits(ctx, userId, me) };
}

/** `requireSpaceMember` + 403 unless my Space-wide bits include `perm`. */
export async function requireSpacePermission(
  dbx: DbOrTx,
  spaceId: string,
  userId: string,
  perm: number,
  message = 'You do not have permission to do that in this Space',
): Promise<SpaceAccess> {
  const access = await requireSpaceMember(dbx, spaceId, userId);
  if (!hasPerm(access.base, perm)) throw forbidden(message);
  return access;
}

/** Lock the Space row (`FOR UPDATE`; lock order: spaces → chats → everything else). 404 when missing. */
export async function lockSpace(tx: DbOrTx, spaceId: string): Promise<SpaceRow> {
  const [row] = await tx.select().from(spaces).where(eq(spaces.id, spaceId)).for('update');
  if (!row) throw notFound('Space');
  return row;
}

// ---------------------------------------------------------------------------
// Channel access (getChatAccess for space channels)
// ---------------------------------------------------------------------------

/** The stand-in for a viewer without a read-state row: nothing read yet, full history. */
export function syntheticSpaceMemberRow(
  chatId: string,
  userId: string,
  joinedAt: Date,
): ChatMemberRow {
  return {
    chatId,
    userId,
    role: 'member',
    addedBy: null,
    joinedAt,
    joinedSeq: 0,
    leftAt: null,
    leftSeq: null,
    leftReason: null,
    lastReadSeq: 0,
    lastReadAt: null,
    lastDeliveredSeq: 0,
    lastDeliveredAt: null,
    clearedSeq: 0,
    isPinned: false,
    pinnedAt: null,
    isArchived: false,
    mutedUntil: null,
    markedUnread: false,
    hidden: false,
    theme: null,
    wallpaperMediaId: null,
    notifyLevel: null,
    lastSentAt: null,
  };
}

/**
 * `ChatAccess` of a viewer in a space channel: 404 unless a member who can see it. The
 * permissions are mapped from the bits (`spaceChannelPermissions`); `access.space` carries the
 * bits for the checks without a boolean (attach, react, polls, mention everyone).
 */
export async function spaceChannelAccess(
  dbx: DbOrTx,
  viewerId: string,
  chat: ChatRow,
  memberRow: ChatMemberRow | null,
): Promise<ChatAccess> {
  if (!isSpaceChatType(chat.type) || !chat.spaceId) throw notFound('Chat');
  const ctx = await loadSpacePermCtx(dbx, chat.spaceId);
  const me = ctx ? await loadSpaceMember(dbx, chat.spaceId, viewerId) : null;
  if (!ctx || !me) throw notFound('Chat');
  const overwrites = (await loadChannelOverwrites(dbx, [chat.id])).get(chat.id) ?? [];
  const base = baseBits(ctx, viewerId, me);
  const bits = channelBits(ctx, viewerId, me, chat.type, overwrites, base);
  if (!hasPerm(bits, PERM.VIEW_CHANNEL)) throw notFound('Chat');
  const member = memberRow ?? syntheticSpaceMemberRow(chat.id, viewerId, me.member.joinedAt);
  return {
    chat,
    member,
    membership: 'active',
    permissions: spaceChannelPermissions(bits, chat.type),
    peer: null,
    window: {
      userId: viewerId,
      joinedSeq: Number(member.joinedSeq),
      clearedSeq: Number(member.clearedSeq),
      leftSeq: null,
    },
    space: { ctx, me, base, bits, overwrites },
  };
}

/** 403 unless the viewer's bits in the channel include `perm`. */
export function requireSpaceBit(access: ChatAccess, perm: number, message?: string): void {
  if (access.space && !hasPerm(access.space.bits, perm)) throw forbidden(message);
}

/**
 * Create the viewer's read-state row of a space channel if missing (writers that update
 * chat_members: reads, prefs, the sender's marks, slowmode). A new row starts read up to
 * the last message before the member joined the Space — looked at among the newest
 * SPACE_UNREAD_CAP + 1 messages only (older history counts as read; a member who joined
 * before all of them gets "100+ unread"), so creating it never scans history.
 */
export async function ensureSpaceReadRow(
  tx: DbOrTx,
  chat: Pick<ChatRow, 'id'>,
  userId: string,
  joinedAt: Date,
): Promise<void> {
  const [existing] = await tx
    .select({ x: chatMembers.chatId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, chat.id), eq(chatMembers.userId, userId)))
    .limit(1);
  if (existing) return;
  const [row] = await rawRows<{ seq: number | null }>(
    tx,
    sql`select coalesce(max(t.seq) filter (where t.created_at <= ${joinedAt}), min(t.seq) - 1) as seq
        from (select seq, created_at from messages where chat_id = ${chat.id} order by seq desc limit 101) t`,
  );
  const readSeq = Math.max(0, Number(row?.seq ?? 0));
  await tx
    .insert(chatMembers)
    .values({
      chatId: chat.id,
      userId,
      role: 'member',
      joinedAt,
      joinedSeq: 0,
      lastReadSeq: readSeq,
      lastDeliveredSeq: readSeq,
    })
    .onConflictDoNothing();
}

export type SpaceChannelAccessInfo = NonNullable<ChatAccess['space']>;
