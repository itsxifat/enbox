/**
 * Spaces module — owns /spaces/* (docs/design/spaces-at-scale.md). Space-wide checks use my
 * base bits, channel checks my bits after the channel's overwrites (shared permissions.ts);
 * non-members get 404, missing bits 403. Every mutation locks the Space row first (lock
 * order: spaces → chats → everything else), writes an audit entry for moderation and
 * structure changes, and registers its fan-out in Effects (emitted after commit).
 * Members, bans, invites and the audit log: members.ts.
 */
import { Router } from 'express';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';
import {
  CHANNEL_NAME_MAX_LENGTH,
  MAX_OVERWRITES_PER_CHANNEL,
  MAX_SPACE_CATEGORIES,
  MAX_SPACE_CHANNELS,
  MAX_SPACE_ROLES,
  MAX_SPACES_PER_USER,
  PERM,
  USER_RATE_LIMITS,
  rooms,
  categoryPositionsSchema,
  channelPositionsSchema,
  createCategorySchema,
  createRoleSchema,
  createSpaceChannelSchema,
  createSpaceSchema,
  idParamSchema,
  normalizeTextChannelName,
  overwriteInputSchema,
  overwriteParamsSchema,
  rolePositionsSchema,
  transferOwnershipSchema,
  updateCategorySchema,
  updateRoleSchema,
  updateSpaceChannelSchema,
  updateSpaceSchema,
  type ChatSummary,
  type PermissionOverwrite,
  type SpaceDetail,
  type SpaceInfoChanges,
} from '@enbox/shared';
import { z } from 'zod';
import { db } from '../../db/index.js';
import {
  chats,
  spaceCategories,
  spaceCategoryOverwrites,
  spaceChannelOverwrites,
  spaceMembers,
  spaceRoles,
  spaces,
} from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, forbidden, limitReached, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';
import { runChatDeletionHooks } from '../../services/hooks.js';
import {
  requireAvatarMedia,
  requireBannerMedia,
  staticMediaUrl,
  mediaUrl,
  loadMediaMap,
} from '../../services/media.js';
import {
  bumpPermVersion,
  loadChannelOverwrites,
  lockSpace,
  requireSpaceMember,
  requireSpacePermission,
} from '../../services/spaceAccess.js';
import { emitToRooms } from '../../realtime/emit.js';
import { spaceDeleted } from '../../realtime/spaceRegistry.js';
import {
  audit,
  createSpaceTx,
  fxCategoriesChanged,
  fxChannelsChanged,
  fxRolesChanged,
  fxSpaceUpdated,
  fxSpaceUpsert,
  fxStructureChanged,
  loadCategories,
  removeSpaceMemberTx,
  toSpace,
  toSpaceRole,
  toSpaces,
} from '../../services/spaces.js';
import {
  spaceChannelSummaries,
  spaceChannelSummariesForPairs,
  toSpaceChannelInfo,
} from '../../services/spaceSummaries.js';
import { pairKey } from '../../services/sql.js';
import {
  assertGrantable,
  assertRoleManageable,
  categoryOverwrites,
  myTop,
  nextChannelPosition,
  overwritesChangedFx,
  requireCategory,
  requireChannelBit,
  requireSpaceChannel,
  setChannelOverwrites,
} from './service.js';
import { router as membersRouter } from './members.js';
import './hooks.js';

export const router = Router();

const P = {
  space: idParamSchema('spaceId'),
  channel: idParamSchema('spaceId', 'chatId'),
  category: idParamSchema('spaceId', 'categoryId'),
  role: idParamSchema('spaceId', 'roleId'),
};
const channelOverwriteParams = overwriteParamsSchema.extend({ chatId: z.uuid().toLowerCase() });
const categoryOverwriteParams = overwriteParamsSchema.extend({
  categoryId: z.uuid().toLowerCase(),
});

async function spaceOrThrow(userId: string, spaceId: string) {
  const space = await toSpace(db, userId, spaceId);
  if (!space) throw notFound('Space');
  return space;
}

async function channelSummary(userId: string, chatId: string): Promise<ChatSummary> {
  const s = (await spaceChannelSummariesForPairs(db, [{ chatId, userId }])).get(
    pairKey(chatId, userId),
  );
  if (!s) throw notFound('Channel');
  return s;
}

function channelName(type: 'space_text' | 'space_voice', name: string): string {
  const n = type === 'space_text' ? normalizeTextChannelName(name) : name.trim();
  if (!n) throw badRequest('name: use letters or numbers');
  return n.slice(0, CHANNEL_NAME_MAX_LENGTH);
}

// ---------------------------------------------------------------------------
// Spaces
// ---------------------------------------------------------------------------

// GET /spaces → Space[] (mine, with unread aggregates)
router.get('/spaces', async (req, res) => {
  res.json(await toSpaces(db, authUserId(req)));
});

