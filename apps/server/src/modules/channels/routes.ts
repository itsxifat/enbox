import { Router } from 'express';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_CHANNEL_SETTINGS,
  MESSAGES_PAGE_SIZE,
  channelDiscoverQuerySchema,
  createChannelSchema,
  idParamSchema,
  transferOwnershipSchema,
  updateChannelSchema,
  type ChannelPreview,
  type ChannelSettings,
  type ChatInfoChanges,
  type SystemEvent,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { chats } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { PUBLIC_WINDOW, adminIds, getMembership, lockChat, requirePermission } from '../../services/chats.js';
import { transact } from '../../services/effects.js';
import { generateUniqueInviteCode } from '../../services/invites.js';
import { mediaUrl, requireAvatarMedia } from '../../services/media.js';
import { changeRole, transferOwnership, upsertMembership } from '../../services/membership.js';
import { loadMessagePage } from '../../services/messages.js';
import { toChatSummary } from '../../services/summaries.js';
import { postSystemMessage } from '../../services/system.js';
import { ensureInviteCode, normDescription } from '../groups/service.js';
import {
  channelEntries,
  channelEntry,
  channelMatches,
  deleteChannelTx,
  followChannelTx,
  isPublicChannel,
  requireChannelAccess,
  requireChannelRow,
} from './service.js';
import './hooks.js';

/**
 * Channels module — owns: /channels/*. Owner/admins post and manage; followers read and
 * react. Public channels are discoverable, previewable and followable by id; private ones
 * are 404 to non-followers and joinable only through their invite link. Rules: docs
 * "Channels"; events: matrix rows `/channels/*`.
 */
export const router = Router();

const chatParams = idParamSchema('chatId');
const adminParams = idParamSchema('chatId', 'userId');

async function summaryOf(userId: string, chatId: string) {
  const chat = await toChatSummary(db, userId, chatId);
  if (!chat) throw notFound('Channel');
  return chat;
}

// POST /channels → ChatSummary (201). Matrix: JOIN(owner); sys channel_created → R.
router.post('/channels', async (req, res) => {
  const me = authUserId(req);
  const body = parse(createChannelSchema, req.body ?? {});
  const chatId = await transact(async (tx, fx) => {
    if (body.avatarMediaId) await requireAvatarMedia(tx, body.avatarMediaId, me);
    const channelSettings: ChannelSettings = { ...DEFAULT_CHANNEL_SETTINGS, isPublic: body.isPublic, reactions: body.reactions };
    const [chat] = await tx
      .insert(chats)
      .values({
        type: 'channel',
        name: body.name,
        description: normDescription(body.description),
        avatarMediaId: body.avatarMediaId ?? null,
        createdBy: me,
        channelSettings,
        inviteCode: await generateUniqueInviteCode(tx),
      })
      .returning();
    await upsertMembership(tx, fx, { kind: 'activate', chatId: chat!.id, userIds: [me], role: 'owner', addedBy: me });
    await postSystemMessage(tx, fx, chat!, { kind: 'channel_created', actorId: me, name: body.name });
    return chat!.id;
  });
  res.status(201).json(await summaryOf(me, chatId));
});

// GET /channels/discover → ChannelDirectoryEntry[] (public channels; optional name/description search)
router.get('/channels/discover', async (req, res) => {
  const me = authUserId(req);
  const { q, limit } = parse(channelDiscoverQuerySchema, req.query);
  res.json(await channelEntries(db, me, and(isPublicChannel, q ? channelMatches(q) : undefined), limit));
});

// GET /channels/:chatId → ChannelPreview (public channels, or channels I follow; else 404);
// `users` side-loads the users the page references, like MessagePage.
router.get('/channels/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const chat = await requireChannelRow(db, chatId);
  const member = await getMembership(db, chatId, me);
  const following = !!member && !member.leftAt;
  if (!following && !chat.channelSettings?.isPublic) throw notFound('Channel');
  const channel = await channelEntry(db, me, chatId);
  if (!channel) throw notFound('Channel');
  const page = await loadMessagePage(db, me, chatId, { limit: MESSAGES_PAGE_SIZE }, following ? {} : { window: PUBLIC_WINDOW, chatType: 'channel' });
  const out: ChannelPreview = { channel, messages: page.messages, users: page.users };
  res.json(out);
});

// PATCH /channels/:chatId → ChatSummary (admins). name/description/avatar: sys per field → R;
// then chat:updated {changed fields incl. channelSettings} → R.
router.patch('/channels/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const body = parse(updateChannelSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const access = await requireChannelAccess(tx, me, chatId, { lock: true });
    requirePermission(access, 'canEditInfo', 'Only channel admins can edit the channel');
    const chat = access.chat;
    const set: Partial<typeof chats.$inferInsert> = {};
    const changes: ChatInfoChanges = {};
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
      const avatar = body.avatarMediaId ? await requireAvatarMedia(tx, body.avatarMediaId, me) : null;
      set.avatarMediaId = avatar?.id ?? null;
      changes.avatarUrl = avatar ? mediaUrl(avatar.storageKey) : null;
      events.push({ kind: 'avatar_changed', actorId: me });
    }
    const current = chat.channelSettings ?? DEFAULT_CHANNEL_SETTINGS;
    const nextSettings: ChannelSettings = { ...current, ...(body.isPublic !== undefined ? { isPublic: body.isPublic } : {}), ...(body.reactions !== undefined ? { reactions: body.reactions } : {}) };
    if (nextSettings.isPublic !== current.isPublic || nextSettings.reactions !== current.reactions) {
      set.channelSettings = nextSettings;
      changes.channelSettings = nextSettings;
    }
    if (Object.keys(changes).length === 0) return;
    await tx
      .update(chats)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(chats.id, chatId));
    for (const e of events) await postSystemMessage(tx, fx, chat, e);
    fx.chatUpdated(chatId, changes);
  });
  res.json(await summaryOf(me, chatId));
});

