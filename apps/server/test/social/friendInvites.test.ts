/**
 * Friend invite links (everyday wave): create (a week, five uses), list my live ones, revoke
 * all, the preview, and accept — friends both ways exactly like an accepted request, a use
 * counted, `already_friends` with nothing changed, my own link refused, and every dead link
 * (expired, used up, revoked, deleted inviter, a block either way) the same 404.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, or } from 'drizzle-orm';
import {
  FRIEND_INVITE_MAX_USES,
  FRIEND_INVITE_TTL_DAYS,
  INVITE_CODE_ALPHABET,
  INVITE_CODE_LENGTH,
  type Contact,
  type FriendInvite,
  type FriendInvitePreview,
  type FriendRequests,
  type PushPayload,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { contacts, friendInvites } from '../../src/db/schema.js';
import { pushIdle, setPushSender } from '../../src/modules/push/sender.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { block, recordEvents, saveContact, settle } from '../services/fixtures.js';

describe('friend invite links', () => {
  let t: TestServer;
  let pushes: { endpoint: string; payload: PushPayload }[];
  let endpoints = 0;

  beforeAll(async () => {
    t = await startTestServer();
    setPushSender(
      async (target, payload) => void pushes.push({ endpoint: target.endpoint, payload }),
    );
  });
  afterAll(async () => {
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    pushes = [];
  });

  const create = async (user: TestUser) =>
    (await t.api(user).post('/api/me/friend-invites').expect(201)).body as FriendInvite;
  const mine = async (user: TestUser) =>
    (await t.api(user).get('/api/me/friend-invites').expect(200)).body as FriendInvite[];
  const preview = (user: TestUser, code: string) => t.api(user).get(`/api/friend-invites/${code}`);
  const accept = (user: TestUser, code: string) =>
    t.api(user).post(`/api/friend-invites/${code}/accept`);
  const contactIdsOf = async (user: TestUser) =>
    ((await t.api(user).get('/api/contacts').expect(200)).body as Contact[]).map((c) => c.user.id);
  const usesOf = async (code: string) =>
    (await db.select().from(friendInvites).where(eq(friendInvites.code, code)))[0]?.uses;

  async function subscribe(user: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/friend-invites-${++endpoints}`;
    await t
      .api(user)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }

  /** The 404 every dead or unreachable link gets, preview and accept alike. */
  async function expectDead(user: TestUser, code: string) {
    const a = await preview(user, code).expect(404);
    expect(a.body.error.code).toBe('not_found');
    const b = await accept(user, code).expect(404);
    expect(b.body).toEqual(a.body);
  }

  describe('my links', () => {
    it('create: a fresh code that lives a week for five uses; the list is newest first', async () => {
      const ann = await t.createUser();
      const before = Date.now();
      const first = await create(ann);
      expect(first.code).toMatch(new RegExp(`^[${INVITE_CODE_ALPHABET}]{${INVITE_CODE_LENGTH}}$`));
      expect(first).toMatchObject({ uses: 0, maxUses: FRIEND_INVITE_MAX_USES });
      const ttl = Date.parse(first.expiresAt) - Date.parse(first.createdAt);
      expect(ttl).toBe(FRIEND_INVITE_TTL_DAYS * 86_400_000);
      expect(Date.parse(first.createdAt)).toBeGreaterThanOrEqual(before - 1000);
      const second = await create(ann);
      expect(second.code).not.toBe(first.code);
      expect((await mine(ann)).map((i) => i.code)).toEqual([second.code, first.code]);
      // Only mine.
      expect(await mine(await t.createUser())).toEqual([]);
    });

    it('the list leaves out expired and used-up links; creating clears them', async () => {
      const ann = await t.createUser();
      const expired = await create(ann);
      const usedUp = await create(ann);
      const live = await create(ann);
      await db
        .update(friendInvites)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(friendInvites.code, expired.code));
      await db
        .update(friendInvites)
        .set({ uses: FRIEND_INVITE_MAX_USES })
        .where(eq(friendInvites.code, usedUp.code));
      expect((await mine(ann)).map((i) => i.code)).toEqual([live.code]);
      const next = await create(ann);
      const rows = await db.select().from(friendInvites).where(eq(friendInvites.userId, ann.id));
      expect(rows.map((r) => r.code).sort()).toEqual([live.code, next.code].sort());
    });

    it('DELETE revokes all of mine (theirs stay): the links stop working', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      const a1 = await create(ann);
      const a2 = await create(ann);
      const b1 = await create(bob);
      await t.api(ann).delete('/api/me/friend-invites').expect(204);
      await t.api(ann).delete('/api/me/friend-invites').expect(204);
      expect(await mine(ann)).toEqual([]);
      expect((await mine(bob)).map((i) => i.code)).toEqual([b1.code]);
      const cid = await t.createUser();
      await expectDead(cid, a1.code);
      await expectDead(cid, a2.code);
    });

    it('caps my live links at 20 (dead ones never count)', async () => {
      const ann = await t.createUser();
      for (let i = 0; i < 20; i++) await create(ann);
      const res = await t.api(ann).post('/api/me/friend-invites').expect(409);
      expect(res.body.error.code).toBe('limit_reached');
      await db
        .update(friendInvites)
        .set({ uses: FRIEND_INVITE_MAX_USES })
        .where(eq(friendInvites.userId, ann.id));
      await create(ann);
    });
  });

  describe('preview', () => {
    it('shows the inviter as I see them and when the link expires; my own link too', async () => {
      const ann = await t.createUser({ displayName: 'Ann' });
      const bob = await t.createUser();
      const invite = await create(ann);
      await saveContact(bob, ann, 'Annie');
      const seen = (await preview(bob, invite.code).expect(200)).body as FriendInvitePreview;
      expect(seen.expiresAt).toBe(invite.expiresAt);
      expect(seen.inviter).toMatchObject({
        id: ann.id,
        displayName: 'Ann',
        contactName: 'Annie',
        username: ann.username,
      });
      const own = (await preview(ann, invite.code).expect(200)).body as FriendInvitePreview;
      expect(own.inviter.id).toBe(ann.id);
    });

    it('a malformed code is 400, an unknown one 404', async () => {
      const bob = await t.createUser();
      await preview(bob, 'nope').expect(400);
      await accept(bob, 'nope').expect(400);
      await expectDead(bob, 'A'.repeat(INVITE_CODE_LENGTH));
    });

    it('expired, used up, a deleted inviter and a block either way are the same 404', async () => {
      const bob = await t.createUser();
      const expiredBy = await t.createUser();
      const expired = await create(expiredBy);
      await db
        .update(friendInvites)
        .set({ expiresAt: new Date(Date.now() - 1) })
        .where(eq(friendInvites.code, expired.code));
      await expectDead(bob, expired.code);

      const usedBy = await t.createUser();
      const used = await create(usedBy);
      await db
        .update(friendInvites)
        .set({ uses: FRIEND_INVITE_MAX_USES })
        .where(eq(friendInvites.code, used.code));
      await expectDead(bob, used.code);

      const gone = await t.createUser();
      const orphan = await create(gone);
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      await expectDead(bob, orphan.code);

      const blocker = await t.createUser();
      const blockedLink = await create(blocker);
      await block(blocker, bob);
      await expectDead(bob, blockedLink.code);

      const blockedByBob = await t.createUser();
      const theirLink = await create(blockedByBob);
      await block(bob, blockedByBob);
      await expectDead(bob, theirLink.code);
      expect(await contactIdsOf(bob)).toEqual([]);
    });
  });

  describe('accept', () => {
    it('makes us friends like an accepted request: both contact rows, the events to both, a push to the inviter, one use', async () => {
      const ann = await t.createUser({ displayName: 'Ann' });
      const bob = await t.createUser({ displayName: 'Bob' });
      const invite = await create(ann);
      const endpoint = await subscribe(ann);
      const annLog = recordEvents(await t.connect(ann));
      const bobLog = recordEvents(await t.connect(bob));

      const res = await accept(bob, invite.code).expect(200);
      expect(res.body).toEqual({ status: 'friends', userId: ann.id });
      await settle();
      const relevant = (names: string[]) => names.filter((n) => n !== 'presence:update');
      for (const log of [annLog, bobLog])
        expect(relevant(log.names())).toEqual([
          'friends:changed',
          'contacts:changed',
          'user:changed',
        ]);
      expect(annLog.of('user:changed')).toEqual([{ userId: bob.id }]);
      expect(bobLog.of('user:changed')).toEqual([{ userId: ann.id }]);

      expect(await contactIdsOf(ann)).toEqual([bob.id]);
      expect(await contactIdsOf(bob)).toEqual([ann.id]);
      const rows = await db
        .select()
        .from(contacts)
        .where(or(eq(contacts.ownerId, ann.id), eq(contacts.ownerId, bob.id)));
      expect(rows.map((r) => r.name)).toEqual([null, null]);
      expect(await usesOf(invite.code)).toBe(1);
      expect((await mine(ann))[0]).toMatchObject({ code: invite.code, uses: 1 });

      await pushIdle();
      expect(pushes).toEqual([
        {
          endpoint,
          payload: expect.objectContaining({ title: 'Bob', body: 'Accepted your friend request' }),
        },
      ]);
    });

    it('already friends: already_friends, no events, no use counted', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      const invite = await create(ann);
      await accept(bob, invite.code).expect(200);
      const bobLog = recordEvents(await t.connect(bob));
      const again = await accept(bob, invite.code).expect(200);
      expect(again.body).toEqual({ status: 'already_friends', userId: ann.id });
      await settle();
      expect(bobLog.names().filter((n) => n !== 'presence:update')).toEqual([]);
      expect(await usesOf(invite.code)).toBe(1);
    });

    it('half a friendship (one saved the other) is completed, the saved name kept', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await saveContact(ann, bob, 'Bobby');
      const invite = await create(ann);
      expect((await accept(bob, invite.code).expect(200)).body.status).toBe('friends');
      const [kept] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.ownerId, ann.id), eq(contacts.contactId, bob.id)));
      expect(kept!.name).toBe('Bobby');
      expect(await contactIdsOf(bob)).toEqual([ann.id]);
    });

    it('pending requests between us go, either way', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await t.api(bob).post('/api/friends/requests').send({ userId: ann.id }).expect(200);
      const invite = await create(ann);
      await accept(bob, invite.code).expect(200);
      for (const u of [ann, bob]) {
        const r = (await t.api(u).get('/api/friends/requests').expect(200)).body as FriendRequests;
        expect(r).toEqual({ incoming: [], outgoing: [] });
      }
    });

    it('my own link is refused (400) and counts nothing', async () => {
      const ann = await t.createUser();
      const invite = await create(ann);
      const res = await accept(ann, invite.code).expect(400);
      expect(res.body.error.message).toBe("You can't add yourself as a friend");
      expect(await usesOf(invite.code)).toBe(0);
    });

    it(`works ${FRIEND_INVITE_MAX_USES} times, then the link is used up`, async () => {
      const ann = await t.createUser();
      const invite = await create(ann);
      for (let i = 0; i < FRIEND_INVITE_MAX_USES; i++)
        await accept(await t.createUser(), invite.code).expect(200);
      expect(await usesOf(invite.code)).toBe(FRIEND_INVITE_MAX_USES);
      expect(await mine(ann)).toEqual([]);
      await expectDead(await t.createUser(), invite.code);
      expect(await contactIdsOf(ann)).toHaveLength(FRIEND_INVITE_MAX_USES);
    });

    it('two people accepting the last use at once: one wins', async () => {
      const ann = await t.createUser();
      const invite = await create(ann);
      await db
        .update(friendInvites)
        .set({ uses: FRIEND_INVITE_MAX_USES - 1 })
        .where(eq(friendInvites.code, invite.code));
      const [x, y] = [await t.createUser(), await t.createUser()];
      const codes = (await Promise.all([accept(x, invite.code), accept(y, invite.code)]))
        .map((r) => r.status)
        .sort();
      expect(codes).toEqual([200, 404]);
      expect(await usesOf(invite.code)).toBe(FRIEND_INVITE_MAX_USES);
      expect(await contactIdsOf(ann)).toHaveLength(1);
    });
  });
});
