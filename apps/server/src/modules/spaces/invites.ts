/**
 * Space invites through the shared `/invites/:code` routes (invites module): preview and
 * join. Codes share one space with chats, communities and vanity codes.
 */
import { and, count, eq, sql } from 'drizzle-orm';
import {
  MAX_SPACE_MEMBERS,
  MAX_SPACES_PER_USER,
  PERM,
  SPACE_SYSTEM_FLAGS,
  USER_RATE_LIMITS,
  hasPerm,
  isSpaceChatType,
  type InvitePreview,
} from '@enbox/shared';
import type { DbOrTx, Tx } from '../../db/index.js';
import {
  chats,
  spaceBans,
  spaceInvites,
  spaceMembers,
  spaces,
  type SpaceInviteRow,
  type SpaceRow,
} from '../../db/schema.js';
import { conflict, expired, forbidden, limitReached, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { isOnline } from '../../realtime/presence.js';
import type { Effects } from '../../services/effects.js';
import { loadMediaMap, staticMediaUrl } from '../../services/media.js';
import { loadSpaceMember, lockSpace } from '../../services/spaceAccess.js';
import { addSpaceMemberTx } from '../../services/spaces.js';
import { spaceChannelSummaries } from '../../services/spaceSummaries.js';
import { postSystemMessage } from '../../services/system.js';

export interface SpaceInviteTarget {
  invite: SpaceInviteRow | null;
  space: SpaceRow;
}

/** The Space an invite (or vanity) code points to, or null when the code is not a Space's. */
export async function findSpaceInvite(
  dbx: DbOrTx,
  code: string,
): Promise<SpaceInviteTarget | null> {
  const [inv] = await dbx
    .select({ invite: spaceInvites, space: spaces })
    .from(spaceInvites)
    .innerJoin(spaces, eq(spaces.id, spaceInvites.spaceId))
    .where(eq(spaceInvites.code, code))
    .limit(1);
  if (inv) return inv;
  const [vanity] = await dbx.select().from(spaces).where(eq(spaces.vanityCode, code)).limit(1);
  return vanity ? { invite: null, space: vanity } : null;
}

function inviteProblem(invite: SpaceInviteRow | null): string | null {
  if (!invite) return null;
  if (invite.expiresAt && invite.expiresAt.getTime() <= Date.now())
    return 'This invite has expired';
  if (invite.maxUses > 0 && invite.uses >= invite.maxUses) return 'This invite has been used up';
  return null;
}

/** Approximate online members (bounded sample: large Spaces show "1,000+ online"). */
async function onlineCountOf(dbx: DbOrTx, spaceId: string): Promise<number> {
  const rows = await dbx
    .select({ userId: spaceMembers.userId })
    .from(spaceMembers)
    .where(eq(spaceMembers.spaceId, spaceId))
    .limit(5_000);
  return rows.filter((r) => isOnline(r.userId)).length;
}

export async function spaceInvitePreview(
  dbx: DbOrTx,
  me: string,
  code: string,
  target: SpaceInviteTarget,
): Promise<InvitePreview> {
  const { space, invite } = target;
  const mediaRows = await loadMediaMap(dbx, [space.iconMediaId, space.bannerMediaId]);
  const icon = space.iconMediaId ? mediaRows.get(space.iconMediaId) : undefined;
  const banner = space.bannerMediaId ? mediaRows.get(space.bannerMediaId) : undefined;
  const isMember = !!(await loadSpaceMember(dbx, space.id, me));
  let reason: string | null = null;
  if (!isMember) {
    const [ban] = await dbx
      .select({ u: spaceBans.userId })
      .from(spaceBans)
      .where(and(eq(spaceBans.spaceId, space.id), eq(spaceBans.userId, me)))
      .limit(1);
    if (ban) reason = 'You are banned from this Space';
    else
      reason =
        inviteProblem(invite) ??
        (space.memberCount >= MAX_SPACE_MEMBERS ? 'This Space is full' : null);
  }
  return {
    code,
    kind: 'space',
    id: space.id,
    name: space.name,
    description: space.description,
    avatarUrl: icon ? staticMediaUrl(icon) : null,
    memberCount: space.memberCount,
    communityId: null,
    communityName: null,
    isMember,
    canJoin: !isMember && !reason,
    reason,
    bannerUrl: banner ? staticMediaUrl(banner) : null,
    onlineCount: await onlineCountOf(dbx, space.id),
  };
}

/**
 * Join a Space through an invite: locks the Space, checks ban/limits/expiry/uses, adds me
 * (the system channel gets a join notice), counts the use. Returns the channel to open.
 */
export async function joinSpaceViaInvite(
  tx: Tx,
  fx: Effects,
  me: string,
  code: string,
  target: SpaceInviteTarget,
): Promise<{ spaceId: string; channelId: string | null }> {
  assertUserLimit(me, 'spaceJoin', USER_RATE_LIMITS.spaceJoin);
  const space = await lockSpace(tx, target.space.id);
  const [invite] = target.invite
    ? await tx.select().from(spaceInvites).where(eq(spaceInvites.code, code)).limit(1)
    : [null];
  if (target.invite && !invite) throw notFound('Invite');
  if (await loadSpaceMember(tx, space.id, me))
    throw conflict('You are already a member of this Space');
  const [ban] = await tx
    .select({ u: spaceBans.userId })
    .from(spaceBans)
    .where(and(eq(spaceBans.spaceId, space.id), eq(spaceBans.userId, me)))
    .limit(1);
  if (ban) throw forbidden('You are banned from this Space');
  const problem = inviteProblem(invite ?? null);
  if (problem) throw expired(problem);
  if (space.memberCount >= MAX_SPACE_MEMBERS) throw limitReached('This Space is full');
  const [mine] = await tx
    .select({ n: count() })
    .from(spaceMembers)
    .where(eq(spaceMembers.userId, me));
  if (Number(mine?.n ?? 0) >= MAX_SPACES_PER_USER)
    throw limitReached(`You can be in at most ${MAX_SPACES_PER_USER} Spaces`);
  await addSpaceMemberTx(tx, fx, space.id, me, {});
  if (invite)
    await tx
      .update(spaceInvites)
      .set({ uses: sql`${spaceInvites.uses} + 1` })
      .where(eq(spaceInvites.code, code));
  // Settings → Overview → System messages: "Send a random welcome message when someone joins".
  if (
    space.systemChannelId &&
    !(space.systemFlags & SPACE_SYSTEM_FLAGS.SUPPRESS_JOIN_NOTIFICATIONS)
  ) {
    const [sys] = await tx.select().from(chats).where(eq(chats.id, space.systemChannelId)).limit(1);
    if (sys && isSpaceChatType(sys.type))
      await postSystemMessage(tx, fx, sys, { kind: 'member_joined_space', actorId: me });
  }
  return { spaceId: space.id, channelId: invite?.channelId ?? null };
}

/** The channel to land on after joining: the invite's, else the first text channel I can see. */
export async function landingChannel(
  dbx: DbOrTx,
  me: string,
  spaceId: string,
  preferred: string | null,
): Promise<string | null> {
  const channels = await spaceChannelSummaries(dbx, me, spaceId);
  if (preferred && channels.some((c) => c.id === preferred)) return preferred;
  return (
    channels.find((c) => c.type === 'space_text' && hasPerm(c.spacePermissions, PERM.VIEW_CHANNEL))
      ?.id ?? null
  );
}