// POST /spaces → SpaceDetail (201). Owner joins; #general (system channel) + General voice.
router.post('/spaces', async (req, res) => {
  const me = authUserId(req);
  const body = parse(createSpaceSchema, req.body ?? {});
  assertUserLimit(me, 'spaceCreate', USER_RATE_LIMITS.spaceCreate);
  const spaceId = await transact(async (tx, fx) => {
    const [mine] = await tx
      .select({ n: count() })
      .from(spaceMembers)
      .where(eq(spaceMembers.userId, me));
    if (Number(mine?.n ?? 0) >= MAX_SPACES_PER_USER)
      throw limitReached(`You can be in at most ${MAX_SPACES_PER_USER} Spaces`);
    if (body.iconMediaId) await requireAvatarMedia(tx, body.iconMediaId, me);
    const { space } = await createSpaceTx(tx, fx, {
      ownerId: me,
      name: body.name,
      description: body.description ?? null,
      iconMediaId: body.iconMediaId ?? null,
    });
    return space.id;
  });
  const detail: SpaceDetail = {
    space: await spaceOrThrow(me, spaceId),
    channels: await spaceChannelSummaries(db, me, spaceId),
  };
  res.status(201).json(detail);
});

// GET /spaces/:spaceId → SpaceDetail (the channels I can see)
router.get('/spaces/:spaceId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const detail: SpaceDetail = {
    space: await spaceOrThrow(me, spaceId),
    channels: await spaceChannelSummaries(db, me, spaceId),
  };
  res.json(detail);
});

// PATCH /spaces/:spaceId (MANAGE_SPACE) → Space. space:updated → room.
router.patch('/spaces/:spaceId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(updateSpaceSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_SPACE);
    const patch: Partial<typeof spaces.$inferInsert> = {};
    const changes: SpaceInfoChanges = {};
    if (body.name !== undefined) patch.name = changes.name = body.name;
    if (body.description !== undefined) patch.description = changes.description = body.description;
    if (body.iconMediaId !== undefined) {
      if (body.iconMediaId) await requireAvatarMedia(tx, body.iconMediaId, me);
      patch.iconMediaId = body.iconMediaId;
    }
    if (body.bannerMediaId !== undefined) {
      if (body.bannerMediaId) await requireBannerMedia(tx, body.bannerMediaId, me);
      patch.bannerMediaId = body.bannerMediaId;
    }
    for (const key of ['systemChannelId', 'rulesChannelId', 'afkChannelId'] as const) {
      const id = body[key];
      if (id === undefined) continue;
      if (id) {
        const ch = await requireSpaceChannel(tx, spaceId, id);
        const wanted = key === 'afkChannelId' ? 'space_voice' : 'space_text';
        if (ch.type !== wanted)
          throw badRequest(
            `${key}: needs a ${wanted === 'space_voice' ? 'voice' : 'text'} channel`,
          );
      }
      patch[key] = changes[key] = id;
    }
    if (body.afkTimeoutSec !== undefined)
      patch.afkTimeoutSec = changes.afkTimeoutSec = body.afkTimeoutSec;
    if (body.defaultNotifyLevel !== undefined)
      patch.defaultNotifyLevel = changes.defaultNotifyLevel = body.defaultNotifyLevel;
    if (body.isDiscoverable !== undefined)
      patch.isDiscoverable = changes.isDiscoverable = body.isDiscoverable;
    if (Object.keys(patch).length === 0) return;
    const [row] = await tx
      .update(spaces)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(spaces.id, spaceId))
      .returning();
    if (patch.iconMediaId !== undefined || patch.bannerMediaId !== undefined) {
      const m = await loadMediaMap(tx, [row!.iconMediaId, row!.bannerMediaId]);
      const icon = row!.iconMediaId ? m.get(row!.iconMediaId) : undefined;
      const banner = row!.bannerMediaId ? m.get(row!.bannerMediaId) : undefined;
      changes.iconUrl = icon ? staticMediaUrl(icon) : null;
      changes.iconAnimatedUrl = icon?.animated ? mediaUrl(icon.storageKey) : null;
      changes.bannerUrl = banner ? staticMediaUrl(banner) : null;
    }
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'space.update',
      targetType: 'space',
      targetId: spaceId,
      changes: body,
    });
    fxSpaceUpdated(fx, spaceId, changes);
  });
  res.json(await spaceOrThrow(me, spaceId));
});

// DELETE /spaces/:spaceId (owner) → 204. space:removed {deleted} → room; channels' calls end.
router.delete('/spaces/:spaceId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    await requireSpaceMember(tx, spaceId, me);
    if (space.ownerId !== me) throw forbidden('Only the owner can delete a Space');
    const channelIds = (
      await tx.select({ id: chats.id }).from(chats).where(eq(chats.spaceId, spaceId))
    ).map((r) => r.id);
    if (channelIds.length) await runChatDeletionHooks(tx, fx, channelIds);
    // Tell every connected member through the room (no per-member fan-out), then delete.
    fx.add(() =>
      emitToRooms([rooms.space(spaceId)], 'space:removed', { spaceId, reason: 'deleted' }),
    );
    await tx.delete(spaces).where(eq(spaces.id, spaceId));
    fx.add(() => spaceDeleted(spaceId));
  });
  res.status(204).end();
});

// POST /spaces/:spaceId/leave → 204 (not the owner: transfer ownership first).
router.post('/spaces/:spaceId/leave', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    await requireSpaceMember(tx, spaceId, me);
    if (space.ownerId === me)
      throw forbidden('Transfer ownership to someone else before leaving your Space');
    await removeSpaceMemberTx(tx, fx, spaceId, me, 'left');
  });
  res.status(204).end();
});

