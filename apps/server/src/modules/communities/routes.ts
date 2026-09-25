import { Router } from 'express';
import { and, asc, eq, sql } from 'drizzle-orm';
import {
  ANNOUNCEMENT_GROUP_SETTINGS,
  MAX_COMMUNITY_GROUPS,
  addMembersSchema,
  createCommunityGroupSchema,
  createCommunitySchema,
  idParamSchema,
  linkGroupsSchema,
  setRoleSchema,
  transferOwnershipSchema,
  updateCommunitySchema,
  type AddMembersResult,
  type ChatInfoChanges,
  type Community,
  type CommunityAddMembersResult,
  type CommunityMember,
  type SystemEvent,
} from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { chats, communities, communityMembers, type ChatRow, type CommunityMemberRow } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, conflict, forbidden, limitReached, notFound, notMember } from '../../lib/errors.js';
import { parse } from '../../lib/validate.js';
import { getChat, getChatAccess, getMembership, lockChats } from '../../services/chats.js';
import {
  addCommunityMembers,
  communityMemberIds,
  communityUpsert,
  communityUpsertAll,
  deactivateCommunity,
  getCommunityMember,
  isAdminRole,
  linkGroup,
  linkedGroupCount,
  listCommunities,
  lockCommunityScope,
  removeCommunityMember,
  toCommunity,
  unlinkGroup,
  type CommunityScope,
} from '../../services/communities.js';
import { transact } from '../../services/effects.js';
import { generateUniqueInviteCode } from '../../services/invites.js';
import { mediaUrl, requireAvatarMedia } from '../../services/media.js';
import { changeRole, transferOwnership, upsertMembership } from '../../services/membership.js';
import { toChatSummary } from '../../services/summaries.js';
import { postSystemMessage } from '../../services/system.js';
import { toUserPublicMap } from '../../services/users.js';
import { assertAddLimit, createGroupTx, joinGroupTx, normDescription, planAdds } from '../groups/service.js';
import './hooks.js';

/**
 * Communities module — owns: /communities/*. Non-members get 404 (previews go through
 * /invites); owner/admins manage groups, members, roles and the invite link; only the owner
 * deactivates or transfers. Rules: docs "Communities"; events: matrix rows `/communities/*`.
 */
export const router = Router();

const communityParams = idParamSchema('communityId');
const groupParams = idParamSchema('communityId', 'chatId');
const memberParams = idParamSchema('communityId', 'userId');

/** The caller's community membership: 404 for non-members, 403 when `role` isn't met. */
async function requireCommunityRole(dbx: DbOrTx, communityId: string, userId: string, role: 'member' | 'admin' | 'owner' = 'member'): Promise<CommunityMemberRow> {
  const member = await getCommunityMember(dbx, communityId, userId);
  if (!member) throw notFound('Community');
  if (role === 'admin' && !isAdminRole(member.role)) throw forbidden('Only community admins can do that');
  if (role === 'owner' && member.role !== 'owner') throw forbidden('Only the community owner can do that');
  return member;
}

async function communityOf(userId: string, communityId: string): Promise<Community> {
  const community = await toCommunity(db, userId, communityId);
  if (!community) throw notFound('Community');
  return community;
}

// GET /communities → Community[]
router.get('/communities', async (req, res) => {
  res.json(await listCommunities(db, authUserId(req)));
});

// POST /communities → Community (201). Matrix: JOIN(creator) into ann; community_created → R(ann);
// community:upsert → U(creator); per linked group: as link.
router.post('/communities', async (req, res) => {
  const me = authUserId(req);
  const body = parse(createCommunitySchema, req.body ?? {});
  const communityId = await transact(async (tx, fx) => {
    if (body.avatarMediaId) await requireAvatarMedia(tx, body.avatarMediaId, me);
    // Validate without locks first (never queue on the row lock of a chat I can't manage),
    // then lock (sorted) and re-validate; the community and its announcement group are new rows.
    for (const id of body.groupIds) await requireLinkableGroup(tx, me, id, (await getChat(tx, id)) ?? undefined);
    const locked = new Map((await lockChats(tx, body.groupIds)).map((c) => [c.id, c]));
    const groups: ChatRow[] = [];
    for (const id of body.groupIds) groups.push(await requireLinkableGroup(tx, me, id, locked.get(id)));

    const [community] = await tx
      .insert(communities)
      .values({
        name: body.name,
        description: normDescription(body.description),
        avatarMediaId: body.avatarMediaId ?? null,
        createdBy: me,
        inviteCode: await generateUniqueInviteCode(tx),
      })
      .returning();
    const [ann] = await tx
      .insert(chats)
      .values({
        type: 'group',
        name: body.name,
        description: normDescription(body.description),
        avatarMediaId: body.avatarMediaId ?? null,
        createdBy: me,
        communityId: community!.id,
        isAnnouncement: true,
        groupSettings: { ...ANNOUNCEMENT_GROUP_SETTINGS },
      })
      .returning();
    await tx.update(communities).set({ announcementChatId: ann!.id }).where(eq(communities.id, community!.id));
    await tx.insert(communityMembers).values({ communityId: community!.id, userId: me, role: 'owner' });
    await upsertMembership(tx, fx, { kind: 'activate', chatId: ann!.id, userIds: [me], roles: { [me]: 'owner' }, addedBy: me, initial: true });
    await postSystemMessage(tx, fx, ann!, { kind: 'community_created', actorId: me, name: body.name });
    communityUpsert(fx, me, community!.id);

    const scope: CommunityScope = { community: { ...community!, announcementChatId: ann!.id }, ann: ann!, groups: [], extra: new Map() };
    for (const group of groups) await linkGroup(tx, fx, scope, group, me);
    if (groups.length) communityUpsertAll(fx, community!.id);
    return community!.id;
  });
  res.status(201).json(await communityOf(me, communityId));
});

