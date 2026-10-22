/**
 * Friends (W7-A): requests by username or id, accept (both contact rows), the mutual
 * auto-accept, decline / cancel / remove, `friendRequestsFrom`, blocks and deleted accounts
 * that look exactly like an unknown username, the pending cap, events and pushes.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { and, eq, or } from 'drizzle-orm';
import {
  MAX_PENDING_FRIEND_REQUESTS,
  type Contact,
  type FriendRequests,
  type PushPayload,
  type SpaceDetail,
  type SpaceInvite,
  type UserPublic,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { contacts, friendRequests, users } from '../../src/db/schema.js';
import { CANT_ADD_MESSAGE, loadFriendRequests } from '../../src/modules/friends/service.js';
import { pushIdle, setPushSender } from '../../src/modules/push/sender.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import {
  block,
  countQueries,
  recordEvents,
  saveContact,
  setAvailability,
  setSettings,
  settle,
} from '../services/fixtures.js';

describe('friends', () => {
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

  const send = (from: TestUser, body: Record<string, unknown>) =>
    t.api(from).post('/api/friends/requests').send(body);
  const requestsOf = async (user: TestUser) =>
    (await t.api(user).get('/api/friends/requests').expect(200)).body as FriendRequests;
  const contactIdsOf = async (user: TestUser) =>
    ((await t.api(user).get('/api/contacts').expect(200)).body as Contact[]).map((c) => c.user.id);
  const pairRows = (a: TestUser, b: TestUser) =>
    db
      .select()
      .from(friendRequests)
      .where(
        or(
          and(eq(friendRequests.fromId, a.id), eq(friendRequests.toId, b.id)),
          and(eq(friendRequests.fromId, b.id), eq(friendRequests.toId, a.id)),
        ),
      );

  async function subscribe(user: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/friends-${++endpoints}`;
    await t
      .api(user)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }

  /** The 404 every unreachable target gets, compared byte for byte. */
  async function expectCantAdd(from: TestUser, body: Record<string, unknown>) {
    const res = await send(from, body).expect(404);
    expect(res.body).toEqual({ error: { code: 'not_found', message: CANT_ADD_MESSAGE } });
  }

  async function befriend(a: TestUser, b: TestUser) {
    await send(a, { userId: b.id }).expect(200);
    await t.api(b).post(`/api/friends/requests/${a.id}/accept`).expect(204);
  }

  describe('send', () => {
    it('by username (any case, @ allowed): friends:request → them, friends:changed → me, a push to them', async () => {
      const ann = await t.createUser({ username: 'ann_sends', displayName: 'Ann' });
      const bob = await t.createUser({ username: 'bob_gets', displayName: 'Bob' });
      const endpoint = await subscribe(bob);
      const sAnn = await t.connect(ann);
      const sBob = await t.connect(bob);
      const incoming = waitForEvent(sBob, 'friends:request');
      const mine = waitForEvent(sAnn, 'friends:changed');

      const res = await send(ann, { username: ' @Bob_Gets ' }).expect(200);
      expect(res.body).toEqual({ status: 'sent' });
      const { request } = await incoming;
      expect(request).toMatchObject({
        direction: 'incoming',
        user: { id: ann.id, displayName: 'Ann' },
      });
      expect(Date.parse(request.createdAt)).not.toBeNaN();
      expect(await mine).toEqual({});

      await pushIdle();
      expect(pushes).toEqual([
        {
          endpoint,
          payload: expect.objectContaining({
            type: 'message',
            title: 'Ann',
            body: 'Sent you a friend request',
            tag: `friend:${ann.id}`,
            url: '/chats?friends=pending',
          }),
        },
      ]);

      const annSide = await requestsOf(ann);
      expect(annSide.incoming).toEqual([]);
      expect(annSide.outgoing).toMatchObject([{ direction: 'outgoing', user: { id: bob.id } }]);
      const bobSide = await requestsOf(bob);
      expect(bobSide.outgoing).toEqual([]);
      expect(bobSide.incoming).toMatchObject([{ direction: 'incoming', user: { id: ann.id } }]);
    });

    it('sending again is idempotent: sent, no new event or push', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await subscribe(bob);
      await send(ann, { userId: bob.id }).expect(200);
      await pushIdle();
      pushes = [];
      const sBob = await t.connect(bob);
      expect((await send(ann, { username: bob.username }).expect(200)).body).toEqual({
        status: 'sent',
      });
      await expectNoEvent(sBob, 'friends:request');
      await pushIdle();
      expect(pushes).toEqual([]);
      expect(await pairRows(ann, bob)).toHaveLength(1);
    });

    it('myself is 400, a bad body 400, an unknown user the not-found answer', async () => {
      const ann = await t.createUser();
      await send(ann, { username: ann.username }).expect(400);
      await send(ann, { userId: ann.id }).expect(400);
      await send(ann, {}).expect(400);
      await send(ann, { username: 'x', userId: ann.id }).expect(400);
      await expectCantAdd(ann, { username: 'nobody_by_that_name' });
      await expectCantAdd(ann, { userId: crypto.randomUUID() });
    });

    it('a deleted account looks like an unknown username', async () => {
      const ann = await t.createUser();
      const gone = await t.createUser();
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      await expectCantAdd(ann, { userId: gone.id });
      const [row] = await db
        .select({ username: users.username })
        .from(users)
        .where(eq(users.id, gone.id));
      await expectCantAdd(ann, { username: row!.username });
    });

    it('a block either way looks like an unknown username', async () => {
      const ann = await t.createUser();
      const blocker = await t.createUser();
      const blockedByAnn = await t.createUser();
      await block(blocker, ann);
      await block(ann, blockedByAnn);
      await expectCantAdd(ann, { username: blocker.username });
      await expectCantAdd(ann, { userId: blocker.id });
      await expectCantAdd(ann, { userId: blockedByAnn.id });
      await expectCantAdd(blockedByAnn, { userId: ann.id });
      expect(
        await db.select().from(friendRequests).where(eq(friendRequests.fromId, ann.id)),
      ).toEqual([]);
    });

    it('already friends is 409', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await befriend(ann, bob);
      const res = await send(ann, { userId: bob.id }).expect(409);
      expect(res.body.error).toEqual({ code: 'conflict', message: "You're already friends" });
      await send(bob, { username: ann.username }).expect(409);
    });

    it('caps my pending requests at MAX_PENDING_FRIEND_REQUESTS', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      const stamp = Math.random().toString(36).slice(2, 8);
      const others = await db
        .insert(users)
        .values(
          Array.from({ length: MAX_PENDING_FRIEND_REQUESTS }, (_, i) => ({
            username: `cap${i}_${stamp}`,
            displayName: `Cap ${i}`,
            passwordHash: '!',
            about: '',
          })),
        )
        .returning({ id: users.id });
      await db.insert(friendRequests).values(others.map((o) => ({ fromId: ann.id, toId: o.id })));
      const res = await send(ann, { userId: bob.id }).expect(409);
      expect(res.body.error.code).toBe('limit_reached');
      // Answering a request is never capped.
      await send(bob, { userId: ann.id }).expect(200);
      expect((await send(ann, { userId: bob.id }).expect(200)).body).toEqual({
        status: 'accepted',
      });
    });
  });

  describe('who may send me requests (friendRequestsFrom)', () => {
    it("'nobody' refuses everyone with the not-found answer", async () => {
      const ann = await t.createUser();
      const shy = await t.createUser();
      await t.api(shy).patch('/api/me/settings').send({ friendRequestsFrom: 'nobody' }).expect(200);
      await expectCantAdd(ann, { userId: shy.id });
      await expectCantAdd(ann, { username: shy.username });
      // They can still send one themselves, and I can answer it.
      await send(shy, { userId: ann.id }).expect(200);
      await t.api(ann).post(`/api/friends/requests/${shy.id}/accept`).expect(204);
    });

    it("'spaces' needs a shared Space; 'everyone' (the default) anyone", async () => {
      const owner = await t.createUser();
      const member = await t.createUser();
      const stranger = await t.createUser();
      await setSettings(owner, { friendRequestsFrom: 'spaces' });
      await expectCantAdd(member, { userId: owner.id });

      const detail = (await t.api(owner).post('/api/spaces').send({ name: 'Friendly' }).expect(201))
        .body as SpaceDetail;
      const invite = (
        await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
      ).body as SpaceInvite;
      await t.api(member).post(`/api/invites/${invite.code}/join`).expect(200);
      await spaceRegistryIdle();

      expect((await send(member, { userId: owner.id }).expect(200)).body).toEqual({
        status: 'sent',
      });
      await expectCantAdd(stranger, { userId: owner.id });
      await setSettings(owner, { friendRequestsFrom: 'everyone' });
      await send(stranger, { userId: owner.id }).expect(200);
    });
  });

  describe('accept, decline, cancel, remove', () => {
    it('accept: both contact rows, requests gone, friends:changed + contacts:changed → both, user:changed → each other, a push to the sender', async () => {
      const ann = await t.createUser({ displayName: 'Ann' });
      const bob = await t.createUser({ displayName: 'Bob' });
      await send(ann, { userId: bob.id }).expect(200);
      const endpoint = await subscribe(ann);
      const sAnn = await t.connect(ann);
      const sBob = await t.connect(bob);
      const annLog = recordEvents(sAnn);
      const bobLog = recordEvents(sBob);

      await t.api(bob).post(`/api/friends/requests/${ann.id}/accept`).expect(204);
      await settle();
      const relevant = (names: string[]) => names.filter((n) => n !== 'presence:update');
      expect(relevant(annLog.names())).toEqual([
        'friends:changed',
        'contacts:changed',
        'user:changed',
      ]);
      expect(relevant(bobLog.names())).toEqual([
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
      expect(rows.map((r) => r.name)).toEqual([null, null]); // shown under their display names
      const seen = (await t.api(ann).get(`/api/users/${bob.id}`).expect(200)).body as UserPublic;
      expect(seen).toMatchObject({ isContact: true, contactName: null });
      expect(await requestsOf(ann)).toEqual({ incoming: [], outgoing: [] });
      expect(await requestsOf(bob)).toEqual({ incoming: [], outgoing: [] });

      await pushIdle();
      expect(pushes).toEqual([
        {
          endpoint,
          payload: expect.objectContaining({ title: 'Bob', body: 'Accepted your friend request' }),
        },
      ]);
      // Only the recipient accepts, and only once.
      await t.api(bob).post(`/api/friends/requests/${ann.id}/accept`).expect(404);
      await t.api(ann).post(`/api/friends/requests/${bob.id}/accept`).expect(404);
    });

    it('sending to someone who asked me first accepts their request', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await send(ann, { userId: bob.id }).expect(200);
      const sAnn = await t.connect(ann);
      const changed = waitForEvent(sAnn, 'friends:changed');
      expect((await send(bob, { username: ann.username.toUpperCase() }).expect(200)).body).toEqual({
        status: 'accepted',
      });
      await changed;
      expect(await pairRows(ann, bob)).toEqual([]);
      expect(await contactIdsOf(ann)).toEqual([bob.id]);
      expect(await contactIdsOf(bob)).toEqual([ann.id]);
    });

    it('sending to someone who already saved me as a contact makes us friends (their saved name stays)', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await saveContact(bob, ann, 'Annie');
      expect((await send(ann, { userId: bob.id }).expect(200)).body).toEqual({
        status: 'accepted',
      });
      expect(await contactIdsOf(ann)).toEqual([bob.id]);
      const [kept] = await db
        .select()
        .from(contacts)
        .where(and(eq(contacts.ownerId, bob.id), eq(contacts.contactId, ann.id)));
      expect(kept!.name).toBe('Annie');
    });

    it('decline (the recipient) and cancel (the sender) delete the request with friends:changed → both', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      const sAnn = await t.connect(ann);
      const sBob = await t.connect(bob);

      await send(ann, { userId: bob.id }).expect(200);
      await settle();
      let annChanged = waitForEvent(sAnn, 'friends:changed');
      let bobChanged = waitForEvent(sBob, 'friends:changed');
      await t.api(bob).delete(`/api/friends/requests/${ann.id}`).expect(204);
      await Promise.all([annChanged, bobChanged]);
      expect(await requestsOf(ann)).toEqual({ incoming: [], outgoing: [] });
      await t.api(bob).delete(`/api/friends/requests/${ann.id}`).expect(404);

      await send(ann, { userId: bob.id }).expect(200);
      await settle();
      annChanged = waitForEvent(sAnn, 'friends:changed');
      bobChanged = waitForEvent(sBob, 'friends:changed');
      await t.api(ann).delete(`/api/friends/requests/${bob.id}`).expect(204);
      await Promise.all([annChanged, bobChanged]);
      expect(await requestsOf(bob)).toEqual({ incoming: [], outgoing: [] });
      expect(await contactIdsOf(ann)).toEqual([]);
      await t.api(ann).delete(`/api/friends/requests/${bob.id}`).expect(404);
    });

    it('remove friend deletes both contact rows with friends:changed + contacts:changed → both', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await befriend(ann, bob);
      const sAnn = await t.connect(ann);
      const sBob = await t.connect(bob);
      const annLog = recordEvents(sAnn);
      const bobLog = recordEvents(sBob);

      await t.api(ann).delete(`/api/friends/${bob.id}`).expect(204);
      await settle();
      for (const log of [annLog, bobLog])
        expect(log.names().filter((n) => n !== 'presence:update')).toEqual([
          'friends:changed',
          'contacts:changed',
          'user:changed',
        ]);
      expect(await contactIdsOf(ann)).toEqual([]);
      expect(await contactIdsOf(bob)).toEqual([]);
      await t.api(ann).delete(`/api/friends/${bob.id}`).expect(404);
      // Not in my contacts: nothing to remove (and their saved contact of me stays).
      await saveContact(bob, ann);
      await t.api(ann).delete(`/api/friends/${bob.id}`).expect(404);
      expect(await contactIdsOf(bob)).toEqual([ann.id]);
    });
  });

  describe('blocks and listing', () => {
    it('blocking drops pending requests both ways with friends:changed → both', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await send(ann, { userId: bob.id }).expect(200);
      const sAnn = await t.connect(ann);
      const sBob = await t.connect(bob);
      const annChanged = waitForEvent(sAnn, 'friends:changed');
      const bobChanged = waitForEvent(sBob, 'friends:changed');
      await t.api(bob).put(`/api/blocks/${ann.id}`).expect(204);
      await Promise.all([annChanged, bobChanged]);
      expect(await pairRows(ann, bob)).toEqual([]);
      expect(await requestsOf(ann)).toEqual({ incoming: [], outgoing: [] });
      // Unblocked again: a new request works.
      await t.api(bob).delete(`/api/blocks/${ann.id}`).expect(204);
      await send(ann, { userId: bob.id }).expect(200);
    });

    it('deleting an account drops its pending requests with friends:changed → the other side', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      const cid = await t.createUser();
      await send(ann, { userId: bob.id }).expect(200);
      await send(cid, { userId: ann.id }).expect(200);
      const sBob = await t.connect(bob);
      const sCid = await t.connect(cid);
      const bobChanged = waitForEvent(sBob, 'friends:changed');
      const cidChanged = waitForEvent(sCid, 'friends:changed');
      await t.api(ann).delete('/api/me').send({ password: ann.password }).expect(204);
      await Promise.all([bobChanged, cidChanged]);
      expect(await requestsOf(bob)).toEqual({ incoming: [], outgoing: [] });
      expect(await requestsOf(cid)).toEqual({ incoming: [], outgoing: [] });
    });

    it('lists newest first, as I see the users, in a fixed number of queries', async () => {
      const me = await t.createUser();
      const peers: TestUser[] = [];
      for (let i = 0; i < 4; i++) peers.push(await t.createUser({ displayName: `Peer ${i}` }));
      await send(peers[0]!, { userId: me.id }).expect(200);
      const one = await countQueries(() => loadFriendRequests(db, me.id));
      await send(me, { userId: peers[1]!.id }).expect(200);
      await send(peers[2]!, { userId: me.id }).expect(200);
      await send(me, { userId: peers[3]!.id }).expect(200);
      await saveContact(peers[2]!, me, 'Saved by them');
      const four = await countQueries(() => loadFriendRequests(db, me.id));
      expect(four.queries).toBe(one.queries);
      expect(four.queries).toBeLessThanOrEqual(4);
      const list = await requestsOf(me);
      expect(list).toEqual(four.result);
      expect(list.incoming.map((r) => r.user.id)).toEqual([peers[2]!.id, peers[0]!.id]);
      expect(list.outgoing.map((r) => r.user.id)).toEqual([peers[3]!.id, peers[1]!.id]);
      expect(list.incoming[0]!.user.isContact).toBe(false); // my view, not theirs
    });

    it('no push while the recipient is on do not disturb', async () => {
      const ann = await t.createUser();
      const bob = await t.createUser();
      await subscribe(bob);
      await setAvailability(bob, 'dnd');
      await send(ann, { userId: bob.id }).expect(200);
      await pushIdle();
      expect(pushes).toEqual([]);
    });
  });
});
