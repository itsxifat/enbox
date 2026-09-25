/**
 * Communities (docs "Communities", "Membership transitions", matrix rows `/communities/*`).
 *
 * - `community_members` is authoritative; the announcement group's `chat_members` mirror it
 *   (membership and role) in the same transaction. Announcement groups get no
 *   join/leave/add/remove system messages.
 * - Invariant: active announcement members = community members ⊇ active members of every
 *   linked group. Becoming active in a linked group (admin add, creation, invite join,
 *   community-page join, linking) adds the user to the community (`addCommunityMembers`);
 *   leaving/being removed from the community removes the user from the announcement group
 *   and every linked group (`removeCommunityMember`).
 * - Lock order (docs "Transactions"): the `communities` row FIRST, then the chats (sorted, one
 *   `lockChats` call) — `lockCommunityScope` / `lockGroupScope` do both.
 *
 * Fan-out helpers register in `Effects` like the other services; `Community` payloads are
 * viewer-specific (→ user:<id>) and serialized in the prepare phase through `tx`.
 */
import { and, asc, count, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import {
  MAX_GROUP_MEMBERS,
  type Community,
  type CommunityGroup,
  type MemberRole,
} from '@enbox/shared';
import type { DbOrTx, Tx } from '../db/index.js';
import {
  chatMembers,
  chats,
  communities,
  communityMembers,
  media,
  type ChatRow,
  type CommunityMemberRow,
  type CommunityRow,
} from '../db/schema.js';
import { conflict, limitReached, notFound } from '../lib/errors.js';
import { emitToUser } from '../realtime/emit.js';
import { getChat, getMembership, lockChats } from './chats.js';
import type { Effects } from './effects.js';
import { runChatDeletionHooks } from './hooks.js';
import { mediaUrl } from './media.js';
import { upsertMembership } from './membership.js';
import { pairKey, uniq } from './sql.js';
import { postSystemMessage } from './system.js';
import { lockLiveUsers } from './users.js';

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * `Community` for many (community, viewer) pairs in a fixed number of queries. Pairs whose
 * viewer is not a member are absent (non-members never see a community). Keyed by
 * `pairKey(communityId, userId)`. Groups: the announcement group first, then linked groups
 * by creation time.
 */
export async function communitiesForPairs(
  dbx: DbOrTx,
  pairs: { communityId: string; userId: string }[],
): Promise<Map<string, Community>> {
  const out = new Map<string, Community>();
  if (pairs.length === 0) return out;
  const communityIds = uniq(pairs.map((p) => p.communityId));
  const userIds = uniq(pairs.map((p) => p.userId));

  const rows = await dbx
    .select({ community: communities, avatarKey: media.storageKey })
    .from(communities)
    .leftJoin(media, eq(media.id, communities.avatarMediaId))
    .where(inArray(communities.id, communityIds));
  const memberRows = await dbx
    .select()
    .from(communityMembers)
    .where(
      and(
        inArray(communityMembers.communityId, communityIds),
        inArray(communityMembers.userId, userIds),
      ),
    );
  const counts = await dbx
    .select({ communityId: communityMembers.communityId, n: count() })
    .from(communityMembers)
    .where(inArray(communityMembers.communityId, communityIds))
    .groupBy(communityMembers.communityId);
  const groupRows = await dbx
    .select({
      id: chats.id,
      name: chats.name,
      description: chats.description,
      communityId: chats.communityId,
      isAnnouncement: chats.isAnnouncement,
      createdAt: chats.createdAt,
      avatarKey: media.storageKey,
    })
    .from(chats)
    .leftJoin(media, eq(media.id, chats.avatarMediaId))
    .where(inArray(chats.communityId, communityIds))
    .orderBy(asc(chats.createdAt), asc(chats.id));
  const chatIds = groupRows.map((g) => g.id);
  const chatCounts = chatIds.length
    ? await dbx
        .select({ chatId: chatMembers.chatId, n: count() })
        .from(chatMembers)
        .where(and(inArray(chatMembers.chatId, chatIds), isNull(chatMembers.leftAt)))
        .groupBy(chatMembers.chatId)
    : [];
  const mine = chatIds.length
    ? await dbx
        .select({ chatId: chatMembers.chatId, userId: chatMembers.userId })
        .from(chatMembers)
        .where(
          and(
            inArray(chatMembers.chatId, chatIds),
            inArray(chatMembers.userId, userIds),
            isNull(chatMembers.leftAt),
          ),
        )
    : [];

  const byId = new Map(rows.map((r) => [r.community.id, r]));
  const roleOf = new Map(memberRows.map((m) => [pairKey(m.communityId, m.userId), m.role]));
  const countOf = new Map(counts.map((c) => [c.communityId, Number(c.n)]));
  const chatCountOf = new Map(chatCounts.map((c) => [c.chatId, Number(c.n)]));
  const activeIn = new Set(mine.map((m) => pairKey(m.chatId, m.userId)));
  const groupsOf = new Map<string, typeof groupRows>();
  for (const g of groupRows)
    groupsOf.set(g.communityId!, [...(groupsOf.get(g.communityId!) ?? []), g]);

  for (const { communityId, userId } of pairs) {
    const r = byId.get(communityId);
    const role = roleOf.get(pairKey(communityId, userId));
    if (!r || !role || !r.community.announcementChatId) continue;
    const c = r.community;
    const list = [...(groupsOf.get(communityId) ?? [])].sort(
      (a, b) => Number(b.isAnnouncement) - Number(a.isAnnouncement),
    );
    const groups: CommunityGroup[] = list.map((g) => ({
      chatId: g.id,
      name: g.name ?? '',
      description: g.description,
      avatarUrl: g.avatarKey ? mediaUrl(g.avatarKey) : null,
      memberCount: chatCountOf.get(g.id) ?? 0,
      isAnnouncement: g.isAnnouncement,
      isMember: activeIn.has(pairKey(g.id, userId)),
    }));
    out.set(pairKey(communityId, userId), {
      id: c.id,
      name: c.name,
      description: c.description,
      avatarUrl: r.avatarKey ? mediaUrl(r.avatarKey) : null,
      createdBy: c.createdBy,
      createdAt: c.createdAt.toISOString(),
      memberCount: countOf.get(communityId) ?? 0,
      myRole: role,
      announcementChatId: c.announcementChatId!,
      groups,
      inviteCode: role === 'owner' || role === 'admin' ? c.inviteCode : null,
    });
  }
  return out;
}

/** `toCommunity(dbx, viewerId, communityId)` (docs): the viewer's Community, or null for non-members. */
export async function toCommunity(
  dbx: DbOrTx,
  viewerId: string,
  communityId: string,
): Promise<Community | null> {
  return (
    (await communitiesForPairs(dbx, [{ communityId, userId: viewerId }])).get(
      pairKey(communityId, viewerId),
    ) ?? null
  );
}

/** Every community the user belongs to (`GET /communities`), by name. */
export async function listCommunities(dbx: DbOrTx, viewerId: string): Promise<Community[]> {
  const rows = await dbx
    .select({ communityId: communityMembers.communityId })
    .from(communityMembers)
    .where(eq(communityMembers.userId, viewerId));
  const map = await communitiesForPairs(
    dbx,
    rows.map((r) => ({ communityId: r.communityId, userId: viewerId })),
  );
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}

/**
 * `community:upsert` → user:<u> for each user with their own Community as of the end of the
 * transaction (one batched serialization per call). Users who are no longer members are skipped.
 */
export function communityUpsert(
  fx: Effects,
  userIds: string | Iterable<string>,
  communityId: string,
): Effects {
  const ids = typeof userIds === 'string' ? [userIds] : uniq(userIds);
  if (ids.length === 0) return fx;
  let payloads = new Map<string, Community>();
  return fx.add(
    () => {
      for (const userId of ids) {
        const community = payloads.get(pairKey(communityId, userId));
        if (community) emitToUser(userId, 'community:upsert', { community });
      }
    },
    async (dbx) => {
      payloads = await communitiesForPairs(
        dbx,
        ids.map((userId) => ({ communityId, userId })),
      );
    },
  );
}

/** `community:upsert` → every member of the community (membership read at the end of the tx). */
export function communityUpsertAll(fx: Effects, communityId: string): Effects {
  let payloads: [string, Community][] = [];
  return fx.add(
    () => {
      for (const [userId, community] of payloads)
        emitToUser(userId, 'community:upsert', { community });
    },
    async (dbx) => {
      const ids = await communityMemberIds(dbx, communityId);
      const map = await communitiesForPairs(
        dbx,
        ids.map((userId) => ({ communityId, userId })),
      );
      payloads = ids.flatMap((id) => {
        const c = map.get(pairKey(communityId, id));
        return c ? [[id, c] as [string, Community]] : [];
      });
    },
  );
}

// ---------------------------------------------------------------------------
// Lookups & locks
// ---------------------------------------------------------------------------

export async function getCommunity(dbx: DbOrTx, communityId: string): Promise<CommunityRow | null> {
  const [row] = await dbx
    .select()
    .from(communities)
    .where(eq(communities.id, communityId))
    .limit(1);
  return row ?? null;
}

export async function getCommunityMember(
  dbx: DbOrTx,
  communityId: string,
  userId: string,
): Promise<CommunityMemberRow | null> {
  const [row] = await dbx
    .select()
    .from(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.userId, userId)))
    .limit(1);
  return row ?? null;
}