/**
 * A group the caller may link: visible (404), a group (404), an active membership (403
 * not_member), admin (403), not an announcement group nor linked to a community (409).
 */
async function requireLinkableGroup(tx: Tx, userId: string, chatId: string, chat: ChatRow | undefined): Promise<ChatRow> {
  if (!chat) throw notFound('Chat');
  const access = await getChatAccess(tx, userId, chatId, { chat });
  if (access.chat.type !== 'group') throw notFound('Chat');
  if (access.membership !== 'active') throw notMember();
  if (access.chat.isAnnouncement || access.chat.communityId) throw conflict('This group already belongs to a community');
  if (!isAdminRole(access.member.role)) throw forbidden('You must be an admin of the group to add it to a community');
  return access.chat;
}

// GET /communities/:communityId → Community (404 for non-members)
router.get('/communities/:communityId', async (req, res) => {
  const { communityId } = parse(communityParams, req.params);
  res.json(await communityOf(authUserId(req), communityId));
});

// PATCH /communities/:communityId → Community (owner/admins). Mirrors name/description/avatar
// into the announcement group: per changed field sys → R(ann), chat:updated → R(ann);
// community:upsert → U(each member).
router.patch('/communities/:communityId', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  const body = parse(updateCommunitySchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId);
    await requireCommunityRole(tx, communityId, me, 'admin');
    const { community, ann } = scope;
    const set: Partial<typeof communities.$inferInsert> = {};
    const changes: ChatInfoChanges = {};
    const events: SystemEvent[] = [];
    if (body.name !== undefined && body.name !== community.name) {
      set.name = body.name;
      changes.name = body.name;
      events.push({ kind: 'name_changed', actorId: me, name: body.name });
    }
    if (body.description !== undefined && normDescription(body.description) !== community.description) {
      set.description = normDescription(body.description);
      changes.description = set.description;
      events.push({ kind: 'description_changed', actorId: me });
    }
    if (body.avatarMediaId !== undefined && body.avatarMediaId !== community.avatarMediaId) {
      const avatar = body.avatarMediaId ? await requireAvatarMedia(tx, body.avatarMediaId, me) : null;
      set.avatarMediaId = avatar?.id ?? null;
      changes.avatarUrl = avatar ? mediaUrl(avatar.storageKey) : null;
      events.push({ kind: 'avatar_changed', actorId: me });
    }
    if (events.length === 0) return;
    const now = new Date();
    await tx
      .update(communities)
      .set({ ...set, updatedAt: now })
      .where(eq(communities.id, communityId));
    await tx
      .update(chats)
      .set({ ...set, updatedAt: now })
      .where(eq(chats.id, ann.id));
    for (const e of events) await postSystemMessage(tx, fx, ann, e);
    fx.chatUpdated(ann.id, changes);
    communityUpsertAll(fx, communityId);
  });
  res.json(await communityOf(me, communityId));
});

// DELETE /communities/:communityId → 204 (owner deactivates; see docs "Deactivation")
router.delete('/communities/:communityId', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId, { groups: true });
    await requireCommunityRole(tx, communityId, me, 'owner');
    await deactivateCommunity(tx, fx, scope, me);
  });
  res.status(204).end();
});

