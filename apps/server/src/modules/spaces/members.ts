/**
 * Spaces module, part 2: members (list, my settings, moderation), bans, invites, audit log.
 * Hierarchy (permissions.ts): moderating someone needs a highest role strictly above theirs;
 * the owner is untouchable; role assignment only for roles below my highest role.
 */
import { Router, type Request } from 'express';
import { and, asc, count, eq, gt, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  MAX_SPACE_INVITES,
  MAX_SPACE_MEMBERS_PAGE,
  PERM,
  USER_RATE_LIMITS,
  auditLogQuerySchema,
  banSchema,
  canActOn,
  createSpaceInviteSchema,
  hasPerm,
  idParamSchema,
  inviteParamsSchema,
  isSpaceAdmin,
  membersQuerySchema,
  spaceInvitesQuerySchema,
  spaceMembersBatchSchema,
  updateMemberSchema,
  updateMyMemberSchema,
  type SpaceBan,
  type SpaceInvite,
  type SpaceMember,
  type SpaceMemberPage,
} from '@enbox/shared';
import { z } from 'zod';
import { db, type DbOrTx } from '../../db/index.js';
import {
  chats,
  messages,
  spaceBans,
  spaceInvites,
  spaceMemberRoles,
  spaceMembers,
  users,
  type SpaceInviteRow,
} from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, forbidden, notFound, limitReached } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';
import { generateUniqueInviteCode } from '../../services/invites.js';
import { deleteForEveryoneTx } from '../../services/messages.js';
import {
  baseBits,
  bumpPermVersion,
  loadSpaceMember,
  loadSpaceMembers,
  lockSpace,
  requireSpaceMember,
  requireSpacePermission,
  type MemberCtx,
  type SpaceAccess,
} from '../../services/spaceAccess.js';
import {
  audit,
  auditEntries,
  fxChannelsChanged,
  fxMemberChanged,
  fxMemberEvent,
  fxSpaceUpsert,
  removeSpaceMemberTx,
  sortNameOf,
  toSpace,
  toSpaceMembers,
} from '../../services/spaces.js';
import { requireAvatarMedia, requireBannerMedia } from '../../services/media.js';
import { toUserPublicMap } from '../../services/users.js';
import { myChannelBits, myTop, requireChannelBit, requireSpaceChannel, topOf } from './service.js';

export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  member: idParamSchema('spaceId', 'userId'),
  memberRole: idParamSchema('spaceId', 'userId', 'roleId'),
};
const inviteDeleteParams = inviteParamsSchema.extend({ spaceId: z.uuid().toLowerCase() });

async function memberOrThrow(dbx: DbOrTx, spaceId: string, userId: string): Promise<MemberCtx> {
  const m = await loadSpaceMember(dbx, spaceId, userId);
  if (!m) throw notFound('Member');
  return m;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

function cursorOf(m: { sortName: string; userId: string }): string {
  return Buffer.from(`${m.sortName}\u0000${m.userId}`, 'utf8').toString('base64url');
}

function parseCursor(c: string | undefined): { sortName: string; userId: string } | null {
  if (!c) return null;
  const raw = Buffer.from(c, 'base64url').toString('utf8');
  const i = raw.indexOf('\u0000');
  if (i < 0) throw badRequest('after: invalid cursor');
  return { sortName: raw.slice(0, i), userId: raw.slice(i + 1) };
}

// GET /spaces/:spaceId/members?q=&roleId=&after=&limit= → SpaceMemberPage (display-name order)
router.get('/spaces/:spaceId/members', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const q = parse(membersQuerySchema, req.query);
  await requireSpaceMember(db, spaceId, me);
  const after = parseCursor(q.after);
  const prefix = q.q?.trim().toLowerCase().replace(/^@/, '');
  const limit = Math.min(q.limit, MAX_SPACE_MEMBERS_PAGE);
  const rows = await db
    .select({ m: spaceMembers })
    .from(spaceMembers)
    .innerJoin(users, eq(users.id, spaceMembers.userId))
    .where(
      and(
        eq(spaceMembers.spaceId, spaceId),
        isNull(users.deletedAt),
        prefix
          ? or(
              sql`${spaceMembers.sortName} like ${prefix.replace(/[%_\\]/g, '\\$&') + '%'}`,
              sql`${users.username} like ${prefix.replace(/[%_\\]/g, '\\$&') + '%'}`,
            )
          : undefined,
        q.roleId
          ? sql`exists (select 1 from ${spaceMemberRoles} r where r.space_id = ${spaceId} and r.user_id = ${spaceMembers.userId} and r.role_id = ${q.roleId})`
          : undefined,
        after
          ? or(
              gt(spaceMembers.sortName, after.sortName),
              and(eq(spaceMembers.sortName, after.sortName), gt(spaceMembers.userId, after.userId)),
            )
          : undefined,
      ),
    )
    .orderBy(asc(spaceMembers.sortName), asc(spaceMembers.userId))
    .limit(limit + 1);
  const page = rows.slice(0, limit).map((r) => r.m);
  const roles = await loadSpaceMembers(
    db,
    spaceId,
    page.map((m) => m.userId),
  );
  const out: SpaceMemberPage = {
    members: await toSpaceMembers(
      db,
      page.map((member) => ({ member, roleIds: roles.get(member.userId)?.roleIds ?? [] })),
    ),
    nextCursor: rows.length > limit ? cursorOf(page[page.length - 1]!) : null,
  };
  res.json(out);
});