// POST /spaces/:spaceId/transfer-ownership (owner) → Space.
router.post('/spaces/:spaceId/transfer-ownership', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { userId } = parse(transferOwnershipSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const space = await lockSpace(tx, spaceId);
    if (space.ownerId !== me) {
      await requireSpaceMember(tx, spaceId, me);
      throw forbidden('Only the owner can transfer ownership');
    }
    if (userId === me) return;
    const [target] = await tx
      .select({ u: spaceMembers.userId })
      .from(spaceMembers)
      .where(and(eq(spaceMembers.spaceId, spaceId), eq(spaceMembers.userId, userId)));
    if (!target) throw notFound('Member');
    await tx
      .update(spaces)
      .set({ ownerId: userId, updatedAt: new Date() })
      .where(eq(spaces.id, spaceId));
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'space.transfer',
      targetType: 'member',
      targetId: userId,
    });
    fxSpaceUpdated(fx, spaceId, { ownerId: userId });
    fxStructureChanged(fx, spaceId);
    fxSpaceUpsert(fx, [me, userId], spaceId);
  });
  res.json(await spaceOrThrow(me, spaceId));
});

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

// GET /spaces/:spaceId/channels → ChatSummary[] (those I can see)
router.get('/spaces/:spaceId/channels', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  await requireSpaceMember(db, spaceId, me);
  res.json(await spaceChannelSummaries(db, me, spaceId));
});

// POST /spaces/:spaceId/channels (MANAGE_CHANNELS) → ChatSummary (201). space:channels-changed → room.
router.post('/spaces/:spaceId/channels', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createSpaceChannelSchema, req.body ?? {});
  assertUserLimit(me, 'spaceChannelUpdate', USER_RATE_LIMITS.spaceChannelUpdate);
  const chatId = await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_CHANNELS);
    const [n] = await tx.select({ n: count() }).from(chats).where(eq(chats.spaceId, spaceId));
    if (Number(n?.n ?? 0) >= MAX_SPACE_CHANNELS)
      throw limitReached(`A Space can have at most ${MAX_SPACE_CHANNELS} channels`);
    const categoryId = body.categoryId ?? null;
    let overwrites: PermissionOverwrite[] = [];
    if (categoryId)
      overwrites = await categoryOverwrites(
        tx,
        (await requireCategory(tx, spaceId, categoryId)).id,
      );
    let synced = true;
    if (body.privateRoleIds) {
      const roleIds = new Set(access.ctx.roles.map((r) => r.id));
      for (const id of body.privateRoleIds) if (!roleIds.has(id)) throw notFound('Role');
      overwrites = [
        ...overwrites.filter(
          (o) =>
            o.targetId !== access.ctx.everyoneRoleId && !body.privateRoleIds!.includes(o.targetId),
        ),
        {
          targetType: 'role',
          targetId: access.ctx.everyoneRoleId,
          allow: 0,
          deny: PERM.VIEW_CHANNEL,
        },
        ...body.privateRoleIds
          .filter((id) => id !== access.ctx.everyoneRoleId)
          .map((id) => ({
            targetType: 'role' as const,
            targetId: id,
            allow: PERM.VIEW_CHANNEL,
            deny: 0,
          })),
        // The creator keeps seeing their private channel.
        { targetType: 'member', targetId: me, allow: PERM.VIEW_CHANNEL, deny: 0 },
      ];
      synced = false;
    }
    const [chat] = await tx
      .insert(chats)
      .values({
        type: body.type,
        name: channelName(body.type, body.name),
        spaceId,
        categoryId,
        position: await nextChannelPosition(tx, spaceId, categoryId),
        topic: body.type === 'space_text' ? (body.topic ?? null) : null,
        nsfw: body.nsfw ?? false,
        slowmodeSeconds: body.type === 'space_text' ? (body.slowmodeSeconds ?? 0) : 0,
        userLimit: body.type === 'space_voice' ? (body.userLimit ?? null) : null,
        permissionsSynced: synced,
        createdBy: me,
      })
      .returning();
    await setChannelOverwrites(tx, chat!.id, overwrites);
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'channel.create',
      targetType: 'channel',
      targetId: chat!.id,
      changes: { name: chat!.name, type: chat!.type },
    });
    fxStructureChanged(fx, spaceId);
    fxChannelsChanged(fx, spaceId);
    return chat!.id;
  });
  res.status(201).json(await channelSummary(me, chatId));
});

// PATCH /spaces/:spaceId/channels/positions (MANAGE_CHANNELS) → 204. space:channels-changed → room.
router.patch('/spaces/:spaceId/channels/positions', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { items } = parse(channelPositionsSchema, req.body ?? {});
  assertUserLimit(me, 'spaceChannelUpdate', USER_RATE_LIMITS.spaceChannelUpdate);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_CHANNELS);
    const rows = await tx
      .select({ id: chats.id })
      .from(chats)
      .where(
        and(
          eq(chats.spaceId, spaceId),
          inArray(
            chats.id,
            items.map((i) => i.id),
          ),
        ),
      );
    if (rows.length !== items.length) throw notFound('Channel');
    const categoryIds = [
      ...new Set(items.map((i) => i.categoryId).filter((x): x is string => !!x)),
    ];
    if (categoryIds.length) {
      const cats = await tx
        .select({ id: spaceCategories.id })
        .from(spaceCategories)
        .where(and(eq(spaceCategories.spaceId, spaceId), inArray(spaceCategories.id, categoryIds)));
      if (cats.length !== categoryIds.length) throw notFound('Category');
    }
    let synced = false;
    for (const item of items) {
      await tx
        .update(chats)
        .set({ categoryId: item.categoryId, position: item.position, updatedAt: new Date() })
        .where(eq(chats.id, item.id));
      if (item.syncPermissions && item.categoryId) {
        await setChannelOverwrites(tx, item.id, await categoryOverwrites(tx, item.categoryId));
        await tx.update(chats).set({ permissionsSynced: true }).where(eq(chats.id, item.id));
        synced = true;
      }
    }
    if (synced) {
      await bumpPermVersion(tx, spaceId);
      fxStructureChanged(fx, spaceId);
    }
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'channel.reorder',
      targetType: 'space',
      targetId: spaceId,
      changes: { count: items.length },
    });
    fxChannelsChanged(fx, spaceId);
  });
  res.status(204).end();
});