// POST /communities/:communityId/groups → AddMembersResult (201; owner/admins). As POST /groups
// (created linked) + community cascade; community:upsert → U(each community member).
router.post('/communities/:communityId/groups', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  const body = parse(createCommunityGroupSchema, req.body ?? {});
  const result = await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId);
    await requireCommunityRole(tx, communityId, me, 'admin');
    if ((await linkedGroupCount(tx, communityId)) >= MAX_COMMUNITY_GROUPS) throw limitReached(`A community can have at most ${MAX_COMMUNITY_GROUPS} groups`);
    const created = await createGroupTx(tx, fx, { creatorId: me, body, scope });
    communityUpsertAll(fx, communityId);
    return created;
  });
  const chat = await toChatSummary(db, me, result.chat.id);
  const out: AddMembersResult = { chat: chat!, added: result.toAdd, needsInvite: result.needsInvite, failed: result.failed };
  res.status(201).json(out);
});

// POST /communities/:communityId/groups/link → Community (owner/admins who also admin each group)
router.post('/communities/:communityId/groups/link', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  const { chatIds } = parse(linkGroupsSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    // Unlocked pre-checks (no row locks for callers who may not link), then under the locks.
    await requireCommunityRole(tx, communityId, me, 'admin');
    for (const id of chatIds) await requireLinkableGroup(tx, me, id, (await getChat(tx, id)) ?? undefined);
    const scope = await lockCommunityScope(tx, communityId, { extraChatIds: chatIds });
    await requireCommunityRole(tx, communityId, me, 'admin');
    const groups: ChatRow[] = [];
    for (const id of chatIds) groups.push(await requireLinkableGroup(tx, me, id, scope.extra.get(id)));
    if ((await linkedGroupCount(tx, communityId)) + groups.length > MAX_COMMUNITY_GROUPS) {
      throw limitReached(`A community can have at most ${MAX_COMMUNITY_GROUPS} groups`);
    }
    for (const group of groups) await linkGroup(tx, fx, scope, group, me);
    communityUpsertAll(fx, communityId);
  });
  res.json(await communityOf(me, communityId));
});

// DELETE /communities/:communityId/groups/:chatId → Community (unlink; owner/admins; not the announcement group)
router.delete('/communities/:communityId/groups/:chatId', async (req, res) => {
  const me = authUserId(req);
  const { communityId, chatId } = parse(groupParams, req.params);
  await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId, { extraChatIds: [chatId] });
    await requireCommunityRole(tx, communityId, me, 'admin');
    const group = scope.extra.get(chatId);
    if (!group || group.communityId !== communityId) throw notFound('Group');
    if (group.isAnnouncement) throw forbidden("The announcement group can't be removed from its community");
    await unlinkGroup(tx, fx, scope, group, me);
    communityUpsertAll(fx, communityId);
  });
  res.json(await communityOf(me, communityId));
});

// POST /communities/:communityId/groups/:chatId/join → ChatSummary (community members; not if removed)
router.post('/communities/:communityId/groups/:chatId/join', async (req, res) => {
  const me = authUserId(req);
  const { communityId, chatId } = parse(groupParams, req.params);
  await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId, { extraChatIds: [chatId] });
    await requireCommunityRole(tx, communityId, me);
    const group = scope.extra.get(chatId);
    if (!group || group.communityId !== communityId) throw notFound('Group');
    if (group.isAnnouncement) throw conflict('You are already a member of the announcement group');
    await joinGroupTx(tx, fx, { chat: group, scope, userId: me, via: 'member_joined' });
  });
  const chat = await toChatSummary(db, me, chatId);
  if (!chat) throw notFound('Chat');
  res.json(chat);
});

// GET /communities/:communityId/members → CommunityMember[] (owner/admins only)
router.get('/communities/:communityId/members', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  await requireCommunityRole(db, communityId, me, 'admin');
  const rows = await db
    .select()
    .from(communityMembers)
    .where(eq(communityMembers.communityId, communityId))
    .orderBy(sql`case ${communityMembers.role} when 'owner' then 0 when 'admin' then 1 else 2 end`, asc(communityMembers.joinedAt), asc(communityMembers.userId));
  const users = await toUserPublicMap(
    db,
    me,
    rows.map((r) => r.userId),
  );
  const out: CommunityMember[] = rows.flatMap((r) => {
    const user = users.get(r.userId);
    return user ? [{ user, role: r.role, joinedAt: r.joinedAt.toISOString() }] : [];
  });
  res.json(out);
});

// POST /communities/:communityId/members → CommunityAddMembersResult (owner/admins; group add rules).
// Matrix: per added u: JOIN(u) into ann; community:upsert → U(u); chat:updated {memberCount} → R(ann);
// chat:members-changed → ann admins.
router.post('/communities/:communityId/members', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  const { userIds } = parse(addMembersSchema, req.body ?? {});
  const plan = await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId);
    await requireCommunityRole(tx, communityId, me, 'admin');
    const plan = await planAdds(tx, { adderId: me, userIds, activeIds: await communityMemberIds(tx, communityId) });
    assertAddLimit(me, plan.toAdd.length);
    await addCommunityMembers(tx, fx, scope, plan.toAdd, { addedBy: me });
    return plan;
  });
  const out: CommunityAddMembersResult = { community: await communityOf(me, communityId), added: plan.toAdd, needsInvite: plan.needsInvite, failed: plan.failed };
  res.json(out);
});

