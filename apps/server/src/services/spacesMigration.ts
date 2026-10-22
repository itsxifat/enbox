/**
 * Communities → Spaces conversion (docs/design/spaces-at-scale.md "Communities conversion").
 * Awaited at boot under the migration lock, before the server listens (SPACES_MIGRATE =
 * on | dry | off). One transaction per community, idempotent through
 * `spaces.legacy_community_id`. Per community:
 * - a Space (owner = community owner, else the oldest admin, else the oldest member) with
 *   @everyone and an "Admin" role (ADMINISTRATOR) for the community admins; every community
 *   member becomes a Space member (join time kept);
 * - the announcement group → `#announcements` (@everyone cannot send), the system channel;
 * - each linked group → a text channel (history kept for its members; admins-only-send kept as
 *   an @everyone deny; group owner/admins get send/manage overwrites; members an admin removed
 *   keep being excluded by a member overwrite denying VIEW_CHANNEL; community members who were
 *   never in the group see only new messages through a future-only read row);
 * - a "General" voice channel; the community's and groups' invite codes → Space invites;
 * - live calls of converted chats end; the community rows are deleted.
 * No events are emitted (nothing is connected before the server listens).
 */
import { and, asc, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { PERM, normalizeTextChannelName, type PermissionOverwrite } from '@enbox/shared';
import { db, type Tx } from '../db/index.js';
import {
  chatMembers,
  chats,
  communities,
  communityMembers,
  spaceCategories,
  spaceChannelOverwrites,
  spaceInvites,
  spaceMemberRoles,
  spaceMembers,
  spaceRoles,
  spaces,
  users,
  type ChatRow,
} from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { transact, type Effects } from './effects.js';
import { runChatDeletionHooks } from './hooks.js';
import { audit, createSpaceTx, sortNameOf } from './spaces.js';

export interface ConversionReport {
  communities: number;
  converted: number;
  skipped: number;
}

const MODERATOR = PERM.SEND_MESSAGES | PERM.MANAGE_MESSAGES | PERM.MANAGE_CHANNELS;

function channelNameOf(name: string | null, fallback: string): string {
  return (normalizeTextChannelName(name ?? '') || fallback).slice(0, 100);
}

async function insertOverwrites(tx: Tx, chatId: string, list: PermissionOverwrite[]) {
  if (list.length)
    await tx
      .insert(spaceChannelOverwrites)
      .values(list.map((o) => ({ chatId, ...o })))
      .onConflictDoNothing();
}

/** Convert one community (inside the caller's transaction). Returns false when already done. */
export async function convertCommunity(tx: Tx, fx: Effects, communityId: string): Promise<boolean> {
  const [community] = await tx
    .select()
    .from(communities)
    .where(eq(communities.id, communityId))
    .for('update');
  if (!community) return false;
  const [done] = await tx
    .select({ id: spaces.id })
    .from(spaces)
    .where(eq(spaces.legacyCommunityId, communityId))
    .limit(1);
  if (done) return false;

  const members = await tx
    .select({ m: communityMembers, displayName: users.displayName })
    .from(communityMembers)
    .innerJoin(users, eq(users.id, communityMembers.userId))
    .where(eq(communityMembers.communityId, communityId))
    .orderBy(asc(communityMembers.joinedAt));
  const owner =
    members.find((r) => r.m.role === 'owner') ??
    members.find((r) => r.m.role === 'admin') ??
    members[0];
  const groups = await tx
    .select()
    .from(chats)
    .where(eq(chats.communityId, communityId))
    .orderBy(asc(chats.createdAt))
    .for('update');
  const chatIds = groups.map((g) => g.id);
  if (chatIds.length) await runChatDeletionHooks(tx, fx, chatIds); // ends live calls

  if (!owner) {
    // Nobody left: nothing to convert into; the chats become plain groups again.
    await tx
      .update(chats)
      .set({ communityId: null, isAnnouncement: false })
      .where(eq(chats.communityId, communityId));
    await tx.delete(communities).where(eq(communities.id, communityId));
    return true;
  }

  const created = await createSpaceTx(tx, fx, {
    ownerId: owner.m.userId,
    name: community.name,
    description: community.description,
    iconMediaId: community.avatarMediaId,
    createdAt: community.createdAt,
    legacyCommunityId: communityId,
    withDefaults: false,
  });
  const spaceId = created.space.id;
  const everyone = created.everyoneRoleId;
  const [admin] = await tx
    .insert(spaceRoles)
    .values({
      spaceId,
      name: 'Admin',
      position: 1,
      permissions: PERM.ADMINISTRATOR,
      hoist: true,
      color: '#5865f2',
    })
    .returning();

  // Members (the owner was added by createSpaceTx).
  const rest = members.filter((r) => r.m.userId !== owner.m.userId);
  if (rest.length)
    await tx
      .insert(spaceMembers)
      .values(
        rest.map((r) => ({
          spaceId,
          userId: r.m.userId,
          sortName: sortNameOf(null, r.displayName),
          joinedAt: r.m.joinedAt,
        })),
      )
      .onConflictDoNothing();
  const admins = members.filter((r) => r.m.role === 'admin' || r.m.role === 'owner');
  if (admins.length)
    await tx
      .insert(spaceMemberRoles)
      .values(admins.map((r) => ({ spaceId, userId: r.m.userId, roleId: admin!.id })))
      .onConflictDoNothing();
  const communityUserIds = new Set(members.map((r) => r.m.userId));

  const [textCat, voiceCat] = await tx
    .insert(spaceCategories)
    .values([
      { spaceId, name: 'Text channels', position: 0 },
      { spaceId, name: 'Voice channels', position: 1 },
    ])
    .returning();

  const announcement = groups.find((g) => g.isAnnouncement) ?? null;
  const linked = groups.filter((g) => !g.isAnnouncement);
  const ordered: ChatRow[] = announcement ? [announcement, ...linked] : linked;
  const invites: { code: string; channelId: string }[] = [];
  if (community.inviteCode && announcement)
    invites.push({ code: community.inviteCode, channelId: announcement.id });

  for (const [i, g] of ordered.entries()) {
    const isAnn = g === announcement;
    if (g.inviteCode) invites.push({ code: g.inviteCode, channelId: g.id });
    await tx
      .update(chats)
      .set({
        type: 'space_text',
        spaceId,
        categoryId: textCat!.id,
        position: i,
        name: isAnn ? 'announcements' : channelNameOf(g.name, `channel-${i}`),
        topic: isAnn ? null : g.description,
        communityId: null,
        isAnnouncement: false,
        groupSettings: null,
        inviteCode: null,
        disappearingSeconds: null,
        permissionsSynced: false,
        updatedAt: new Date(),
      })
      .where(eq(chats.id, g.id));
    const overwrites: PermissionOverwrite[] = [];
    if (isAnn || g.groupSettings?.onlyAdminsCanSend)
      overwrites.push({
        targetType: 'role',
        targetId: everyone,
        allow: 0,
        deny: PERM.SEND_MESSAGES,
      });
    const rows = await tx.select().from(chatMembers).where(eq(chatMembers.chatId, g.id));
    for (const r of rows) {
      if (!isAnn && !r.leftAt && (r.role === 'owner' || r.role === 'admin'))
        overwrites.push({ targetType: 'member', targetId: r.userId, allow: MODERATOR, deny: 0 });
      if (r.leftAt && r.leftReason === 'removed' && !isAnn)
        overwrites.push({
          targetType: 'member',
          targetId: r.userId,
          allow: 0,
          deny: PERM.VIEW_CHANNEL,
        });
    }
    await insertOverwrites(tx, g.id, overwrites);
    // Read state: active rows keep their window; former members' rows go.
    await tx
      .delete(chatMembers)
      .where(and(eq(chatMembers.chatId, g.id), isNotNull(chatMembers.leftAt)));
    await tx
      .update(chatMembers)
      .set({ role: 'member', hidden: false })
      .where(eq(chatMembers.chatId, g.id));
    if (!isAnn) {
      // Community members who were not in the group: future messages only.
      const inGroup = new Set(rows.filter((r) => !r.leftAt).map((r) => r.userId));
      const removed = new Set(
        rows.filter((r) => r.leftAt && r.leftReason === 'removed').map((r) => r.userId),
      );
      const seq = Number(g.lastSeq);
      const futureOnly = [...communityUserIds].filter((u) => !inGroup.has(u) && !removed.has(u));
      if (futureOnly.length)
        await tx
          .insert(chatMembers)
          .values(
            futureOnly.map((userId) => ({
              chatId: g.id,
              userId,
              role: 'member' as const,
              joinedSeq: seq,
              lastReadSeq: seq,
              lastDeliveredSeq: seq,
            })),
          )
          .onConflictDoNothing();
      // Group members who were not community members (should not happen) join the Space.
      const outsiders = [...inGroup].filter((u) => !communityUserIds.has(u));
      if (outsiders.length) {
        const names = await tx
          .select({ id: users.id, n: users.displayName })
          .from(users)
          .where(inArray(users.id, outsiders));
        await tx
          .insert(spaceMembers)
          .values(names.map((u) => ({ spaceId, userId: u.id, sortName: sortNameOf(null, u.n) })))
          .onConflictDoNothing();
        for (const u of outsiders) communityUserIds.add(u);
      }
    }
  }

  const [voice] = await tx
    .insert(chats)
    .values({
      type: 'space_voice',
      name: 'General',
      spaceId,
      categoryId: voiceCat!.id,
      position: 0,
      createdBy: owner.m.userId,
    })
    .returning();
  if (invites.length)
    await tx
      .insert(spaceInvites)
      .values(
        invites.map((v) => ({
          code: v.code,
          spaceId,
          channelId: v.channelId,
          createdBy: owner.m.userId,
        })),
      )
      .onConflictDoNothing();
  const [{ n }] = (await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId))) as [{ n: number }];
  await tx
    .update(spaces)
    .set({ memberCount: Number(n), systemChannelId: announcement?.id ?? ordered[0]?.id ?? null })
    .where(eq(spaces.id, spaceId));
  await tx.delete(communityMembers).where(eq(communityMembers.communityId, communityId));
  await tx.delete(communities).where(eq(communities.id, communityId));
  await audit(tx, {
    spaceId,
    actorId: null,
    action: 'space.converted',
    targetType: 'space',
    targetId: spaceId,
    changes: { communityId, channels: ordered.length, voiceChannelId: voice!.id },
  });
  return true;
}

/** Convert every community (boot). `dry`: log what would happen, write nothing. */
export async function migrateCommunitiesToSpaces(
  opts: { dry?: boolean } = {},
): Promise<ConversionReport> {
  const list = await db
    .select({ id: communities.id, name: communities.name })
    .from(communities)
    .orderBy(asc(communities.createdAt));
  const report: ConversionReport = { communities: list.length, converted: 0, skipped: 0 };
  if (opts.dry) {
    logger.info({ communities: list.map((c) => c.name) }, 'spaces migration (dry run)');
    return report;
  }
  for (const c of list) {
    const ok = await transact((tx, fx) => convertCommunity(tx, fx, c.id));
    if (ok) report.converted += 1;
    else report.skipped += 1;
  }
  if (list.length) logger.info(report, 'communities converted to Spaces');
  return report;
}