// PATCH /spaces/:spaceId/channels/:chatId (MANAGE_CHANNELS in it) → ChatSummary. chat:updated {name, space} → R.
router.patch('/spaces/:spaceId/channels/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, chatId } = parse(P.channel, req.params);
  const body = parse(updateSpaceChannelSchema, req.body ?? {});
  assertUserLimit(me, 'spaceChannelUpdate', USER_RATE_LIMITS.spaceChannelUpdate);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    const chat = await requireSpaceChannel(tx, spaceId, chatId, { lock: true });
    const { overwrites } = await requireChannelBit(tx, access, me, chat, PERM.MANAGE_CHANNELS);
    const patch: Partial<typeof chats.$inferInsert> = {};
    if (body.name !== undefined) patch.name = channelName(chat.type as 'space_text', body.name);
    if (body.topic !== undefined) patch.topic = chat.type === 'space_text' ? body.topic : null;
    if (body.nsfw !== undefined) patch.nsfw = body.nsfw;
    if (body.slowmodeSeconds !== undefined && chat.type === 'space_text')
      patch.slowmodeSeconds = body.slowmodeSeconds;
    if (body.userLimit !== undefined && chat.type === 'space_voice')
      patch.userLimit = body.userLimit;
    if (Object.keys(patch).length === 0) return;
    const [fresh] = await tx
      .update(chats)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(chats.id, chatId))
      .returning();
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'channel.update',
      targetType: 'channel',
      targetId: chatId,
      changes: patch as Record<string, unknown>,
    });
    fx.chatUpdated(chatId, { name: fresh!.name, space: toSpaceChannelInfo(fresh!, overwrites) });
  });
  res.json(await channelSummary(me, chatId));
});

// DELETE /spaces/:spaceId/channels/:chatId (MANAGE_CHANNELS in it) → 204. space:channels-changed → room.
router.delete('/spaces/:spaceId/channels/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, chatId } = parse(P.channel, req.params);
  assertUserLimit(me, 'spaceChannelUpdate', USER_RATE_LIMITS.spaceChannelUpdate);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    const chat = await requireSpaceChannel(tx, spaceId, chatId, { lock: true });
    await requireChannelBit(tx, access, me, chat, PERM.MANAGE_CHANNELS);
    await runChatDeletionHooks(tx, fx, [chatId]);
    // The channel's (virtual) room learns first; then everyone refetches the list.
    fx.toChat(chatId, 'chat:removed', { chatId });
    await tx.delete(chats).where(eq(chats.id, chatId));
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'channel.delete',
      targetType: 'channel',
      targetId: chatId,
      changes: { name: chat.name },
    });
    fxStructureChanged(fx, spaceId);
    fxChannelsChanged(fx, spaceId);
  });
  res.status(204).end();
});

// PUT /spaces/:spaceId/channels/:chatId/overwrites/:targetType/:targetId (MANAGE_ROLES in it) → ChatSummary.
router.put(
  '/spaces/:spaceId/channels/:chatId/overwrites/:targetType/:targetId',
  async (req, res) => {
    const me = authUserId(req);
    const p = parse(channelOverwriteParams, req.params);
    const body = parse(overwriteInputSchema, req.body ?? {});
    assertUserLimit(me, 'spaceRoleUpdate', USER_RATE_LIMITS.spaceRoleUpdate);
    await transact(async (tx, fx) => {
      await lockSpace(tx, p.spaceId);
      const access = await requireSpaceMember(tx, p.spaceId, me);
      const chat = await requireSpaceChannel(tx, p.spaceId, p.chatId, { lock: true });
      const { bits, overwrites } = await requireChannelBit(tx, access, me, chat, PERM.MANAGE_ROLES);
      if (p.targetType === 'role' && !access.ctx.roles.some((r) => r.id === p.targetId))
        throw notFound('Role');
      if (p.targetType === 'member') {
        const [m] = await tx
          .select({ u: spaceMembers.userId })
          .from(spaceMembers)
          .where(and(eq(spaceMembers.spaceId, p.spaceId), eq(spaceMembers.userId, p.targetId)));
        if (!m) throw notFound('Member');
      }
      const prev = overwrites.find(
        (o) => o.targetType === p.targetType && o.targetId === p.targetId,
      );
      if (!prev && overwrites.length >= MAX_OVERWRITES_PER_CHANNEL)
        throw limitReached(`A channel can have at most ${MAX_OVERWRITES_PER_CHANNEL} overwrites`);
      assertGrantable(
        bits | access.base,
        (body.allow ^ (prev?.allow ?? 0)) | (body.deny ^ (prev?.deny ?? 0)),
      );
      await tx
        .insert(spaceChannelOverwrites)
        .values({
          chatId: chat.id,
          targetType: p.targetType,
          targetId: p.targetId,
          allow: body.allow,
          deny: body.deny,
        })
        .onConflictDoUpdate({
          target: [
            spaceChannelOverwrites.chatId,
            spaceChannelOverwrites.targetType,
            spaceChannelOverwrites.targetId,
          ],
          set: { allow: body.allow, deny: body.deny },
        });
      await tx.update(chats).set({ permissionsSynced: false }).where(eq(chats.id, chat.id));
      await bumpPermVersion(tx, p.spaceId);
      await audit(tx, {
        spaceId: p.spaceId,
        actorId: me,
        action: 'channel.overwrite.update',
        targetType: 'channel',
        targetId: chat.id,
        changes: { target: `${p.targetType}:${p.targetId}`, allow: body.allow, deny: body.deny },
      });
      await overwritesChangedFx(tx, fx, chat, overwrites);
    });
    res.json(await channelSummary(me, p.chatId).catch(() => null));
  },
);