export async function communityMemberIds(dbx: DbOrTx, communityId: string): Promise<string[]> {
  const rows = await dbx
    .select({ userId: communityMembers.userId })
    .from(communityMembers)
    .where(eq(communityMembers.communityId, communityId));
  return rows.map((r) => r.userId);
}

export async function communityMemberCount(dbx: DbOrTx, communityId: string): Promise<number> {
  const [row] = await dbx
    .select({ n: count() })
    .from(communityMembers)
    .where(eq(communityMembers.communityId, communityId));
  return Number(row?.n ?? 0);
}

/** Linked (non-announcement) groups of a community. */
export async function linkedGroupIds(dbx: DbOrTx, communityId: string): Promise<string[]> {
  const rows = await dbx
    .select({ id: chats.id })
    .from(chats)
    .where(and(eq(chats.communityId, communityId), eq(chats.isAnnouncement, false)));
  return rows.map((r) => r.id);
}

export function isAdminRole(role: MemberRole | null | undefined): boolean {
  return role === 'owner' || role === 'admin';
}

/** A locked community with its (locked) announcement group and, when requested, its locked linked groups. */
export interface CommunityScope {
  community: CommunityRow;
  ann: ChatRow;
  /** Linked groups (locked) when `groups: true`, by creation time; else []. */
  groups: ChatRow[];
  /** Extra chats locked in the same sorted call (e.g. groups about to be linked). */
  extra: Map<string, ChatRow>;
}