/** Per-Space profile fields of `PATCH members/me` (each null = the main profile's value). */
const PROFILE_FIELDS = [
  'avatarMediaId',
  'bannerMediaId',
  'bio',
  'pronouns',
  'profileColor',
  'accentColor',
  'avatarDecoration',
  'profileEffect',
  'nameplate',
] as const;

// GET /spaces/:spaceId/members/me → Space
router.get('/spaces/:spaceId/members/me', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const space = await toSpace(db, me, spaceId);
  if (!space) throw notFound('Space');
  res.json(space);
});

// PATCH /spaces/:spaceId/members/me → Space. space:upsert → U(me); nickname or per-Space
// profile changes: space:member-updated → the Space (member list subscribers when large).
// Profile images must be my own uploads (requireAvatarMedia / requireBannerMedia: 404 for
// someone else's, 400 for the wrong kind); every profile field accepts null = use the main one.
router.patch('/spaces/:spaceId/members/me', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(updateMyMemberSchema, req.body ?? {});
  const profileChange = PROFILE_FIELDS.some((f) => body[f] !== undefined);
  if (profileChange) assertUserLimit(me, 'profileUpdate', USER_RATE_LIMITS.profileUpdate);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    const patch: Partial<typeof spaceMembers.$inferInsert> = {};
    if (body.nickname !== undefined) {
      if (!hasPerm(access.base, PERM.CHANGE_NICKNAME))
        throw forbidden('You cannot change your nickname here');
      const [u] = await tx.select({ n: users.displayName }).from(users).where(eq(users.id, me));
      patch.nickname = body.nickname;
      patch.sortName = sortNameOf(body.nickname, u?.n ?? '');
    }
    if (body.notifyLevel !== undefined) patch.notifyLevel = body.notifyLevel;
    if (body.mutedUntil !== undefined)
      patch.mutedUntil = body.mutedUntil ? new Date(body.mutedUntil) : null;
    if (body.suppressEveryone !== undefined) patch.suppressEveryone = body.suppressEveryone;
    if (body.suppressRoles !== undefined) patch.suppressRoles = body.suppressRoles;
    if (body.hideMutedChannels !== undefined) patch.hideMutedChannels = body.hideMutedChannels;
    // Privacy Settings: members of this Space may DM me (services/dmGate.ts).
    if (body.allowDms !== undefined) patch.allowDms = body.allowDms;
    // Per-Space profile (locks the media rows against the GC until commit).
    if (body.avatarMediaId !== undefined) {
      if (body.avatarMediaId) await requireAvatarMedia(tx, body.avatarMediaId, me);
      patch.avatarMediaId = body.avatarMediaId;
    }
    if (body.bannerMediaId !== undefined) {
      if (body.bannerMediaId) await requireBannerMedia(tx, body.bannerMediaId, me);
      patch.bannerMediaId = body.bannerMediaId;
    }
    if (body.bio !== undefined) patch.bio = body.bio;
    if (body.pronouns !== undefined) patch.pronouns = body.pronouns;
    if (body.profileColor !== undefined) patch.profileColor = body.profileColor;
    if (body.accentColor !== undefined) patch.accentColor = body.accentColor;
    if (body.avatarDecoration !== undefined) patch.avatarDecoration = body.avatarDecoration;
    if (body.profileEffect !== undefined) patch.profileEffect = body.profileEffect;
    if (body.nameplate !== undefined) patch.nameplate = body.nameplate;
    if (Object.keys(patch).length === 0) return;
    const [row] = await tx
      .update(spaceMembers)
      .set(patch)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, me)))
      .returning();
    fxSpaceUpsert(fx, me, spaceId);
    if (body.nickname !== undefined || profileChange) {
      const [member] = await toSpaceMembers(tx, [{ member: row!, roleIds: access.me.roleIds }]);
      fxMemberEvent(fx, space, () => ({ event: 'space:member-updated', member: member! }));
    }
  });
  const space = await toSpace(db, me, spaceId);
  res.json(space);
});

