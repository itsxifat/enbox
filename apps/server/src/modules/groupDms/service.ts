/**
 * Group DMs (docs/design/discord-parity.md W7-E; contracts: `GROUP_DM_MAX_MEMBERS`,
 * `createGroupDmSchema`, `addGroupDmMembersSchema`). A group DM is a `group` chat with
 * `is_group_dm`: up to GROUP_DM_MAX_MEMBERS members (me included), friends only, an owner
 * and no admins, no invite links. It is built on the group machinery (groups/service.ts
 * `createGroupTx` / `addGroupMembersTx`, the membership pipeline and its system messages).
 * The /groups routes refuse what it lacks (admin settings, admins, invite links → 400) and
 * keep the rest: any member renames it or changes its icon (`PATCH /groups/:id`; a null name
 * clears it), leaves with a `member_left` notice (`POST /groups/:id/leave`), the owner
 * transfers ownership.
 *
 * - A friend is a user in my contacts: accepting a friend request saves us both ways, and
 *   clients show exactly that (`UserPublic.isContact`). Every target must be one, a live
 *   account, not blocked either way and allowing me to add them (`groupsAddPermission`),
 *   else 403 with one message for every case (a block is never revealed). All or nothing.
 * - Create: one friend → our 1:1 DM (`openDirectChat`); more → a new group DM with me as its
 *   owner and a `members_added` notice (no `group_created`).
 * - Add: any member adds their own friends; past the cap → 400 GROUP_DM_FULL.
 * - Remove: the owner removes others (`member_removed`); anyone removes themself, a silent
 *   leave (no notice). An owner leaving hands ownership to the longest-standing member
 *   (membership.ts succession, `owner_changed`); the last one out leaves it empty, as groups.
 */
import { and, eq, inArray } from 'drizzle-orm';
import type { z } from 'zod';
import { GROUP_DM_MAX_MEMBERS, type ChatSummary, type createGroupDmSchema } from '@enbox/shared';
import { db, type DbOrTx, type Tx } from '../../db/index.js';
import { contacts, type ChatRow } from '../../db/schema.js';
import { badRequest, forbidden, notFound } from '../../lib/errors.js';
import { activeMemberIds, getMembership, type ChatAccess } from '../../services/chats.js';
import { lockGroupScope, type CommunityScope } from '../../services/communities.js';
import { transact, type Effects } from '../../services/effects.js';
import { evaluateAddTargets, upsertMembership } from '../../services/membership.js';
import { uniq } from '../../services/sql.js';
import { toChatSummary } from '../../services/summaries.js';
import { openDirectChat } from '../chats/service.js';
import {
  addGroupMembersTx,
  createGroupTx,
  requireGroupAccess,
  type AddPlan,
} from '../groups/service.js';

export type CreateGroupDmInput = z.output<typeof createGroupDmSchema>;

export const GROUP_DM_FULL = `Group DMs can have up to ${GROUP_DM_MAX_MEMBERS} members`;
/** The one answer for every user I can't add: not a friend, blocked, private or gone. */
export const FRIENDS_ONLY = 'You can only add your friends to a group DM';

async function summaryOf(userId: string, chatId: string): Promise<ChatSummary> {
  const chat = await toChatSummary(db, userId, chatId);
  if (!chat) throw notFound('Chat');
  return chat;
}

/** `/groups` guard plus: 404 unless the chat is a group DM. */
async function requireGroupDm(
  dbx: DbOrTx,
  me: string,
  chatId: string,
  opts: { lock?: boolean; chat?: ChatRow } = {},
): Promise<ChatAccess> {
  const access = await requireGroupAccess(dbx, me, chatId, opts);
  if (!access.chat.isGroupDm) throw notFound('Group DM');
  return access;
}

/**
 * 403 FRIENDS_ONLY unless each of `userIds` (others, not members yet) is in my contacts, a
 * live account, not blocked either way and lets me add them (the group add rules).
 */
async function assertAddableFriends(dbx: DbOrTx, me: string, userIds: string[]): Promise<void> {
  const rows = await dbx
    .select({ id: contacts.contactId })
    .from(contacts)
    .where(and(eq(contacts.ownerId, me), inArray(contacts.contactId, userIds)));
  const friends = new Set(rows.map((r) => r.id));
  const targets = await evaluateAddTargets(dbx, { adderId: me, userIds });
  if (userIds.some((id) => !friends.has(id)) || targets.eligible.length !== userIds.length)
    throw forbidden(FRIENDS_ONLY);
}