/**
 * Lock order: `communities` row FOR UPDATE, then ONE sorted `lockChats` over the announcement
 * group, the linked groups (`groups: true`) and `extraChatIds`. 404 when the community is gone.
 */
export async function lockCommunityScope(
  tx: Tx,
  communityId: string,
  opts: { groups?: boolean; extraChatIds?: string[] } = {},
): Promise<CommunityScope> {
  const [community] = await tx
    .select()
    .from(communities)
    .where(eq(communities.id, communityId))
    .for('update');
  if (!community?.announcementChatId) throw notFound('Community');
  const linked = opts.groups ? await linkedGroupIds(tx, communityId) : [];
  const rows = await lockChats(tx, [
    community.announcementChatId,
    ...linked,
    ...(opts.extraChatIds ?? []),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const ann = byId.get(community.announcementChatId);
  if (!ann) throw notFound('Community');
  const groups = opts.groups
    ? rows
        .filter((r) => r.communityId === communityId && !r.isAnnouncement)
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
    : [];
  const extra = new Map(
    (opts.extraChatIds ?? []).flatMap((id) =>
      byId.has(id) ? [[id, byId.get(id)!] as [string, ChatRow]] : [],
    ),
  );
  return { community, ann, groups, extra };
}

/** An attempt of `lockGroupScope` saw the community link change after locking the chat. */
class GroupLinkChanged extends Error {}

/**
 * Lock a group chat for a membership mutation honouring the lock order: when the group is
 * linked to a community, the community row is locked first, then the group and the
 * announcement group (one sorted call). Each attempt runs in a savepoint: when the link
 * changed concurrently after the chat was locked, rolling the savepoint back releases the
 * chat lock BEFORE the next attempt locks a community row (never community-after-chat).
 * 404 when the chat doesn't exist; `409 conflict` when the link keeps changing.
 */
export async function lockGroupScope(
  tx: Tx,
  chatId: string,
): Promise<{ chat: ChatRow; scope: CommunityScope | null }> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const pre = await getChat(tx, chatId);
    if (!pre) throw notFound('Chat');
    const communityId = pre.isAnnouncement ? null : pre.communityId;
    const linked = !!communityId && !!(await getCommunity(tx, communityId));
    try {
      return await tx.transaction(async (sp) => {
        if (!linked) {
          const [chat] = await lockChats(sp, [chatId]);
          if (!chat) throw notFound('Chat');
          if (chat.communityId && !chat.isAnnouncement && chat.communityId !== communityId)
            throw new GroupLinkChanged(); // linked meanwhile
          return { chat, scope: null };
        }
        const scope = await lockCommunityScope(sp, communityId, { extraChatIds: [chatId] });
        const chat = scope.extra.get(chatId);
        if (!chat) throw notFound('Chat');
        if (chat.communityId === communityId) return { chat, scope };
        if (!chat.communityId) return { chat, scope: null }; // unlinked meanwhile (the extra locks are harmless)
        throw new GroupLinkChanged(); // moved to another community meanwhile
      });
    } catch (err) {
      if (!(err instanceof GroupLinkChanged)) throw err;
    }
  }
  throw conflict('The group changed, try again');
}

