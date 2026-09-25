import { Router } from 'express';
import { eq } from 'drizzle-orm';
import {
  addMembersSchema,
  createGroupSchema,
  idParamSchema,
  setRoleSchema,
  transferOwnershipSchema,
  updateGroupSchema,
  updateGroupSettingsSchema,
  type AddMembersResult,
  type ChatInfoChanges,
  type GroupSettings,
  type SystemEvent,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { chats } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import {
  activeMemberRows,
  getMembership,
  isAdminRole,
  requirePermission,
} from '../../services/chats.js';
import { communityUpsert, lockGroupScope } from '../../services/communities.js';
import { transact } from '../../services/effects.js';
import { generateUniqueInviteCode } from '../../services/invites.js';
import { mediaUrl, requireAvatarMedia } from '../../services/media.js';
import { changeRole, transferOwnership, upsertMembership } from '../../services/membership.js';
import { toChatSummary } from '../../services/summaries.js';
import { postSystemMessage } from '../../services/system.js';
import {
  addGroupMembersTx,
  createGroupTx,
  ensureInviteCode,
  normDescription,
  requireGroupAccess,
} from './service.js';

/**
 * Groups module — owns: /groups/* (type 'group', never announcement groups: those are
 * managed through /communities → 403). Rules: docs "Groups", "Permissions matrix",
 * "Membership transitions"; events: matrix rows `/groups/*`.
 */
export const router = Router();

const chatParams = idParamSchema('chatId');
const memberParams = idParamSchema('chatId', 'userId');
const SETTING_KEYS: (keyof GroupSettings)[] = [
  'onlyAdminsCanSend',
  'onlyAdminsCanEditInfo',
  'onlyAdminsCanAddMembers',
];

async function summaryOf(userId: string, chatId: string) {
  const chat = await toChatSummary(db, userId, chatId);
  if (!chat) throw notFound('Chat');
  return chat;
}

// POST /groups → AddMembersResult (201)
router.post('/groups', async (req, res) => {
  const me = authUserId(req);
  const body = parse(createGroupSchema, req.body ?? {});
  const result = await transact((tx, fx) => createGroupTx(tx, fx, { creatorId: me, body }));
  const out: AddMembersResult = {
    chat: await summaryOf(me, result.chat.id),
    added: result.toAdd,
    needsInvite: result.needsInvite,
    failed: result.failed,
  };
  res.status(201).json(out);
});

// PATCH /groups/:chatId → ChatSummary (canEditInfo; one system message per changed field)
router.patch('/groups/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const body = parse(updateGroupSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const access = await requireGroupAccess(tx, me, chatId, { lock: true });
    requirePermission(access, 'canEditInfo', 'Only admins can edit this group');
    const chat = access.chat;
    const changes: ChatInfoChanges = {};
    const set: Partial<typeof chats.$inferInsert> = {};
    const events: SystemEvent[] = [];
    if (body.name !== undefined && body.name !== chat.name) {
      set.name = body.name;
      changes.name = body.name;
      events.push({ kind: 'name_changed', actorId: me, name: body.name });
    }
    if (body.description !== undefined && normDescription(body.description) !== chat.description) {
      set.description = normDescription(body.description);
      changes.description = set.description;
      events.push({ kind: 'description_changed', actorId: me });
    }
    if (body.avatarMediaId !== undefined && body.avatarMediaId !== chat.avatarMediaId) {
      const avatar = body.avatarMediaId
        ? await requireAvatarMedia(tx, body.avatarMediaId, me)
        : null;
      set.avatarMediaId = avatar?.id ?? null;
      changes.avatarUrl = avatar ? mediaUrl(avatar.storageKey) : null;
      events.push({ kind: 'avatar_changed', actorId: me });
    }
    if (events.length === 0) return;
    await tx
      .update(chats)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(chats.id, chatId));
    for (const e of events) await postSystemMessage(tx, fx, chat, e);
    fx.chatUpdated(chatId, changes);
  });
  res.json(await summaryOf(me, chatId));
});

// PATCH /groups/:chatId/settings → ChatSummary (admins; one settings_changed per changed key)
router.patch('/groups/:chatId/settings', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const body = parse(updateGroupSettingsSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const access = await requireGroupAccess(tx, me, chatId, { lock: true });
    if (!isAdminRole(access.member.role)) throw forbidden('Only admins can change group settings');
    const current = access.chat.groupSettings!;
    const next: GroupSettings = { ...current };
    const changed: (keyof GroupSettings)[] = [];
    for (const key of SETTING_KEYS) {
      const value = body[key];
      if (value !== undefined && value !== current[key]) {
        next[key] = value;
        changed.push(key);
      }
    }
    if (changed.length === 0) return;
    await tx
      .update(chats)
      .set({ groupSettings: next, updatedAt: new Date() })
      .where(eq(chats.id, chatId));
    for (const key of changed)
      await postSystemMessage(tx, fx, access.chat, {
        kind: 'settings_changed',
        actorId: me,
        setting: key,
        value: next[key],
      });
    fx.chatUpdated(chatId, { groupSettings: next });
  });
  res.json(await summaryOf(me, chatId));
});