/**
 * `POST /chats/group-dm`: one friend → our DM (opened, or the existing one); more → a new
 * group DM (`created`). Matrix: as `POST /groups` without `group_created`.
 */
export async function createGroupDm(
  me: string,
  body: CreateGroupDmInput,
): Promise<{ chat: ChatSummary; created: boolean }> {
  const userIds = uniq(body.userIds).filter((id) => id !== me);
  if (userIds.length === 0) throw badRequest('Pick at least one friend');
  if (userIds.length === 1) {
    await assertAddableFriends(db, me, userIds);
    return { chat: await openDirectChat(me, userIds[0]!), created: false };
  }
  const chatId = await transact(async (tx, fx) => {
    await assertAddableFriends(tx, me, userIds);
    const created = await createGroupTx(tx, fx, {
      creatorId: me,
      body: { name: body.name || null, memberIds: userIds },
      groupDm: true,
    });
    // The group add rules ran again in this transaction: anyone lost meanwhile → none of it.
    if (created.toAdd.length !== userIds.length) throw forbidden(FRIENDS_ONLY);
    return created.chat.id;
  });
  return { chat: await summaryOf(me, chatId), created: true };
}

/**
 * Add the actor's friends to a group DM, inside the caller's transaction (`chat` locked
 * through `lockGroupScope`, the actor an active member). Members already in are skipped
 * (`already_member`); the others all go in or none do: 400 GROUP_DM_FULL past the cap, 403
 * FRIENDS_ONLY. Events: as `addGroupMembersTx` (JOIN each, `members_added` → R, counts).
 */
export async function addGroupDmMembersTx(
  tx: Tx,
  fx: Effects,
  input: { chat: ChatRow; scope: CommunityScope | null; actorId: string; userIds: string[] },
): Promise<AddPlan> {
  const active = new Set(await activeMemberIds(tx, input.chat.id));
  const ids = uniq(input.userIds);
  const userIds = ids.filter((id) => !active.has(id));
  const skipped = ids
    .filter((id) => active.has(id))
    .map((userId) => ({ userId, reason: 'already_member' as const }));
  if (userIds.length === 0) return { toAdd: [], needsInvite: [], failed: skipped };
  if (active.size + userIds.length > GROUP_DM_MAX_MEMBERS) throw badRequest(GROUP_DM_FULL);
  await assertAddableFriends(tx, input.actorId, userIds);
  const plan = await addGroupMembersTx(tx, fx, { ...input, userIds });
  if (plan.toAdd.length !== userIds.length) throw forbidden(FRIENDS_ONLY);
  return { ...plan, failed: [...plan.failed, ...skipped] };
}

/** `POST /chats/:chatId/group-dm/members`: any member adds friends (see `addGroupDmMembersTx`). */
export async function addGroupDmMembers(
  me: string,
  chatId: string,
  userIds: string[],
): Promise<ChatSummary> {
  await transact(async (tx, fx) => {
    const { chat, scope } = await lockGroupScope(tx, chatId);
    await requireGroupDm(tx, me, chatId, { chat });
    await addGroupDmMembersTx(tx, fx, { chat, scope, actorId: me, userIds });
  });
  return summaryOf(me, chatId);
}

/**
 * `DELETE /chats/:chatId/group-dm/members/:userId`: the owner removes another member
 * (`member_removed` → R, then LEAVE); `userId` = me leaves silently (no notice). Matrix: as
 * the group remove / leave routes, ownership succession included.
 */
export async function removeGroupDmMember(
  me: string,
  chatId: string,
  userId: string,
): Promise<void> {
  await transact(async (tx, fx) => {
    const access = await requireGroupDm(tx, me, chatId, { lock: true });
    const self = userId === me;
    if (!self) {
      if (access.member.role !== 'owner')
        throw forbidden('Only the group owner can remove members');
      const target = await getMembership(tx, chatId, userId);
      if (!target || target.leftAt) throw notFound('Member');
    }
    await upsertMembership(tx, fx, {
      kind: 'deactivate',
      chatId,
      userId,
      reason: self ? 'left' : 'removed',
      systemEvent: self ? null : { kind: 'member_removed', actorId: me, userId },
    });
    fx.memberCountChanged(chatId).membersChanged(access.chat);
  });
}