// ---------------------------------------------------------------------------
// Membership cascade
// ---------------------------------------------------------------------------

/**
 * Make users community members (docs "Communities" invariant): insert `community_members`
 * (role member) and activate them in the announcement group WITHOUT a system message.
 * Registers, per matrix: JOIN(u) into the announcement group; `community:upsert` → U(u)
 * (unless `upsert: false`, when the caller upserts every member afterwards); then
 * `chat:updated {memberCount}` → R(ann) and `chat:members-changed` → ann admins.
 * Users already in the community are skipped. `409 limit_reached` when the community would
 * exceed MAX_GROUP_MEMBERS. Returns the users that became members.
 */
export async function addCommunityMembers(
  tx: Tx,
  fx: Effects,
  scope: CommunityScope,
  userIds: string[],
  opts: { addedBy: string | null; upsert?: boolean },
): Promise<string[]> {
  const ids = uniq(userIds);
  if (ids.length === 0) return [];
  const existing = await tx
    .select({ userId: communityMembers.userId })
    .from(communityMembers)
    .where(
      and(
        eq(communityMembers.communityId, scope.community.id),
        inArray(communityMembers.userId, ids),
      ),
    );
  const known = new Set(existing.map((r) => r.userId));
  // Accounts deleted meanwhile never become members (see lockLiveUsers).
  const live = await lockLiveUsers(
    tx,
    ids.filter((id) => !known.has(id)),
  );
  const fresh = ids.filter((id) => !known.has(id) && live.has(id));
  if (fresh.length === 0) return [];
  if ((await communityMemberCount(tx, scope.community.id)) + fresh.length > MAX_GROUP_MEMBERS) {
    throw limitReached(`A community can have at most ${MAX_GROUP_MEMBERS} members`);
  }
  const now = new Date();
  await tx.insert(communityMembers).values(
    fresh.map((userId) => ({
      communityId: scope.community.id,
      userId,
      role: 'member' as const,
      joinedAt: now,
    })),
  );

  // Mirror into the announcement group (skip rows that are somehow already active).
  const annActive = await tx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(
      and(
        eq(chatMembers.chatId, scope.ann.id),
        inArray(chatMembers.userId, fresh),
        isNull(chatMembers.leftAt),
      ),
    );
  const alreadyActive = new Set(annActive.map((r) => r.userId));
  const toActivate = fresh.filter((id) => !alreadyActive.has(id));
  if (toActivate.length) {
    await upsertMembership(tx, fx, {
      kind: 'activate',
      chatId: scope.ann.id,
      userIds: toActivate,
      addedBy: opts.addedBy,
    });
  }
  if (opts.upsert !== false)
    for (const userId of fresh) communityUpsert(fx, userId, scope.community.id);
  fx.memberCountChanged(scope.ann.id).membersChanged(scope.ann);
  return fresh;
}

/**
 * Community succession (docs "Ownership succession"): the oldest admin (by joined_at), else
 * the oldest member becomes owner; mirrored into the announcement group's roles without a
 * system message. Registers `community:upsert` + `chat:upsert(ann)` → U(new owner).
 * Returns the new owner, or null when the community has no members left (or has an owner).
 */