// POST /groups/:chatId/members → AddMembersResult (canAddMembers)
router.post('/groups/:chatId/members', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const { userIds } = parse(addMembersSchema, req.body ?? {});
  const plan = await transact(async (tx, fx) => {
    const { chat, scope } = await lockGroupScope(tx, chatId);
    const access = await requireGroupAccess(tx, me, chatId, { chat });
    requirePermission(access, 'canAddMembers', 'Only admins can add members');
    return addGroupMembersTx(tx, fx, { chat, scope, actorId: me, userIds });
  });
  const out: AddMembersResult = {
    chat: await summaryOf(me, chatId),
    added: plan.toAdd,
    needsInvite: plan.needsInvite,
    failed: plan.failed,
  };
  res.json(out);
});

// DELETE /groups/:chatId/members/:userId → 204 (admins; never the owner)
router.delete('/groups/:chatId/members/:userId', async (req, res) => {
  const me = authUserId(req);
  const { chatId, userId } = parse(memberParams, req.params);
  await transact(async (tx, fx) => {
    const access = await requireGroupAccess(tx, me, chatId, { lock: true });
    requirePermission(access, 'canRemoveMembers', 'Only admins can remove members');
    if (userId === me) throw badRequest('Use leave to exit the group');
    const target = await getMembership(tx, chatId, userId);
    if (!target || target.leftAt) throw notFound('Member');
    if (target.role === 'owner') throw forbidden('The group owner cannot be removed');
    await upsertMembership(tx, fx, {
      kind: 'deactivate',
      chatId,
      userId,
      reason: 'removed',
      systemEvent: { kind: 'member_removed', actorId: me, userId },
    });
    fx.memberCountChanged(chatId).membersChanged(access.chat);
    if (access.chat.communityId) communityUpsert(fx, userId, access.chat.communityId);
  });
  res.status(204).end();
});

// PUT /groups/:chatId/members/:userId/role → 204 (canManageAdmins; the owner can't be demoted)
router.put('/groups/:chatId/members/:userId/role', async (req, res) => {
  const me = authUserId(req);
  const { chatId, userId } = parse(memberParams, req.params);
  const { role } = parse(setRoleSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const access = await requireGroupAccess(tx, me, chatId, { lock: true });
    requirePermission(access, 'canManageAdmins', 'Only admins can manage admins');
    const changed = await changeRole(tx, fx, {
      chatId,
      userId,
      role,
      systemEvent:
        role === 'admin'
          ? { kind: 'admin_promoted', actorId: me, userId }
          : { kind: 'admin_demoted', actorId: me, userId },
    });
    if (changed) fx.membersChanged(access.chat);
  });
  res.status(204).end();
});

// POST /groups/:chatId/transfer-ownership → 204 (owner only; target: an active member)
router.post('/groups/:chatId/transfer-ownership', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const { userId } = parse(transferOwnershipSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const access = await requireGroupAccess(tx, me, chatId, { lock: true });
    if (access.member.role !== 'owner') throw forbidden('Only the owner can transfer ownership');
    if (userId === me) throw badRequest('You already own this group');
    await transferOwnership(tx, fx, {
      chatId,
      fromUserId: me,
      toUserId: userId,
      systemEvent: { kind: 'owner_transferred', actorId: me, userId },
    });
    fx.membersChanged(access.chat);
  });
  res.status(204).end();
});

// POST /groups/:chatId/leave → 204 (succession when the owner leaves)
router.post('/groups/:chatId/leave', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  await transact(async (tx, fx) => {
    const access = await requireGroupAccess(tx, me, chatId, { lock: true });
    await upsertMembership(tx, fx, {
      kind: 'deactivate',
      chatId,
      userId: me,
      reason: 'left',
      systemEvent: { kind: 'member_left', actorId: me },
    });
    fx.memberCountChanged(chatId).membersChanged(access.chat);
    if (access.chat.communityId) communityUpsert(fx, me, access.chat.communityId);
  });
  res.status(204).end();
});

// GET /groups/:chatId/invite → { code } (canInvite)
router.get('/groups/:chatId/invite', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const code = await transact(async (tx) => {
    const access = await requireGroupAccess(tx, me, chatId);
    requirePermission(access, 'canInvite', 'Only admins can share the invite link');
    return ensureInviteCode(tx, access.chat);
  });
  res.json({ code });
});

// POST /groups/:chatId/invite/reset → { code } (admins)
router.post('/groups/:chatId/invite/reset', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const code = await transact(async (tx, fx) => {
    const access = await requireGroupAccess(tx, me, chatId, { lock: true });
    if (!isAdminRole(access.member.role)) throw forbidden('Only admins can reset the invite link');
    const next = await generateUniqueInviteCode(tx);
    await tx
      .update(chats)
      .set({ inviteCode: next, updatedAt: new Date() })
      .where(eq(chats.id, chatId));
    await postSystemMessage(tx, fx, access.chat, { kind: 'invite_link_reset', actorId: me });
    const adminsOnly = access.chat.groupSettings?.onlyAdminsCanAddMembers ?? false;
    const inviters = (await activeMemberRows(tx, chatId))
      .filter((m) => !adminsOnly || isAdminRole(m.role))
      .map((m) => m.userId);
    fx.chatUpsert(inviters, chatId);
    return next;
  });
  res.json({ code });
});