// POST /spaces/:spaceId/members/batch { userIds } → SpaceMember[] (the members among them)
router.post('/spaces/:spaceId/members/batch', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { userIds } = parse(spaceMembersBatchSchema, req.body ?? {});
  await requireSpaceMember(db, spaceId, me);
  const found = await loadSpaceMembers(db, spaceId, userIds);
  const out: SpaceMember[] = await toSpaceMembers(
    db,
    userIds.map((id) => found.get(id)).filter((m): m is MemberCtx => !!m),
  );
  res.json(out);
});

/** One member on the wire (profile images included). */
async function serializeMember(dbx: DbOrTx, m: MemberCtx): Promise<SpaceMember> {
  return (await toSpaceMembers(dbx, [m]))[0]!;
}

// GET /spaces/:spaceId/members/:userId → SpaceMember
router.get('/spaces/:spaceId/members/:userId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, userId } = parse(P.member, req.params);
  await requireSpaceMember(db, spaceId, me);
  const m = await memberOrThrow(db, spaceId, userId);
  res.json(await serializeMember(db, m));
});

// PATCH /spaces/:spaceId/members/:userId → SpaceMember (nickname / roles / timeout / mute / deaf).
router.patch('/spaces/:spaceId/members/:userId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, userId } = parse(P.member, req.params);
  const body = parse(updateMemberSchema, req.body ?? {});
  assertUserLimit(me, 'spaceMemberUpdate', USER_RATE_LIMITS.spaceMemberUpdate);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    const target = await memberOrThrow(tx, spaceId, userId);
    const self = userId === me;
    const myPos = myTop(access, me);
    const theirPos = topOf(access, userId, target);
    const ownerTarget = space.ownerId === userId;
    const need = (perm: number, what: string) => {
      if (!hasPerm(access.base, perm)) throw forbidden(`You cannot ${what} in this Space`);
    };
    const above = () => {
      if (!canActOn(myPos, theirPos, ownerTarget))
        throw forbidden('You can only do that to members below your highest role');
    };
    const patch: Partial<typeof spaceMembers.$inferInsert> = {};
    const changes: Record<string, unknown> = {};
    let permsChanged = false;

    if (body.nickname !== undefined) {
      if (self) need(PERM.CHANGE_NICKNAME, 'change your nickname');
      else {
        need(PERM.MANAGE_NICKNAMES, 'change nicknames');
        above();
      }
      const [u] = await tx.select({ n: users.displayName }).from(users).where(eq(users.id, userId));
      patch.nickname = body.nickname;
      patch.sortName = sortNameOf(body.nickname, u?.n ?? '');
      changes.nickname = [target.member.nickname, body.nickname];
    }
    if (body.timedOutUntil !== undefined) {
      need(PERM.MODERATE_MEMBERS, 'time members out');
      if (self) throw forbidden('You cannot time yourself out');
      above();
      const targetBase = baseBits(access.ctx, userId, target);
      if (isSpaceAdmin(targetBase)) throw forbidden('Administrators cannot be timed out');
      patch.timedOutUntil = body.timedOutUntil ? new Date(body.timedOutUntil) : null;
      changes.timedOutUntil = body.timedOutUntil;
      permsChanged = true;
    }
    if (body.serverMute !== undefined) {
      need(PERM.MUTE_MEMBERS, 'mute members');
      if (!self) above();
      patch.serverMute = body.serverMute;
      changes.serverMute = body.serverMute;
    }
    if (body.serverDeaf !== undefined) {
      need(PERM.DEAFEN_MEMBERS, 'deafen members');
      if (!self) above();
      patch.serverDeaf = body.serverDeaf;
      changes.serverDeaf = body.serverDeaf;
    }
    let roleIds = target.roleIds;
    if (body.roleIds !== undefined) {
      need(PERM.MANAGE_ROLES, 'manage roles');
      const wanted = [...new Set(body.roleIds)];
      const byId = new Map(access.ctx.roles.map((r) => [r.id, r]));
      for (const id of wanted) {
        const r = byId.get(id);
        if (!r || r.isDefault) throw notFound('Role');
      }
      const added = wanted.filter((id) => !target.roleIds.includes(id));
      const removed = target.roleIds.filter((id) => !wanted.includes(id));
      for (const id of [...added, ...removed])
        if (byId.get(id)!.position >= myPos)
          throw forbidden('You can only assign roles below your highest role');
      if (!self && removed.length) above();
      if (added.length || removed.length) {
        if (removed.length)
          await tx
            .delete(spaceMemberRoles)
            .where(
              and(
                eq(spaceMemberRoles.spaceId, spaceId),
                eq(spaceMemberRoles.userId, userId),
                inArray(spaceMemberRoles.roleId, removed),
              ),
            );
        if (added.length)
          await tx
            .insert(spaceMemberRoles)
            .values(added.map((roleId) => ({ spaceId, userId, roleId })))
            .onConflictDoNothing();
        roleIds = wanted;
        changes.roles = { added, removed };
        permsChanged = true;
      }
    }
    if (Object.keys(patch).length)
      await tx
        .update(spaceMembers)
        .set(patch)
        .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));
    if (Object.keys(changes).length === 0) return;
    if (permsChanged) await bumpPermVersion(tx, spaceId);
    const action =
      body.timedOutUntil !== undefined
        ? 'member.timeout'
        : body.roleIds !== undefined
          ? 'member.roles'
          : 'member.update';
    await audit(tx, {
      spaceId,
      actorId: me,
      action,
      targetType: 'member',
      targetId: userId,
      changes,
      reason: body.reason ?? null,
    });
    const fresh = await memberOrThrow(tx, spaceId, userId);
    const member = await serializeMember(tx, { member: fresh.member, roleIds });
    fxMemberEvent(fx, space, () => ({ event: 'space:member-updated', member }));
    fxSpaceUpsert(fx, userId, spaceId);
    if (permsChanged) {
      fxMemberChanged(fx, spaceId, userId);
      // Roles can change which channels they see: their devices refetch the list.
      fxChannelsChanged(fx, spaceId, userId);
    }
  });
  const m = await memberOrThrow(db, spaceId, userId);
  res.json(await serializeMember(db, m));
});