// DELETE /spaces/:spaceId/channels/:chatId/overwrites/:targetType/:targetId → ChatSummary.
router.delete(
  '/spaces/:spaceId/channels/:chatId/overwrites/:targetType/:targetId',
  async (req, res) => {
    const me = authUserId(req);
    const p = parse(channelOverwriteParams, req.params);
    assertUserLimit(me, 'spaceRoleUpdate', USER_RATE_LIMITS.spaceRoleUpdate);
    await transact(async (tx, fx) => {
      await lockSpace(tx, p.spaceId);
      const access = await requireSpaceMember(tx, p.spaceId, me);
      const chat = await requireSpaceChannel(tx, p.spaceId, p.chatId, { lock: true });
      const { bits, overwrites } = await requireChannelBit(tx, access, me, chat, PERM.MANAGE_ROLES);
      const prev = overwrites.find(
        (o) => o.targetType === p.targetType && o.targetId === p.targetId,
      );
      if (!prev) return;
      assertGrantable(bits | access.base, prev.allow | prev.deny);
      await tx
        .delete(spaceChannelOverwrites)
        .where(
          and(
            eq(spaceChannelOverwrites.chatId, chat.id),
            eq(spaceChannelOverwrites.targetType, p.targetType),
            eq(spaceChannelOverwrites.targetId, p.targetId),
          ),
        );
      await tx.update(chats).set({ permissionsSynced: false }).where(eq(chats.id, chat.id));
      await bumpPermVersion(tx, p.spaceId);
      await audit(tx, {
        spaceId: p.spaceId,
        actorId: me,
        action: 'channel.overwrite.delete',
        targetType: 'channel',
        targetId: chat.id,
        changes: { target: `${p.targetType}:${p.targetId}` },
      });
      await overwritesChangedFx(tx, fx, chat, overwrites);
    });
    res.json(await channelSummary(me, p.chatId).catch(() => null));
  },
);

// POST /spaces/:spaceId/channels/:chatId/sync (MANAGE_ROLES in it) → ChatSummary: copy the category's overwrites.
router.post('/spaces/:spaceId/channels/:chatId/sync', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, chatId } = parse(P.channel, req.params);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpaceMember(tx, spaceId, me);
    const chat = await requireSpaceChannel(tx, spaceId, chatId, { lock: true });
    const { overwrites } = await requireChannelBit(tx, access, me, chat, PERM.MANAGE_ROLES);
    if (!chat.categoryId) throw badRequest('This channel is not in a category');
    await setChannelOverwrites(tx, chatId, await categoryOverwrites(tx, chat.categoryId));
    await tx.update(chats).set({ permissionsSynced: true }).where(eq(chats.id, chatId));
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'channel.sync',
      targetType: 'channel',
      targetId: chatId,
    });
    await overwritesChangedFx(tx, fx, chat, overwrites);
  });
  res.json(await channelSummary(me, chatId).catch(() => null));
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

async function categoryOf(spaceId: string, categoryId: string) {
  const cat = ((await loadCategories(db, [spaceId])).get(spaceId) ?? []).find(
    (c) => c.id === categoryId,
  );
  if (!cat) throw notFound('Category');
  return cat;
}

