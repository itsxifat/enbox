import { Router } from 'express';
import { eq } from 'drizzle-orm';
import {
  MAX_GROUP_MEMBERS,
  inviteParamsSchema,
  type InviteJoinResult,
  type InvitePreview,
} from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { chats, communities, media, type ChatRow, type CommunityRow } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { inviteLimiter } from '../../lib/rateLimit.js';
import { parse } from '../../lib/validate.js';
import { activeMemberCount, getMembership, lockChat } from '../../services/chats.js';
import {
  addCommunityMembers,
  communityMemberCount,
  getCommunity,
  getCommunityMember,
  lockCommunityScope,
  lockGroupScope,
  toCommunity,
} from '../../services/communities.js';
import { transact } from '../../services/effects.js';
import { mediaUrl } from '../../services/media.js';
import { wasRemovedByAdmin, wasRemovedFromCommunity } from '../../services/membership.js';
import { toChatSummary } from '../../services/summaries.js';
import { followChannelTx } from '../channels/service.js';
import { joinGroupTx } from '../groups/service.js';

/**
 * Invites module — owns: GET /invites/:code (preview) and POST /invites/:code/join. Codes
 * share one space across chats (groups, channels) and communities: chats are checked first.
 * Both routes are rate-limited per IP (`inviteLimiter`). Removed members can't rejoin
 * themselves (403); already a member → 409; full → 409 limit_reached.
 */
export const router = Router();

const REMOVED = 'You were removed by an admin';

type Target =
  | { kind: 'chat'; chat: ChatRow; avatarKey: string | null }
  | { kind: 'community'; community: CommunityRow; avatarKey: string | null };

async function findInvite(dbx: DbOrTx, code: string): Promise<Target> {
  const [c] = await dbx
    .select({ chat: chats, avatarKey: media.storageKey })
    .from(chats)
    .leftJoin(media, eq(media.id, chats.avatarMediaId))
    .where(eq(chats.inviteCode, code))
    .limit(1);
  if (c) {
    if (c.chat.type === 'channel' || (c.chat.type === 'group' && !c.chat.isAnnouncement))
      return { kind: 'chat', chat: c.chat, avatarKey: c.avatarKey };
    throw notFound('Invite');
  }
  const [k] = await dbx
    .select({ community: communities, avatarKey: media.storageKey })
    .from(communities)
    .leftJoin(media, eq(media.id, communities.avatarMediaId))
    .where(eq(communities.inviteCode, code))
    .limit(1);
  if (k) return { kind: 'community', community: k.community, avatarKey: k.avatarKey };
  throw notFound('Invite');
}

async function preview(dbx: DbOrTx, me: string, code: string): Promise<InvitePreview> {
  const target = await findInvite(dbx, code);
  const avatarUrl = target.avatarKey ? mediaUrl(target.avatarKey) : null;

  if (target.kind === 'community') {
    const c = target.community;
    const memberCount = await communityMemberCount(dbx, c.id);
    const isMember = !!(await getCommunityMember(dbx, c.id, me));
    let reason: string | null = null;
    if (!isMember) {
      if (await wasRemovedFromCommunity(dbx, c.id, me)) reason = REMOVED;
      else if (memberCount >= MAX_GROUP_MEMBERS) reason = 'This community is full';
    }
    return {
      code,
      kind: 'community',
      id: c.id,
      name: c.name,
      description: c.description,
      avatarUrl,
      memberCount,
      communityId: null,
      communityName: null,
      isMember,
      canJoin: !isMember && !reason,
      reason,
    };
  }

  const chat = target.chat;
  const memberCount = await activeMemberCount(dbx, chat.id);
  const row = await getMembership(dbx, chat.id, me);
  const isMember = !!row && !row.leftAt;
  const base = {
    code,
    id: chat.id,
    name: chat.name ?? '',
    description: chat.description,
    avatarUrl,
    memberCount,
    isMember,
  };
  if (chat.type === 'channel') {
    return {
      ...base,
      kind: 'channel',
      communityId: null,
      communityName: null,
      canJoin: !isMember,
      reason: null,
    };
  }

  const community = chat.communityId ? await getCommunity(dbx, chat.communityId) : null;
  let reason: string | null = null;
  if (!isMember) {
    if (await wasRemovedByAdmin(dbx, chat, me)) reason = REMOVED;
    else if (memberCount >= MAX_GROUP_MEMBERS) reason = 'This group is full';
    else if (
      community &&
      !(await getCommunityMember(dbx, community.id, me)) &&
      (await communityMemberCount(dbx, community.id)) >= MAX_GROUP_MEMBERS
    ) {
      reason = 'This community is full';
    }
  }
  return {
    ...base,
    kind: 'group',
    communityId: community?.id ?? null,
    communityName: community?.name ?? null,
    canJoin: !isMember && !reason,
    reason,
  };
}

// GET /invites/:code → InvitePreview (group, channel or community)
router.get('/invites/:code', inviteLimiter, async (req, res) => {
  const me = authUserId(req);
  const { code } = parse(inviteParamsSchema, req.params);
  res.json(await preview(db, me, code));
});

// POST /invites/:code/join → InviteJoinResult. Group: JOIN(me); member_joined_via_link → R;
// chat:updated {memberCount}; chat:members-changed; community cascade. Channel: as follow.
// Community: as a community add (JOIN into the announcement group, community:upsert → U(me)).
router.post('/invites/:code/join', inviteLimiter, async (req, res) => {
  const me = authUserId(req);
  const { code } = parse(inviteParamsSchema, req.params);
  const joined = await transact(
    async (
      tx,
      fx,
    ): Promise<{ kind: InviteJoinResult['kind']; id: string; communityId: string | null }> => {
      const target = await findInvite(tx, code);
      if (target.kind === 'chat' && target.chat.type === 'group') {
        const { chat, scope } = await lockGroupScope(tx, target.chat.id);
        if (chat.inviteCode !== code) throw notFound('Invite');
        await joinGroupTx(tx, fx, { chat, scope, userId: me, via: 'member_joined_via_link' });
        return { kind: 'group', id: chat.id, communityId: scope?.community.id ?? null };
      }
      if (target.kind === 'chat') {
        const chat = await lockChat(tx, target.chat.id);
        if (chat.inviteCode !== code) throw notFound('Invite');
        await followChannelTx(tx, fx, chat, me);
        return { kind: 'channel', id: chat.id, communityId: null };
      }
      const scope = await lockCommunityScope(tx, target.community.id);
      if (scope.community.inviteCode !== code) throw notFound('Invite');
      if (await getCommunityMember(tx, scope.community.id, me))
        throw conflict('You are already a member of this community');
      if (await wasRemovedFromCommunity(tx, scope.community.id, me)) throw forbidden(REMOVED);
      await addCommunityMembers(tx, fx, scope, [me], { addedBy: null });
      return { kind: 'community', id: scope.community.id, communityId: scope.community.id };
    },
  );
  const out: InviteJoinResult = {
    kind: joined.kind,
    id: joined.id,
    chat: joined.kind === 'community' ? null : await toChatSummary(db, me, joined.id),
    community: joined.communityId ? await toCommunity(db, me, joined.communityId) : null,
  };
  res.json(out);
});