// DELETE /spaces/:spaceId/members/:userId (KICK_MEMBERS, above them) → 204
router.delete('/spaces/:spaceId/members/:userId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, userId } = parse(P.member, req.params);
  const reason = typeof req.query.reason === 'string' ? req.query.reason.slice(0, 512) : null;
  assertUserLimit(me, 'spaceMemberUpdate', USER_RATE_LIMITS.spaceMemberUpdate);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.KICK_MEMBERS);
    if (userId === me) throw badRequest('Use leave to leave a Space');
    const target = await memberOrThrow(tx, spaceId, userId);
    if (!canActOn(myTop(access, me), topOf(access, userId, target), space.ownerId === userId))
      throw forbidden('You can only kick members below your highest role');
    await removeSpaceMemberTx(tx, fx, spaceId, userId, 'kicked');
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'member.kick',
      targetType: 'member',
      targetId: userId,
      reason,
    });
  });
  res.status(204).end();
});

async function setRole(req: Request, add: boolean): Promise<SpaceMember> {
  const me = authUserId(req);
  const { spaceId, userId, roleId } = parse(P.memberRole, req.params);
  assertUserLimit(me, 'spaceMemberUpdate', USER_RATE_LIMITS.spaceMemberUpdate);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_ROLES);
    const target = await memberOrThrow(tx, spaceId, userId);
    const role = access.ctx.roles.find((r) => r.id === roleId);
    if (!role || role.isDefault) throw notFound('Role');
    if (role.position >= myTop(access, me))
      throw forbidden('You can only assign roles below your highest role');
    const has = target.roleIds.includes(roleId);
    if (has === add) return;
    if (add)
      await tx.insert(spaceMemberRoles).values({ spaceId, userId, roleId }).onConflictDoNothing();
    else
      await tx
        .delete(spaceMemberRoles)
        .where(
          and(
            eq(spaceMemberRoles.spaceId, spaceId),
            eq(spaceMemberRoles.userId, userId),
            eq(spaceMemberRoles.roleId, roleId),
          ),
        );
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'member.roles',
      targetType: 'member',
      targetId: userId,
      changes: add ? { added: [roleId] } : { removed: [roleId] },
    });
    const roleIds = add
      ? [...target.roleIds, roleId]
      : target.roleIds.filter((id) => id !== roleId);
    const member = await serializeMember(tx, { member: target.member, roleIds });
    fxMemberEvent(fx, space, () => ({ event: 'space:member-updated', member }));
    fxSpaceUpsert(fx, userId, spaceId);
    fxMemberChanged(fx, spaceId, userId);
    fxChannelsChanged(fx, spaceId, userId);
  });
  const m = await memberOrThrow(db, spaceId, userId);
  return serializeMember(db, m);
}