// POST /spaces/:spaceId/categories (MANAGE_CHANNELS) → SpaceCategory (201). space:updated {categories}.
router.post('/spaces/:spaceId/categories', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createCategorySchema, req.body ?? {});
  assertUserLimit(me, 'spaceChannelUpdate', USER_RATE_LIMITS.spaceChannelUpdate);
  const id = await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_CHANNELS);
    const [n] = await tx
      .select({ n: count(), top: sql<number>`coalesce(max(${spaceCategories.position}), -1)` })
      .from(spaceCategories)
      .where(eq(spaceCategories.spaceId, spaceId));
    if (Number(n?.n ?? 0) >= MAX_SPACE_CATEGORIES)
      throw limitReached(`A Space can have at most ${MAX_SPACE_CATEGORIES} categories`);
    const [cat] = await tx
      .insert(spaceCategories)
      .values({ spaceId, name: body.name, position: Number(n?.top ?? -1) + 1 })
      .returning();
    if (body.privateRoleIds) {
      const roleIds = new Set(access.ctx.roles.map((r) => r.id));
      for (const rid of body.privateRoleIds) if (!roleIds.has(rid)) throw notFound('Role');
      await tx
        .insert(spaceCategoryOverwrites)
        .values([
          {
            categoryId: cat!.id,
            targetType: 'role',
            targetId: access.ctx.everyoneRoleId,
            allow: 0,
            deny: PERM.VIEW_CHANNEL,
          },
          ...body.privateRoleIds
            .filter((rid) => rid !== access.ctx.everyoneRoleId)
            .map((rid) => ({
              categoryId: cat!.id,
              targetType: 'role' as const,
              targetId: rid,
              allow: PERM.VIEW_CHANNEL,
              deny: 0,
            })),
          {
            categoryId: cat!.id,
            targetType: 'member',
            targetId: me,
            allow: PERM.VIEW_CHANNEL,
            deny: 0,
          },
        ]);
    }
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'category.create',
      targetType: 'category',
      targetId: cat!.id,
      changes: { name: body.name },
    });
    fxCategoriesChanged(fx, spaceId);
    return cat!.id;
  });
  res.status(201).json(await categoryOf(spaceId, id));
});

// PATCH /spaces/:spaceId/categories/positions (MANAGE_CHANNELS) → 204.
router.patch('/spaces/:spaceId/categories/positions', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { items } = parse(categoryPositionsSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_CHANNELS);
    const rows = await tx
      .select({ id: spaceCategories.id })
      .from(spaceCategories)
      .where(
        and(
          eq(spaceCategories.spaceId, spaceId),
          inArray(
            spaceCategories.id,
            items.map((i) => i.id),
          ),
        ),
      );
    if (rows.length !== items.length) throw notFound('Category');
    for (const item of items)
      await tx
        .update(spaceCategories)
        .set({ position: item.position })
        .where(eq(spaceCategories.id, item.id));
    fxCategoriesChanged(fx, spaceId);
  });
  res.status(204).end();
});

// PATCH /spaces/:spaceId/categories/:categoryId (MANAGE_CHANNELS) → SpaceCategory.
router.patch('/spaces/:spaceId/categories/:categoryId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, categoryId } = parse(P.category, req.params);
  const body = parse(updateCategorySchema, req.body ?? {});
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_CHANNELS);
    await requireCategory(tx, spaceId, categoryId);
    await tx
      .update(spaceCategories)
      .set({ name: body.name })
      .where(eq(spaceCategories.id, categoryId));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'category.update',
      targetType: 'category',
      targetId: categoryId,
      changes: body,
    });
    fxCategoriesChanged(fx, spaceId);
  });
  res.json(await categoryOf(spaceId, categoryId));
});

// DELETE /spaces/:spaceId/categories/:categoryId (MANAGE_CHANNELS) → 204 (its channels become uncategorised).
router.delete('/spaces/:spaceId/categories/:categoryId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, categoryId } = parse(P.category, req.params);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_CHANNELS);
    const cat = await requireCategory(tx, spaceId, categoryId);
    await tx.delete(spaceCategories).where(eq(spaceCategories.id, categoryId));
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'category.delete',
      targetType: 'category',
      targetId: categoryId,
      changes: { name: cat.name },
    });
    fxCategoriesChanged(fx, spaceId);
    fxChannelsChanged(fx, spaceId);
  });
  res.status(204).end();
});

/** Category template edits propagate to the channels still synced with it. */
async function propagateCategory(
  tx: Parameters<Parameters<typeof transact>[0]>[0],
  fx: Parameters<Parameters<typeof transact>[0]>[1],
  spaceId: string,
  categoryId: string,
) {
  const template = await categoryOverwrites(tx, categoryId);
  const synced = await tx
    .select()
    .from(chats)
    .where(
      and(
        eq(chats.spaceId, spaceId),
        eq(chats.categoryId, categoryId),
        eq(chats.permissionsSynced, true),
      ),
    );
  const before = await loadChannelOverwrites(
    tx,
    synced.map((c) => c.id),
  );
  for (const chat of synced) {
    await setChannelOverwrites(tx, chat.id, template);
    await overwritesChangedFx(tx, fx, chat, before.get(chat.id) ?? []);
  }
  if (synced.length) await bumpPermVersion(tx, spaceId);
}

