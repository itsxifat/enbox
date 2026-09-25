/**
 * Group domain operations shared by the groups, communities and invites modules. Every
 * function runs inside the caller's transaction (`tx`, `fx`) and registers its fan-out in
 * matrix order (docs "Mutation → event matrix", "Membership transitions", "Groups").
 */
import { eq } from 'drizzle-orm';
import { DEFAULT_GROUP_SETTINGS, MAX_GROUP_MEMBERS, USER_RATE_LIMITS, type AddMemberFailure, type createGroupSchema } from '@enbox/shared';
import type { z } from 'zod';
import type { DbOrTx, Tx } from '../../db/index.js';
import { chats, type ChatRow } from '../../db/schema.js';
import { conflict, forbidden, limitReached, notFound, notMember } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { activeMemberCount, activeMemberIds, getChatAccess, getMembership, lockChat, type ChatAccess, type ChatAccessOptions } from '../../services/chats.js';
import { addCommunityMembers, communityUpsert, type CommunityScope } from '../../services/communities.js';
import type { Effects } from '../../services/effects.js';
import { generateUniqueInviteCode } from '../../services/invites.js';
import { requireAvatarMedia } from '../../services/media.js';
import { ensureOwner, evaluateAddTargets, upsertMembership, wasRemovedByAdmin } from '../../services/membership.js';
import { postSystemMessage } from '../../services/system.js';
import { requireUser, settingsOf } from '../../services/users.js';

export type CreateGroupInput = z.output<typeof createGroupSchema>;

export interface AddPlan {
  /** Users that will be added (eligible and within capacity). */
  toAdd: string[];
  needsInvite: string[];
  failed: { userId: string; reason: AddMemberFailure }[];
}

/**
 * Add rules (docs "Groups → Adding"): unknown/deleted → not_found; already active →
 * already_member; block either way or groupsAddPermission → needsInvite (indistinguishable);
 * beyond MAX_GROUP_MEMBERS (counting `activeIds`) → limit_reached. Order preserved.
 */
export async function planAdds(dbx: DbOrTx, input: { adderId: string; userIds: string[]; activeIds: string[] }): Promise<AddPlan> {
  const t = await evaluateAddTargets(dbx, input);
  const room = Math.max(0, MAX_GROUP_MEMBERS - new Set(input.activeIds).size);
  const toAdd = t.eligible.slice(0, room);
  const overflow = t.eligible.slice(room).map((userId) => ({ userId, reason: 'limit_reached' as const }));
  return { toAdd, needsInvite: t.needsInvite, failed: [...t.failed, ...overflow] };
}

/** Per-user add limit (docs "Rate limits": addMembers, counted per added user). */
export function assertAddLimit(userId: string, n: number): void {
  if (n > 0) assertUserLimit(userId, 'addMembers', USER_RATE_LIMITS.addMembers, n);
}

/**
 * Guard of `/groups/:chatId/*` (docs "Route type guards"): 404 without a visible row or for
 * non-groups; announcement groups → 403 ("Manage it from the community"); former members →
 * 403 not_member unless `allowFormer`.
 */
export async function requireGroupAccess(
  dbx: DbOrTx,
  viewerId: string,
  chatId: string,
  opts: ChatAccessOptions & { allowFormer?: boolean } = {},
): Promise<ChatAccess> {
  const access = await getChatAccess(dbx, viewerId, chatId, opts);
  if (access.chat.type !== 'group') throw notFound('Chat');
  if (access.chat.isAnnouncement) throw forbidden('Manage it from the community');
  if (!opts.allowFormer && access.membership !== 'active') throw notMember();
  return access;
}

/** Normalised optional description ('' → null). */
export function normDescription(d: string | null | undefined): string | null {
  return d ? d : null;
}

/** The chat's invite code, generated on first use (codes are unique across chats and communities). */
export async function ensureInviteCode(tx: Tx, chat: Pick<ChatRow, 'id' | 'inviteCode'>): Promise<string> {
  if (chat.inviteCode) return chat.inviteCode;
  const locked = await lockChat(tx, chat.id);
  if (locked.inviteCode) return locked.inviteCode;
  const code = await generateUniqueInviteCode(tx);
  await tx.update(chats).set({ inviteCode: code }).where(eq(chats.id, chat.id));
  return code;
}

/**
 * `POST /groups` and `POST /communities/:id/groups` (matrix: JOIN(creator), JOIN(each
 * added); sys `group_created`, `members_added` → R; linked: community cascade). With a
 * `scope` the group is created linked to that community and its members become community
 * members (409 limit_reached when the community would overflow).
 */