// PUT|DELETE /spaces/:spaceId/members/:userId/roles/:roleId (MANAGE_ROLES, role below mine) → SpaceMember
router.put('/spaces/:spaceId/members/:userId/roles/:roleId', async (req, res) => {
  res.json(await setRole(req, true));
});
router.delete('/spaces/:spaceId/members/:userId/roles/:roleId', async (req, res) => {
  res.json(await setRole(req, false));
});

// ---------------------------------------------------------------------------
// Bans
// ---------------------------------------------------------------------------

// GET /spaces/:spaceId/bans (BAN_MEMBERS) → SpaceBan[]
router.get('/spaces/:spaceId/bans', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  await requireSpacePermission(db, spaceId, me, PERM.BAN_MEMBERS);
  const rows = await db
    .select()
    .from(spaceBans)
    .where(eq(spaceBans.spaceId, spaceId))
    .orderBy(asc(spaceBans.createdAt))
    .limit(1000);
  const people = await toUserPublicMap(
    db,
    me,
    rows.map((r) => r.userId),
  );
  const out: SpaceBan[] = rows
    .filter((r) => people.has(r.userId))
    .map((r) => ({
      user: people.get(r.userId)!,
      reason: r.reason,
      bannedBy: r.bannedBy,
      createdAt: r.createdAt.toISOString(),
    }));
  res.json(out);
});

/** Bounded purge of a banned member's recent messages in the Space (≤ 1000). */
const BAN_PURGE_LIMIT = 1000;