// PUT /spaces/:spaceId/categories/:categoryId/overwrites/:targetType/:targetId (MANAGE_ROLES) → SpaceCategory.
router.put(
  '/spaces/:spaceId/categories/:categoryId/overwrites/:targetType/:targetId',
  async (req, res) => {
    const me = authUserId(req);
    const p = parse(categoryOverwriteParams, req.params);
    const body = parse(overwriteInputSchema, req.body ?? {});
    assertUserLimit(me, 'spaceRoleUpdate', USER_RATE_LIMITS.spaceRoleUpdate);
    await transact(async (tx, fx) => {
      await lockSpace(tx, p.spaceId);
      const access = await requireSpacePermission(tx, p.spaceId, me, PERM.MANAGE_ROLES);
      await requireCategory(tx, p.spaceId, p.categoryId);
      if (p.targetType === 'role' && !access.ctx.roles.some((r) => r.id === p.targetId))
        throw notFound('Role');
      const prev = (await categoryOverwrites(tx, p.categoryId)).find(
        (o) => o.targetType === p.targetType && o.targetId === p.targetId,
      );
      assertGrantable(
        access.base,
        (body.allow ^ (prev?.allow ?? 0)) | (body.deny ^ (prev?.deny ?? 0)),
      );
      await tx
        .insert(spaceCategoryOverwrites)
        .values({
          categoryId: p.categoryId,
          targetType: p.targetType,
          targetId: p.targetId,
          allow: body.allow,
          deny: body.deny,
        })
        .onConflictDoUpdate({
          target: [
            spaceCategoryOverwrites.categoryId,
            spaceCategoryOverwrites.targetType,
            spaceCategoryOverwrites.targetId,
          ],
          set: { allow: body.allow, deny: body.deny },
        });
      await audit(tx, {
        spaceId: p.spaceId,
        actorId: me,
        action: 'category.overwrite.update',
        targetType: 'category',
        targetId: p.categoryId,
        changes: { target: `${p.targetType}:${p.targetId}`, allow: body.allow, deny: body.deny },
      });
      await propagateCategory(tx, fx, p.spaceId, p.categoryId);
      fxCategoriesChanged(fx, p.spaceId);
    });
    res.json(await categoryOf(p.spaceId, p.categoryId));
  },
);

// DELETE /spaces/:spaceId/categories/:categoryId/overwrites/:targetType/:targetId → SpaceCategory.
router.delete(
  '/spaces/:spaceId/categories/:categoryId/overwrites/:targetType/:targetId',
  async (req, res) => {
    const me = authUserId(req);
    const p = parse(categoryOverwriteParams, req.params);
    await transact(async (tx, fx) => {
      await lockSpace(tx, p.spaceId);
      const access = await requireSpacePermission(tx, p.spaceId, me, PERM.MANAGE_ROLES);
      await requireCategory(tx, p.spaceId, p.categoryId);
      const prev = (await categoryOverwrites(tx, p.categoryId)).find(
        (o) => o.targetType === p.targetType && o.targetId === p.targetId,
      );
      if (!prev) return;
      assertGrantable(access.base, prev.allow | prev.deny);
      await tx
        .delete(spaceCategoryOverwrites)
        .where(
          and(
            eq(spaceCategoryOverwrites.categoryId, p.categoryId),
            eq(spaceCategoryOverwrites.targetType, p.targetType),
            eq(spaceCategoryOverwrites.targetId, p.targetId),
          ),
        );
      await propagateCategory(tx, fx, p.spaceId, p.categoryId);
      fxCategoriesChanged(fx, p.spaceId);
    });
    res.json(await categoryOf(p.spaceId, p.categoryId));
  },
);

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

async function rolesOf(spaceId: string) {
  return (
    await db
      .select()
      .from(spaceRoles)
      .where(eq(spaceRoles.spaceId, spaceId))
      .orderBy(asc(spaceRoles.position))
  ).map(toSpaceRole);
}

// GET /spaces/:spaceId/roles → SpaceRole[] (position order)
router.get('/spaces/:spaceId/roles', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  await requireSpaceMember(db, spaceId, me);
  res.json(await rolesOf(spaceId));
});

/** Bits changing in a role that may change who sees channels → members refetch channels. */
const VIEW_AFFECTING = PERM.VIEW_CHANNEL | PERM.ADMINISTRATOR;

// POST /spaces/:spaceId/roles (MANAGE_ROLES) → SpaceRole (201), just above @everyone.
router.post('/spaces/:spaceId/roles', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const body = parse(createRoleSchema, req.body ?? {});
  assertUserLimit(me, 'spaceRoleUpdate', USER_RATE_LIMITS.spaceRoleUpdate);
  const roleId = await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_ROLES);
    if (access.ctx.roles.length >= MAX_SPACE_ROLES)
      throw limitReached(`A Space can have at most ${MAX_SPACE_ROLES} roles`);
    const permissions = body.permissions ?? 0;
    assertGrantable(access.base, permissions);
    // Positions stay dense: the new role takes 1, everything above moves up.
    await tx
      .update(spaceRoles)
      .set({ position: sql`${spaceRoles.position} + 1` })
      .where(and(eq(spaceRoles.spaceId, spaceId), sql`${spaceRoles.position} >= 1`));
    const [role] = await tx
      .insert(spaceRoles)
      .values({
        spaceId,
        name: body.name,
        color: body.color ?? null,
        position: 1,
        permissions,
        hoist: body.hoist ?? false,
        mentionable: body.mentionable ?? false,
      })
      .returning();
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'role.create',
      targetType: 'role',
      targetId: role!.id,
      changes: { name: body.name, permissions },
    });
    fxRolesChanged(fx, spaceId);
    fxStructureChanged(fx, spaceId);
    return role!.id;
  });
  res.status(201).json((await rolesOf(spaceId)).find((r) => r.id === roleId));
});