export async function ensureCommunityOwner(
  tx: Tx,
  fx: Effects,
  scope: CommunityScope,
): Promise<string | null> {
  const communityId = scope.community.id;
  const [owner] = await tx
    .select({ userId: communityMembers.userId })
    .from(communityMembers)
    .where(and(eq(communityMembers.communityId, communityId), eq(communityMembers.role, 'owner')))
    .limit(1);
  if (owner) return null;
  const [candidate] = await tx
    .select({ userId: communityMembers.userId })
    .from(communityMembers)
    .where(eq(communityMembers.communityId, communityId))
    .orderBy(
      sql`${communityMembers.role} = 'admin' desc`,
      asc(communityMembers.joinedAt),
      asc(communityMembers.userId),
    )
    .limit(1);
  if (!candidate) return null;
  await tx
    .update(communityMembers)
    .set({ role: 'owner' })
    .where(
      and(
        eq(communityMembers.communityId, communityId),
        eq(communityMembers.userId, candidate.userId),
      ),
    );
  await tx
    .update(chatMembers)
    .set({ role: 'owner' })
    .where(
      and(
        eq(chatMembers.chatId, scope.ann.id),
        eq(chatMembers.userId, candidate.userId),
        isNull(chatMembers.leftAt),
      ),
    );
  communityUpsert(fx, candidate.userId, communityId);
  fx.chatUpsert(candidate.userId, scope.ann.id);
  return candidate.userId;
}

/**
 * The community leave/removal pipeline (matrix `DELETE /communities/:id/members/:u`,
 * `POST …/leave`, account deletion). `scope` must be locked with `groups: true`.
 * Per linked group where u is active: `member_removed`/`member_left` → R(g), LEAVE(u) (group
 * succession applies), `chat:updated {memberCount}`, `chat:members-changed`; announcement
 * group: u's row deactivated + hidden → `chat:removed` → U(u); `chat:updated {memberCount}`
 * → R(ann), members-changed → ann admins; `community_members` row deleted;
 * `community:removed` → U(u); owner → community succession; nobody left → the community is
 * deactivated. 404 when u is not a member.
 */
export async function removeCommunityMember(
  tx: Tx,
  fx: Effects,
  scope: CommunityScope,
  userId: string,
  opts: { reason: 'left' | 'removed'; actorId: string },
): Promise<{ newOwnerId: string | null; deactivated: boolean }> {
  const member = await getCommunityMember(tx, scope.community.id, userId);
  if (!member) throw notFound('Member');

  for (const group of scope.groups) {
    const row = await getMembership(tx, group.id, userId);
    if (!row || row.leftAt) continue;
    await upsertMembership(tx, fx, {
      kind: 'deactivate',
      chatId: group.id,
      userId,
      reason: opts.reason,
      systemEvent:
        opts.reason === 'removed'
          ? { kind: 'member_removed', actorId: opts.actorId, userId }
          : { kind: 'member_left', actorId: userId },
    });
    fx.memberCountChanged(group.id).membersChanged(group);
  }

  const annRow = await getMembership(tx, scope.ann.id, userId);
  if (annRow && !annRow.leftAt) {
    await upsertMembership(tx, fx, {
      kind: 'deactivate',
      chatId: scope.ann.id,
      userId,
      reason: opts.reason,
      hide: true,
      succession: false,
    });
  } else if (annRow && !annRow.hidden) {
    await tx
      .update(chatMembers)
      .set({ hidden: true })
      .where(and(eq(chatMembers.chatId, scope.ann.id), eq(chatMembers.userId, userId)));
    fx.removeChat(userId, scope.ann.id);
  }
  fx.memberCountChanged(scope.ann.id).membersChanged(scope.ann);

  await tx
    .delete(communityMembers)
    .where(
      and(
        eq(communityMembers.communityId, scope.community.id),
        eq(communityMembers.userId, userId),
      ),
    );
  fx.toUser(userId, 'community:removed', { communityId: scope.community.id });

  if (member.role !== 'owner') return { newOwnerId: null, deactivated: false };
  const newOwnerId = await ensureCommunityOwner(tx, fx, scope);
  if (newOwnerId) return { newOwnerId, deactivated: false };
  await deactivateCommunity(tx, fx, scope, opts.actorId, { notify: false });
  return { newOwnerId: null, deactivated: true };
}