// PUT /spaces/:spaceId/bans/:userId (BAN_MEMBERS, above them) → 204
router.put('/spaces/:spaceId/bans/:userId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, userId } = parse(P.member, req.params);
  const body = parse(banSchema, req.body ?? {});
  assertUserLimit(me, 'spaceMemberUpdate', USER_RATE_LIMITS.spaceMemberUpdate);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.BAN_MEMBERS);
    if (userId === me) throw badRequest('You cannot ban yourself');
    if (space.ownerId === userId) throw forbidden('The owner cannot be banned');
    const [exists] = await tx
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!exists) throw notFound('User');
    const target = await loadSpaceMember(tx, spaceId, userId);
    if (target && !canActOn(myTop(access, me), topOf(access, userId, target), false))
      throw forbidden('You can only ban members below your highest role');
    await tx
      .insert(spaceBans)
      .values({ spaceId, userId, bannedBy: me, reason: body.reason ?? null })
      .onConflictDoUpdate({
        target: [spaceBans.spaceId, spaceBans.userId],
        set: { reason: body.reason ?? null, bannedBy: me },
      });
    if (target) await removeSpaceMemberTx(tx, fx, spaceId, userId, 'banned');
    let purged = 0;
    if (body.deleteMessageSeconds > 0) {
      const since = new Date(Date.now() - body.deleteMessageSeconds * 1000);
      const rows = await tx
        .select({ id: messages.id })
        .from(messages)
        .innerJoin(chats, eq(chats.id, messages.chatId))
        .where(
          and(
            eq(chats.spaceId, spaceId),
            eq(messages.senderId, userId),
            gt(messages.createdAt, since),
            isNull(messages.deletedAt),
            inArray(messages.type, [
              'text',
              'image',
              'video',
              'audio',
              'voice',
              'file',
              'location',
              'contact',
              'poll',
            ]),
          ),
        )
        .orderBy(sql`${messages.createdAt} desc`)
        .limit(BAN_PURGE_LIMIT);
      for (const r of rows) await deleteForEveryoneTx(tx, fx, r.id);
      purged = rows.length;
    }
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'member.ban',
      targetType: 'member',
      targetId: userId,
      reason: body.reason ?? null,
      changes: purged ? { deletedMessages: purged } : null,
    });
  });
  res.status(204).end();
});