// DELETE /communities/:communityId/members/:userId → 204 (owner/admins; never the owner; cascades out of every linked group)
router.delete('/communities/:communityId/members/:userId', async (req, res) => {
  const me = authUserId(req);
  const { communityId, userId } = parse(memberParams, req.params);
  await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId, { groups: true });
    await requireCommunityRole(tx, communityId, me, 'admin');
    if (userId === me) throw badRequest('Use leave to exit the community');
    const target = await getCommunityMember(tx, communityId, userId);
    if (!target) throw notFound('Member');
    if (target.role === 'owner') throw forbidden('The community owner cannot be removed');
    await removeCommunityMember(tx, fx, scope, userId, { reason: 'removed', actorId: me });
  });
  res.status(204).end();
});

// PUT /communities/:communityId/members/:userId/role → 204 (owner/admins; not the owner).
// Matrix: community:upsert + chat:upsert(ann) → U(u); chat:members-changed → ann admins.
router.put('/communities/:communityId/members/:userId/role', async (req, res) => {
  const me = authUserId(req);
  const { communityId, userId } = parse(memberParams, req.params);
  const { role } = parse(setRoleSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId);
    await requireCommunityRole(tx, communityId, me, 'admin');
    const target = await getCommunityMember(tx, communityId, userId);
    if (!target) throw notFound('Member');
    if (target.role === 'owner') throw forbidden('The community owner cannot be demoted');
    if (target.role === role) return;
    await tx
      .update(communityMembers)
      .set({ role })
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
    communityUpsert(fx, userId, communityId);
    const annRow = await getMembership(tx, scope.ann.id, userId);
    if (annRow && !annRow.leftAt) await changeRole(tx, fx, { chatId: scope.ann.id, userId, role });
    fx.membersChanged(scope.ann);
  });
  res.status(204).end();
});

// POST /communities/:communityId/transfer-ownership → 204 (owner → any member; old owner becomes admin)
router.post('/communities/:communityId/transfer-ownership', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  const { userId } = parse(transferOwnershipSchema, req.body ?? {});
  await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId);
    await requireCommunityRole(tx, communityId, me, 'owner');
    if (userId === me) throw badRequest('You already own this community');
    if (!(await getCommunityMember(tx, communityId, userId))) throw notFound('Member');
    // Demote first, then promote (one-owner unique index is checked per row).
    await tx
      .update(communityMembers)
      .set({ role: 'admin' })
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, me)));
    await tx
      .update(communityMembers)
      .set({ role: 'owner' })
      .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)));
    communityUpsert(fx, [me, userId], communityId);
    await transferOwnership(tx, fx, { chatId: scope.ann.id, fromUserId: me, toUserId: userId });
    fx.membersChanged(scope.ann);
  });
  res.status(204).end();
});

// POST /communities/:communityId/leave → 204 (leaves the community and all its groups; succession)
router.post('/communities/:communityId/leave', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  await transact(async (tx, fx) => {
    const scope = await lockCommunityScope(tx, communityId, { groups: true });
    await requireCommunityRole(tx, communityId, me);
    await removeCommunityMember(tx, fx, scope, me, { reason: 'left', actorId: me });
  });
  res.status(204).end();
});

// GET /communities/:communityId/invite → { code } (owner/admins)
router.get('/communities/:communityId/invite', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  await requireCommunityRole(db, communityId, me, 'admin');
  const [row] = await db.select({ code: communities.inviteCode }).from(communities).where(eq(communities.id, communityId));
  if (!row) throw notFound('Community');
  res.json({ code: row.code });
});

// POST /communities/:communityId/invite/reset → { code } (owner/admins); community:upsert → U(each owner/admin)
router.post('/communities/:communityId/invite/reset', async (req, res) => {
  const me = authUserId(req);
  const { communityId } = parse(communityParams, req.params);
  const code = await transact(async (tx, fx) => {
    await lockCommunityScope(tx, communityId);
    await requireCommunityRole(tx, communityId, me, 'admin');
    const next = await generateUniqueInviteCode(tx);
    await tx.update(communities).set({ inviteCode: next, updatedAt: new Date() }).where(eq(communities.id, communityId));
    const admins = await tx
      .select({ userId: communityMembers.userId })
      .from(communityMembers)
      .where(and(eq(communityMembers.communityId, communityId), sql`${communityMembers.role} in ('owner', 'admin')`));
    communityUpsert(
      fx,
      admins.map((a) => a.userId),
      communityId,
    );
    return next;
  });
  res.json({ code });
});
