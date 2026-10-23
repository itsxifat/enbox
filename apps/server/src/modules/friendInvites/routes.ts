import { Router } from 'express';
import { and, count, desc, eq, gt, isNull, lt, not, sql, type SQL } from 'drizzle-orm';
import {
  FRIEND_INVITE_MAX_USES,
  FRIEND_INVITE_TTL_DAYS,
  inviteParamsSchema,
  type FriendInvite,
  type FriendInviteAccepted,
  type FriendInvitePreview,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { contacts, friendInvites, users } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { generateInviteCode } from '../../lib/crypto.js';
import { badRequest, limitReached, notFound } from '../../lib/errors.js';
import { inviteLimiter } from '../../lib/rateLimit.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';
import { blockedEitherWay, toUserPublic } from '../../services/users.js';
import { pushFriendEvent } from '../friends/push.js';
import { befriend, contactsBetween, lockPair } from '../friends/service.js';
import { trackPush } from '../push/sender.js';

/**
 * Friend invite links (everyday wave, agent 5). Paths are relative to /api (see ApiRoutes in
 * @enbox/shared); mounted behind requireAuth.
 *
 *   GET    /me/friend-invites                 FriendInvite[]: my live links, newest first
 *   POST   /me/friend-invites                 FriendInvite (201): a new link (a week, five uses)
 *   DELETE /me/friend-invites                 revoke all of mine
 *   GET    /friend-invites/:code              FriendInvitePreview
 *   POST   /friend-invites/:code/accept       FriendInviteAccepted: we become friends
 *
 * A link is live until it expires or its uses run out. Whoever accepts one becomes my friend
 * exactly as if they had accepted my friend request (friends service `befriend`: contacts
 * both ways, `friends:changed` → both, a push to me); my `friendRequestsFrom` doesn't apply,
 * the link is my consent. Expired, used up, revoked, a deleted inviter and a block either way
 * all answer the same 404. Preview and accept are rate-limited per IP like Space invites.
 */
export const router = Router();

type FriendInviteRow = typeof friendInvites.$inferSelect;

/** Links one user may have live at once (each also costs a create from CREATE_LIMIT). */
const MAX_LIVE_INVITES = 20;
const CREATE_LIMIT = { limit: 20, windowMs: 60 * 60_000 };
const TTL_MS = FRIEND_INVITE_TTL_DAYS * 86_400_000;

function liveNow(now = new Date()): SQL {
  return and(gt(friendInvites.expiresAt, now), lt(friendInvites.uses, friendInvites.maxUses))!;
}

function isLive(row: FriendInviteRow, now = Date.now()): boolean {
  return row.expiresAt.getTime() > now && row.uses < row.maxUses;
}

function toFriendInvite(row: FriendInviteRow): FriendInvite {
  return {
    code: row.code,
    createdAt: row.createdAt.toISOString(),
    expiresAt: row.expiresAt.toISOString(),
    uses: row.uses,
    maxUses: row.maxUses,
  };
}

router.get('/me/friend-invites', async (req, res) => {
  const me = authUserId(req);
  const rows = await db
    .select()
    .from(friendInvites)
    .where(and(eq(friendInvites.userId, me), liveNow()))
    .orderBy(desc(friendInvites.createdAt), desc(friendInvites.code));
  res.json(rows.map(toFriendInvite));
});

/** A fresh code each time; my dead links are cleared first so they never count. */
router.post('/me/friend-invites', async (req, res) => {
  const me = authUserId(req);
  assertUserLimit(me, 'friendInviteCreate', CREATE_LIMIT);
  const row = await transact(async (tx) => {
    // One user's creates run one at a time, so the cap holds.
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`enbox:friend-invites:${me}`}, 0))`,
    );
    await tx.delete(friendInvites).where(and(eq(friendInvites.userId, me), not(liveNow())));
    const [{ n } = { n: 0 }] = await tx
      .select({ n: count() })
      .from(friendInvites)
      .where(eq(friendInvites.userId, me));
    if (n >= MAX_LIVE_INVITES)
      throw limitReached(
        `You can have up to ${MAX_LIVE_INVITES} active invite links. Revoke them to make a new one.`,
      );
    const now = new Date();
    // ≈ 128 random bits: a collision is practically impossible, but never fatal.
    for (let attempt = 0; attempt < 5; attempt++) {
      const [inv] = await tx
        .insert(friendInvites)
        .values({
          code: generateInviteCode(),
          userId: me,
          createdAt: now,
          expiresAt: new Date(now.getTime() + TTL_MS),
          maxUses: FRIEND_INVITE_MAX_USES,
        })
        .onConflictDoNothing()
        .returning();
      if (inv) return inv;
    }
    throw new Error('Could not generate a unique friend invite code');
  });
  res.status(201).json(toFriendInvite(row));
});

router.delete('/me/friend-invites', async (req, res) => {
  const me = authUserId(req);
  await db.delete(friendInvites).where(eq(friendInvites.userId, me));
  res.status(204).end();
});

router.get('/friend-invites/:code', inviteLimiter, async (req, res) => {
  const me = authUserId(req);
  const { code } = parse(inviteParamsSchema, req.params);
  const [row] = await db
    .select({ invite: friendInvites })
    .from(friendInvites)
    .innerJoin(users, eq(users.id, friendInvites.userId))
    .where(and(eq(friendInvites.code, code), isNull(users.deletedAt), liveNow()))
    .limit(1);
  const invite = row?.invite;
  if (!invite || (await blockedEitherWay(db, me, invite.userId))) throw notFound('Invite');
  const inviter = await toUserPublic(db, me, invite.userId);
  if (!inviter || inviter.isDeleted) throw notFound('Invite');
  res.json({ inviter, expiresAt: invite.expiresAt.toISOString() } satisfies FriendInvitePreview);
});

/**
 * Lock order: the invite row, then the pair (friends service), then the inviter's user row
 * FOR SHARE (waits for a concurrent account deletion), like a friend request. Already
 * friends: nothing changes and no use is counted.
 */
router.post('/friend-invites/:code/accept', inviteLimiter, async (req, res) => {
  const me = authUserId(req);
  const { code } = parse(inviteParamsSchema, req.params);
  const result = await transact(async (tx, fx): Promise<FriendInviteAccepted> => {
    const [invite] = await tx
      .select()
      .from(friendInvites)
      .where(eq(friendInvites.code, code))
      .for('update');
    if (!invite || !isLive(invite)) throw notFound('Invite');
    const them = invite.userId;
    if (them === me) throw badRequest("You can't add yourself as a friend");
    await lockPair(tx, me, them);
    const [inviter] = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, them), isNull(users.deletedAt)))
      .for('share');
    if (!inviter || (await blockedEitherWay(tx, me, them))) throw notFound('Invite');
    const saved = await tx
      .select({ ownerId: contacts.ownerId })
      .from(contacts)
      .where(contactsBetween(me, them));
    if (saved.length === 2) return { status: 'already_friends', userId: them };
    await befriend(tx, fx, me, them);
    await tx
      .update(friendInvites)
      .set({ uses: sql`${friendInvites.uses} + 1` })
      .where(eq(friendInvites.code, code));
    fx.add(() => trackPush(pushFriendEvent('accepted', me, them)));
    return { status: 'friends', userId: them };
  });
  res.json(result);
});