// DELETE /spaces/:spaceId/bans/:userId (BAN_MEMBERS) → 204
router.delete('/spaces/:spaceId/bans/:userId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, userId } = parse(P.member, req.params);
  await transact(async (tx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.BAN_MEMBERS);
    const gone = await tx
      .delete(spaceBans)
      .where(and(eq(spaceBans.spaceId, spaceId), eq(spaceBans.userId, userId)))
      .returning({ u: spaceBans.userId });
    if (gone.length)
      await audit(tx, {
        spaceId,
        actorId: me,
        action: 'member.unban',
        targetType: 'member',
        targetId: userId,
      });
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------

export function toSpaceInvite(r: SpaceInviteRow): SpaceInvite {
  return {
    code: r.code,
    spaceId: r.spaceId,
    channelId: r.channelId,
    createdBy: r.createdBy,
    maxUses: r.maxUses,
    uses: r.uses,
    expiresAt: r.expiresAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** MANAGE_CHANNELS in the channel (Discord's channel Invites tab); false when I cannot see it. */
async function managesChannel(
  dbx: DbOrTx,
  access: SpaceAccess,
  me: string,
  spaceId: string,
  channelId: string,
): Promise<boolean> {
  const chat = await requireSpaceChannel(dbx, spaceId, channelId).catch(() => null);
  if (!chat) return false;
  const { bits } = await myChannelBits(dbx, access, me, chat);
  return hasPerm(bits, PERM.VIEW_CHANNEL) && hasPerm(bits, PERM.MANAGE_CHANNELS);
}

// GET /spaces/:spaceId/invites?channelId= → SpaceInvite[] (MANAGE_SPACE, or MANAGE_CHANNELS in
// the given channel: all live invites; else mine). With channelId: only that channel's.
router.get('/spaces/:spaceId/invites', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { channelId } = parse(spaceInvitesQuerySchema, req.query);
  const access = await requireSpaceMember(db, spaceId, me);
  const all =
    hasPerm(access.base, PERM.MANAGE_SPACE) ||
    (!!channelId && (await managesChannel(db, access, me, spaceId, channelId)));
  const rows = await db
    .select()
    .from(spaceInvites)
    .where(
      and(
        eq(spaceInvites.spaceId, spaceId),
        channelId ? eq(spaceInvites.channelId, channelId) : undefined,
        all ? undefined : eq(spaceInvites.createdBy, me),
        or(isNull(spaceInvites.expiresAt), gt(spaceInvites.expiresAt, new Date())),
      ),
    )
    .orderBy(sql`${spaceInvites.createdAt} desc`)
    .limit(MAX_SPACE_INVITES);
  res.json(rows.filter((r) => r.maxUses === 0 || r.uses < r.maxUses).map(toSpaceInvite));
});

// POST /spaces/:spaceId/invites (CREATE_INVITE; in the channel when channelId) → SpaceInvite (201)
router.post('/spaces/:spaceId/invites', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createSpaceInviteSchema, req.body ?? {});
  assertUserLimit(me, 'spaceInviteCreate', USER_RATE_LIMITS.spaceInviteCreate);
  const row = await transact(async (tx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    if (body.channelId) {
      const chat = await requireSpaceChannel(tx, spaceId, body.channelId);
      await requireChannelBit(
        tx,
        access,
        me,
        chat,
        PERM.CREATE_INVITE,
        'You cannot create invites',
      );
    } else if (!hasPerm(access.base, PERM.CREATE_INVITE))
      throw forbidden('You cannot create invites');
    // Expired and used-up invites don't count.
    await tx
      .delete(spaceInvites)
      .where(and(eq(spaceInvites.spaceId, spaceId), lt(spaceInvites.expiresAt, new Date())));
    const [n] = await tx
      .select({ n: count() })
      .from(spaceInvites)
      .where(eq(spaceInvites.spaceId, spaceId));
    if (Number(n?.n ?? 0) >= MAX_SPACE_INVITES)
      throw limitReached(`A Space can have at most ${MAX_SPACE_INVITES} invites`);
    const code = await generateUniqueInviteCode(tx);
    const [inv] = await tx
      .insert(spaceInvites)
      .values({
        code,
        spaceId,
        channelId: body.channelId ?? null,
        createdBy: me,
        maxUses: body.maxUses,
        expiresAt: body.maxAgeSec ? new Date(Date.now() + body.maxAgeSec * 1000) : null,
      })
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'invite.create',
      targetType: 'invite',
      changes: { code, maxUses: body.maxUses, maxAgeSec: body.maxAgeSec },
    });
    return inv!;
  });
  res.status(201).json(toSpaceInvite(row));
});

// DELETE /spaces/:spaceId/invites/:code (mine, or MANAGE_SPACE) → 204
router.delete('/spaces/:spaceId/invites/:code', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, code } = parse(inviteDeleteParams, req.params);
  await transact(async (tx) => {
    const access = await requireSpaceMember(tx, spaceId, me);
    const [inv] = await tx
      .select()
      .from(spaceInvites)
      .where(and(eq(spaceInvites.code, code), eq(spaceInvites.spaceId, spaceId)));
    if (!inv) throw notFound('Invite');
    if (
      inv.createdBy !== me &&
      !hasPerm(access.base, PERM.MANAGE_SPACE) &&
      !(inv.channelId && (await managesChannel(tx, access, me, spaceId, inv.channelId)))
    )
      throw forbidden('You can only revoke your own invites');
    await tx.delete(spaceInvites).where(eq(spaceInvites.code, code));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'invite.delete',
      targetType: 'invite',
      changes: { code },
    });
  });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Audit log
// ---------------------------------------------------------------------------

// GET /spaces/:spaceId/audit-log (VIEW_AUDIT_LOG) → SpaceAuditEntry[] newest first
router.get('/spaces/:spaceId/audit-log', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const q = parse(auditLogQuerySchema, req.query);
  await requireSpacePermission(db, spaceId, me, PERM.VIEW_AUDIT_LOG);
  res.json(await auditEntries(db, spaceId, q));
});