// PATCH /spaces/:spaceId/roles/positions (MANAGE_ROLES) → SpaceRole[]: roleIds highest first.
router.patch('/spaces/:spaceId/roles/positions', async (req, res) => {
  const me = authUserId(req);
  const { spaceId } = parse(P.space, req.params);
  const { roleIds } = parse(rolePositionsSchema, req.body ?? {});
  assertUserLimit(me, 'spaceRoleUpdate', USER_RATE_LIMITS.spaceRoleUpdate);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_ROLES);
    const others = access.ctx.roles.filter((r) => !r.isDefault);
    if (roleIds.length !== others.length || !others.every((r) => roleIds.includes(r.id)))
      throw badRequest('roleIds: list every role except @everyone exactly once');
    const top = myTop(access, me);
    const next = new Map(roleIds.map((id, i) => [id, roleIds.length - i]));
    for (const r of others) {
      const to = next.get(r.id)!;
      if (to === r.position) continue;
      // Only roles below mine move, and only to places below mine.
      if (r.position >= top || to >= top)
        throw forbidden('You can only reorder roles below your highest role');
    }
    for (const r of others) {
      const to = next.get(r.id)!;
      if (to !== r.position)
        await tx.update(spaceRoles).set({ position: to }).where(eq(spaceRoles.id, r.id));
    }
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'role.reorder',
      targetType: 'space',
      targetId: spaceId,
    });
    fxRolesChanged(fx, spaceId);
    fxStructureChanged(fx, spaceId);
  });
  res.json(await rolesOf(spaceId));
});

// PATCH /spaces/:spaceId/roles/:roleId (MANAGE_ROLES, below my highest role) → SpaceRole.
router.patch('/spaces/:spaceId/roles/:roleId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, roleId } = parse(P.role, req.params);
  const body = parse(updateRoleSchema, req.body ?? {});
  assertUserLimit(me, 'spaceRoleUpdate', USER_RATE_LIMITS.spaceRoleUpdate);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_ROLES);
    const role = access.ctx.roles.find((r) => r.id === roleId);
    if (!role) throw notFound('Role');
    if (!role.isDefault) assertRoleManageable(access, me, role.position);
    if (role.isDefault && (body.name !== undefined || body.hoist || body.color !== undefined))
      throw badRequest('@everyone can only change its permissions and mentionability');
    const patch: Partial<typeof spaceRoles.$inferInsert> = {};
    if (body.name !== undefined) patch.name = body.name;
    if (body.color !== undefined) patch.color = body.color;
    if (body.hoist !== undefined) patch.hoist = body.hoist;
    if (body.mentionable !== undefined) patch.mentionable = body.mentionable;
    if (body.permissions !== undefined) {
      assertGrantable(access.base, body.permissions ^ role.permissions);
      patch.permissions = body.permissions;
    }
    if (Object.keys(patch).length === 0) return;
    await tx.update(spaceRoles).set(patch).where(eq(spaceRoles.id, roleId));
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'role.update',
      targetType: 'role',
      targetId: roleId,
      changes: { ...patch, before: { permissions: role.permissions, name: role.name } },
    });
    fxRolesChanged(fx, spaceId);
    fxStructureChanged(fx, spaceId);
    if (body.permissions !== undefined && (body.permissions ^ role.permissions) & VIEW_AFFECTING)
      fxChannelsChanged(fx, spaceId);
  });
  res.json((await rolesOf(spaceId)).find((r) => r.id === roleId));
});

// DELETE /spaces/:spaceId/roles/:roleId (MANAGE_ROLES, below mine, not @everyone) → 204.
router.delete('/spaces/:spaceId/roles/:roleId', async (req, res) => {
  const me = authUserId(req);
  const { spaceId, roleId } = parse(P.role, req.params);
  assertUserLimit(me, 'spaceRoleUpdate', USER_RATE_LIMITS.spaceRoleUpdate);
  await transact(async (tx, fx) => {
    await lockSpace(tx, spaceId);
    const access = await requireSpacePermission(tx, spaceId, me, PERM.MANAGE_ROLES);
    const role = access.ctx.roles.find((r) => r.id === roleId);
    if (!role) throw notFound('Role');
    if (role.isDefault) throw badRequest('@everyone cannot be deleted');
    assertRoleManageable(access, me, role.position);
    await tx.delete(spaceRoles).where(eq(spaceRoles.id, roleId));
    // Overwrites of the role go too; positions above close the gap.
    await tx
      .delete(spaceChannelOverwrites)
      .where(
        and(
          eq(spaceChannelOverwrites.targetType, 'role'),
          eq(spaceChannelOverwrites.targetId, roleId),
        ),
      );
    await tx
      .delete(spaceCategoryOverwrites)
      .where(
        and(
          eq(spaceCategoryOverwrites.targetType, 'role'),
          eq(spaceCategoryOverwrites.targetId, roleId),
        ),
      );
    await tx
      .update(spaceRoles)
      .set({ position: sql`${spaceRoles.position} - 1` })
      .where(and(eq(spaceRoles.spaceId, spaceId), sql`${spaceRoles.position} > ${role.position}`));
    await bumpPermVersion(tx, spaceId);
    await audit(tx, {
      spaceId,
      actorId: me,
      action: 'role.delete',
      targetType: 'role',
      targetId: roleId,
      changes: { name: role.name },
    });
    fxRolesChanged(fx, spaceId);
    fxStructureChanged(fx, spaceId);
    fxChannelsChanged(fx, spaceId);
  });
  res.status(204).end();
});

router.use(membersRouter);