/**
 * Deactivation (docs "Communities → Deactivation"), inside the caller's tx with `scope`
 * locked (`groups: true`): per linked group `removed_from_community` → R(g) and
 * `community_id = null` → `chat:updated {communityId: null}` → R(g); a live call of the
 * announcement group ends (chat-deletion hooks: ring-stops, `call:ended`); `chat:removed` →
 * R(ann), `clearChatRoom(ann)`; the announcement chat is deleted (cascade), then the
 * community; `community:removed` → U(each former member) (unless `notify: false`).
 * Returns the former member ids.
 */
export async function deactivateCommunity(
  tx: Tx,
  fx: Effects,
  scope: CommunityScope,
  actorId: string,
  opts: { notify?: boolean } = {},
): Promise<string[]> {
  const { community, ann } = scope;
  const memberIds = await communityMemberIds(tx, community.id);
  for (const group of scope.groups) {
    await postSystemMessage(tx, fx, group, {
      kind: 'removed_from_community',
      actorId,
      communityId: community.id,
      communityName: community.name,
    });
    await tx
      .update(chats)
      .set({ communityId: null, updatedAt: new Date() })
      .where(eq(chats.id, group.id));
    fx.chatUpdated(group.id, { communityId: null });
  }
  // A live call in the announcement group ends properly (call:ended, ring-stops, sockets
  // released) instead of vanishing with the cascade.
  await runChatDeletionHooks(tx, fx, [ann.id]);
  fx.toChat(ann.id, 'chat:removed', { chatId: ann.id }).clearRoom(ann.id);
  await tx.delete(chats).where(eq(chats.id, ann.id));
  await tx.delete(communities).where(eq(communities.id, community.id));
  if (opts.notify !== false && memberIds.length)
    fx.toUsers(memberIds, 'community:removed', { communityId: community.id });
  return memberIds;
}

// ---------------------------------------------------------------------------
// Linking
// ---------------------------------------------------------------------------

/**
 * Link a regular group (matrix `POST /communities/:id/groups/link`, per group):
 * `community_id` set; `added_to_community` → R(g); `chat:updated {communityId}` → R(g);
 * community cascade for its active members (no per-user upsert: the caller registers
 * `communityUpsertAll` once at the end). `group` must be locked in the scope's lock call.
 */
export async function linkGroup(
  tx: Tx,
  fx: Effects,
  scope: CommunityScope,
  group: ChatRow,
  actorId: string,
): Promise<string[]> {
  const { community } = scope;
  await tx
    .update(chats)
    .set({ communityId: community.id, updatedAt: new Date() })
    .where(eq(chats.id, group.id));
  const linked = { ...group, communityId: community.id };
  await postSystemMessage(tx, fx, linked, {
    kind: 'added_to_community',
    actorId,
    communityId: community.id,
    communityName: community.name,
  });
  fx.chatUpdated(group.id, { communityId: community.id });
  const members = await tx
    .select({ userId: chatMembers.userId })
    .from(chatMembers)
    .where(and(eq(chatMembers.chatId, group.id), isNull(chatMembers.leftAt)));
  scope.groups.push(linked);
  return addCommunityMembers(
    tx,
    fx,
    scope,
    members.map((m) => m.userId),
    { addedBy: actorId, upsert: false },
  );
}

/**
 * Unlink (matrix `DELETE /communities/:id/groups/:c`): `removed_from_community` → R(g);
 * `community_id = null` → `chat:updated {communityId: null}` → R(g). Nobody leaves the
 * community. The caller registers `communityUpsertAll`.
 */
export async function unlinkGroup(
  tx: Tx,
  fx: Effects,
  scope: CommunityScope,
  group: ChatRow,
  actorId: string,
): Promise<void> {
  const { community } = scope;
  await postSystemMessage(tx, fx, group, {
    kind: 'removed_from_community',
    actorId,
    communityId: community.id,
    communityName: community.name,
  });
  await tx
    .update(chats)
    .set({ communityId: null, updatedAt: new Date() })
    .where(eq(chats.id, group.id));
  fx.chatUpdated(group.id, { communityId: null });
  scope.groups = scope.groups.filter((g) => g.id !== group.id);
}

/** Number of linked (non-announcement) groups. */
export async function linkedGroupCount(dbx: DbOrTx, communityId: string): Promise<number> {
  const [row] = await dbx
    .select({ n: count() })
    .from(chats)
    .where(and(eq(chats.communityId, communityId), ne(chats.isAnnouncement, true)));
  return Number(row?.n ?? 0);
}