// DELETE /channels/:chatId → 204 (owner). Matrix: chat:removed → R; clearChatRoom(c); delete (cascade).
router.delete('/channels/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  await transact(async (tx, fx) => {
    const access = await requireChannelAccess(tx, me, chatId, { lock: true });
    if (access.member.role !== 'owner') throw forbidden('Only the owner can delete the channel');
    await deleteChannelTx(tx, fx, chatId);
  });
  res.status(204).end();
});

// PUT /channels/:chatId/follow → ChatSummary (public channels by id; private: invite link only → 404).
// Idempotent: following again returns the summary without events.
router.put('/channels/:chatId/follow', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  await transact(async (tx, fx) => {
    const chat = await lockChat(tx, chatId);
    if (chat.type !== 'channel') throw notFound('Channel');
    const member = await getMembership(tx, chatId, me);
    if (member && !member.leftAt) return;
    if (!chat.channelSettings?.isPublic) throw notFound('Channel');
    await followChannelTx(tx, fx, chat, me);
  });
  res.json(await summaryOf(me, chatId));
});

// DELETE /channels/:chatId/follow → 204 (unfollow: the row is deleted; the owner → 409).
// Matrix: removeUserFromChat(me); chat:removed → U(me); chat:updated {memberCount} → R; members-changed → admins.
router.delete('/channels/:chatId/follow', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  await transact(async (tx, fx) => {
    const access = await requireChannelAccess(tx, me, chatId, { lock: true });
    await upsertMembership(tx, fx, { kind: 'unfollow', chatId, userId: me });
    fx.memberCountChanged(chatId).membersChanged(access.chat);
  });
  res.status(204).end();
});

/** Owner-only admin management; the target must follow the channel (404 otherwise). */
async function setChannelAdmin(me: string, chatId: string, userId: string, role: 'admin' | 'member') {
  await transact(async (tx, fx) => {
    const access = await requireChannelAccess(tx, me, chatId, { lock: true });
    requirePermission(access, 'canManageAdmins', 'Only the channel owner can manage admins');
    if (userId === me) throw badRequest('You own this channel');
    const target = await getMembership(tx, chatId, userId);
    if (!target || target.leftAt) throw notFound('Follower');
    if (await changeRole(tx, fx, { chatId, userId, role })) fx.membersChanged(access.chat);
  });
}

// PUT /channels/:chatId/admins/:userId → 204 (owner only). Matrix: chat:upsert → U(u); members-changed → admins.
router.put('/channels/:chatId/admins/:userId', async (req, res) => {
  const { chatId, userId } = parse(adminParams, req.params);
  await setChannelAdmin(authUserId(req), chatId, userId, 'admin');
  res.status(204).end();
});

// DELETE /channels/:chatId/admins/:userId → 204 (owner only)
router.delete('/channels/:chatId/admins/:userId', async (req, res) => {
  const { chatId, userId } = parse(adminParams, req.params);
  await setChannelAdmin(authUserId(req), chatId, userId, 'member');
  res.status(204).end();
});

// GET /channels/:chatId/invite → { code } (canInvite: admins)
router.get('/channels/:chatId/invite', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const code = await transact(async (tx) => {
    const access = await requireChannelAccess(tx, me, chatId);
    requirePermission(access, 'canInvite', 'Only channel admins can share the invite link');
    return ensureInviteCode(tx, access.chat);
  });
  res.json({ code });
});

// POST /channels/:chatId/invite/reset → { code } (owner/admins). Matrix: chat:upsert → U(each admin).
router.post('/channels/:chatId/invite/reset', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const code = await transact(async (tx, fx) => {
    const access = await requireChannelAccess(tx, me, chatId, { lock: true });
    requirePermission(access, 'canInvite', 'Only channel admins can reset the invite link');
    const next = await generateUniqueInviteCode(tx);
    await tx.update(chats).set({ inviteCode: next, updatedAt: new Date() }).where(eq(chats.id, chatId));
    fx.chatUpsert(await adminIds(tx, chatId), chatId);
    return next;
  });
  res.json({ code });
});

// POST /channels/:chatId/transfer-ownership → 204 (owner → an admin or follower; the old owner becomes admin).
// Matrix: chat:upsert → U(each changed user); members-changed → admins.
router.post('/channels/:chatId/transfer-ownership', async (req, res) => {
  const me = authUserId(req);
  const { chatId } = parse(chatParams, req.params);
  const { userId } = parse(transferOwnershipSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const access = await requireChannelAccess(tx, me, chatId, { lock: true });
    if (access.member.role !== 'owner') throw forbidden('Only the owner can transfer ownership');
    if (userId === me) throw badRequest('You already own this channel');
    await transferOwnership(tx, fx, { chatId, fromUserId: me, toUserId: userId });
    fx.membersChanged(access.chat);
  });
  res.status(204).end();
});