export async function createGroupTx(
  tx: Tx,
  fx: Effects,
  input: { creatorId: string; body: CreateGroupInput; scope?: CommunityScope | null },
): Promise<{ chat: ChatRow } & AddPlan> {
  const { creatorId, body, scope } = input;
  const creator = await requireUser(tx, creatorId);
  if (body.avatarMediaId) await requireAvatarMedia(tx, body.avatarMediaId, creatorId);
  const plan = await planAdds(tx, { adderId: creatorId, userIds: body.memberIds, activeIds: [creatorId] });
  assertAddLimit(creatorId, plan.toAdd.length);

  const disappearingSeconds = body.disappearingSeconds !== undefined ? body.disappearingSeconds : settingsOf(creator).defaultDisappearingSeconds;
  const [chat] = await tx
    .insert(chats)
    .values({
      type: 'group',
      name: body.name,
      description: normDescription(body.description),
      avatarMediaId: body.avatarMediaId ?? null,
      createdBy: creatorId,
      communityId: scope?.community.id ?? null,
      groupSettings: { ...DEFAULT_GROUP_SETTINGS, ...body.settings },
      inviteCode: await generateUniqueInviteCode(tx),
      disappearingSeconds: disappearingSeconds ?? null,
    })
    .returning();
  const group = chat!;
  await upsertMembership(tx, fx, {
    kind: 'activate',
    chatId: group.id,
    userIds: [creatorId, ...plan.toAdd],
    roles: { [creatorId]: 'owner' },
    addedBy: creatorId,
    initial: true,
  });
  await postSystemMessage(tx, fx, group, { kind: 'group_created', actorId: creatorId, name: body.name });
  if (plan.toAdd.length) await postSystemMessage(tx, fx, group, { kind: 'members_added', actorId: creatorId, userIds: plan.toAdd });
  if (scope) {
    scope.groups.push(group);
    await addCommunityMembers(tx, fx, scope, [creatorId, ...plan.toAdd], { addedBy: creatorId, upsert: false });
  }
  return { chat: group, ...plan };
}

/**
 * `POST /groups/:c/members` (matrix: JOIN(each added); sys `members_added` → R;
 * `chat:updated {memberCount}` → R; `chat:members-changed` → R; community cascade). `chat`
 * must be locked (through `lockGroupScope` when linked). Permission checks are the caller's.
 */
export async function addGroupMembersTx(
  tx: Tx,
  fx: Effects,
  input: { chat: ChatRow; scope: CommunityScope | null; actorId: string; userIds: string[] },
): Promise<AddPlan> {
  const { chat, scope, actorId } = input;
  const plan = await planAdds(tx, { adderId: actorId, userIds: input.userIds, activeIds: await activeMemberIds(tx, chat.id) });
  assertAddLimit(actorId, plan.toAdd.length);
  if (plan.toAdd.length === 0) return plan;
  await upsertMembership(tx, fx, {
    kind: 'activate',
    chatId: chat.id,
    userIds: plan.toAdd,
    addedBy: actorId,
    systemEvent: { kind: 'members_added', actorId, userIds: plan.toAdd },
  });
  fx.memberCountChanged(chat.id).membersChanged(chat);
  if (scope) {
    await addCommunityMembers(tx, fx, scope, plan.toAdd, { addedBy: actorId, upsert: false });
    communityUpsert(fx, plan.toAdd, scope.community.id);
  }
  return plan;
}

/**
 * Self-join of a group: invite link (`member_joined_via_link`) or community page
 * (`member_joined`). Matrix: JOIN(me); sys → R; `chat:updated {memberCount}`;
 * `chat:members-changed`; community cascade + `community:upsert` → U(me). Errors: already
 * active → 409 conflict; removed by an admin (here or from the community) → 403; full →
 * 409 limit_reached. An ownerless (emptied) group gets the joiner as owner (`owner_changed`).
 */
export async function joinGroupTx(
  tx: Tx,
  fx: Effects,
  input: { chat: ChatRow; scope: CommunityScope | null; userId: string; via: 'member_joined_via_link' | 'member_joined' },
): Promise<void> {
  const { chat, scope, userId } = input;
  const row = await getMembership(tx, chat.id, userId);
  if (row && !row.leftAt) throw conflict('You are already a member of this group');
  if (await wasRemovedByAdmin(tx, chat, userId)) throw forbidden('You were removed by an admin');
  if ((await activeMemberCount(tx, chat.id)) >= MAX_GROUP_MEMBERS) throw limitReached('This group is full');
  await upsertMembership(tx, fx, { kind: 'activate', chatId: chat.id, userIds: [userId], addedBy: null, systemEvent: { kind: input.via, actorId: userId } });
  const promoted = await ensureOwner(tx, fx, chat.id);
  if (promoted) fx.chatUpsert(promoted, chat.id);
  fx.memberCountChanged(chat.id).membersChanged(chat);
  if (scope) {
    await addCommunityMembers(tx, fx, scope, [userId], { addedBy: null, upsert: false });
    communityUpsert(fx, userId, scope.community.id);
  }
}
