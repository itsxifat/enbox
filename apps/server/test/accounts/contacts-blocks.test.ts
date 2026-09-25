import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { ChatSummary, Contact, UserPublic } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { blocks, contacts } from '../../src/db/schema.js';
import { domainEvents, type DomainEventMap } from '../../src/services/events.js';
import { expectNoEvent, startTestServer, waitForEvent, type TestServer } from '../helpers.js';
import { createDirect, recordEvents, send, settle } from '../services/fixtures.js';
import { uniquePhone } from './util.js';

describe('contacts and blocks', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  describe('contacts', () => {
    it('adds a contact by userId, username or phone (201) and returns it with my view of the user', async () => {
      const me = await t.createUser();
      const byId = await t.createUser({ displayName: 'By Id' });
      const byName = await t.createUser({ username: 'by_username', displayName: 'By Name' });
      const phone = uniquePhone();
      const byPhone = await t.createUser({ displayName: 'By Phone', phone });

      const r1 = (await t.api(me).post('/api/contacts').send({ userId: byId.id, name: ' Buddy ' }).expect(201)).body as Contact;
      expect(r1).toMatchObject({ name: 'Buddy', user: { id: byId.id, isContact: true, contactName: 'Buddy', phone: null } });
      expect(Date.parse(r1.createdAt)).not.toBeNaN();
      const r2 = (await t.api(me).post('/api/contacts').send({ username: 'BY_USERNAME' }).expect(201)).body as Contact;
      expect(r2).toMatchObject({ name: null, user: { id: byName.id, isContact: true, contactName: null } });
      const r3 = (await t.api(me).post('/api/contacts').send({ phone: `${phone.slice(0, 2)} ${phone.slice(2, 5)}-${phone.slice(5)}` }).expect(201)).body as Contact;
      expect(r3.user.id).toBe(byPhone.id);

      const list = (await t.api(me).get('/api/contacts').expect(200)).body as Contact[];
      // Sorted by saved name, else display name: "Buddy", "By Name", "By Phone".
      expect(list.map((c) => c.user.id)).toEqual([byId.id, byName.id, byPhone.id]);
    });

    it('adding an existing contact is 200 (updates the name when given)', async () => {
      const me = await t.createUser();
      const u = await t.createUser();
      await t.api(me).post('/api/contacts').send({ userId: u.id }).expect(201);
      const again = (await t.api(me).post('/api/contacts').send({ userId: u.id, name: 'Renamed' }).expect(200)).body as Contact;
      expect(again.name).toBe('Renamed');
      expect((await t.api(me).post('/api/contacts').send({ userId: u.id }).expect(200)).body.name).toBe('Renamed');
      expect(await db.select().from(contacts).where(eq(contacts.ownerId, me.id))).toHaveLength(1);
    });

    it('validates the request and rejects unknown, deleted or self targets', async () => {
      const me = await t.createUser();
      const u = await t.createUser();
      await t.api(me).post('/api/contacts').send({}).expect(400);
      await t.api(me).post('/api/contacts').send({ userId: u.id, username: u.username }).expect(400);
      await t.api(me).post('/api/contacts').send({ userId: 'nope' }).expect(400);
      await t.api(me).post('/api/contacts').send({ userId: u.id, name: '' }).expect(400);
      await t.api(me).post('/api/contacts').send({ userId: crypto.randomUUID() }).expect(404);
      await t.api(me).post('/api/contacts').send({ username: 'no_such_user' }).expect(404);
      await t.api(me).post('/api/contacts').send({ phone: '+19999999999' }).expect(404);
      await t.api(me).post('/api/contacts').send({ userId: me.id }).expect(400);
      const gone = await t.createUser();
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      await t.api(me).post('/api/contacts').send({ userId: gone.id }).expect(404);
    });

    it('emits contacts:changed → me and user:changed {me} → the contact; they now see my phone', async () => {
      const me = await t.createUser({ phone: uniquePhone() });
      const friend = await t.createUser();
      const sMe = await t.connect(me);
      const sFriend = await t.connect(friend);
      expect(((await t.api(friend).get(`/api/users/${me.id}`).expect(200)).body as UserPublic).phone).toBeNull();
      const mine = waitForEvent(sMe, 'contacts:changed');
      const theirs = waitForEvent(sFriend, 'user:changed');
      await t.api(me).post('/api/contacts').send({ userId: friend.id }).expect(201);
      expect(await mine).toEqual({});
      expect(await theirs).toEqual({ userId: me.id });
      expect(((await t.api(friend).get(`/api/users/${me.id}`).expect(200)).body as UserPublic).phone).toMatch(/^\+1555/);
      await expectNoEvent(sFriend, 'contacts:changed');
    });

    it('PATCH renames (null clears) with contacts:changed → me only; 404 for non-contacts', async () => {
      const me = await t.createUser();
      const friend = await t.createUser({ displayName: 'Friend' });
      await t.api(me).post('/api/contacts').send({ userId: friend.id }).expect(201);
      const sMe = await t.connect(me);
      const sFriend = await t.connect(friend);
      const changed = waitForEvent(sMe, 'contacts:changed');
      const r = (await t.api(me).patch(`/api/contacts/${friend.id}`).send({ name: 'Bestie' }).expect(200)).body as Contact;
      expect(r).toMatchObject({ name: 'Bestie', user: { contactName: 'Bestie' } });
      await changed;
      await expectNoEvent(sFriend, 'user:changed');
      expect(((await t.api(me).patch(`/api/contacts/${friend.id}`).send({ name: null }).expect(200)).body as Contact).name).toBeNull();
      await t.api(me).patch(`/api/contacts/${friend.id}`).send({}).expect(400);
      await t.api(me).patch(`/api/contacts/${crypto.randomUUID()}`).send({ name: 'x' }).expect(404);
      await t.api(friend).patch(`/api/contacts/${me.id}`).send({ name: 'x' }).expect(404);
    });

    it('DELETE removes the contact (then 404) with contacts:changed → me and user:changed → them', async () => {
      const me = await t.createUser({ phone: uniquePhone() });
      const friend = await t.createUser();
      await t.api(me).post('/api/contacts').send({ userId: friend.id }).expect(201);
      const sMe = await t.connect(me);
      const sFriend = await t.connect(friend);
      const mine = waitForEvent(sMe, 'contacts:changed');
      const theirs = waitForEvent(sFriend, 'user:changed');
      await t.api(me).delete(`/api/contacts/${friend.id}`).expect(204);
      await mine;
      expect(await theirs).toEqual({ userId: me.id });
      await t.api(me).delete(`/api/contacts/${friend.id}`).expect(404);
      expect((await t.api(me).get('/api/contacts').expect(200)).body).toEqual([]);
      expect(((await t.api(friend).get(`/api/users/${me.id}`).expect(200)).body as UserPublic).phone).toBeNull();
    });
  });

  describe('blocks', () => {
    let blockedEvents: DomainEventMap['user.blocked'][];
    beforeAll(() => {
      blockedEvents = [];
      domainEvents.on('user.blocked', (e) => void blockedEvents.push(e));
    });

    it('PUT blocks: blocks:changed → me, chat:upsert of our direct chat → me, user:changed → them (in order); idempotent', async () => {
      const me = await t.createUser();
      const peer = await t.createUser();
      const chatId = await createDirect(me, peer);
      await send(peer, chatId, 'hello');
      const sMe = await t.connect(me);
      const sPeer = await t.connect(peer);
      const log = recordEvents(sMe);
      const peerLog = recordEvents(sPeer);

      await t.api(me).put(`/api/blocks/${peer.id}`).expect(204);
      await settle();
      expect(log.names().filter((n) => n !== 'presence:update')).toEqual(['blocks:changed', 'chat:upsert']);
      const chat = log.of('chat:upsert')[0]!.chat as ChatSummary;
      expect(chat).toMatchObject({ id: chatId, peer: { id: peer.id, isBlocked: true }, permissions: { canSend: false, canCall: false } });
      expect(peerLog.names().filter((n) => n !== 'presence:update')).toEqual(['user:changed']); // never blocks:changed / chat:upsert
      expect(peerLog.of('user:changed')).toEqual([{ userId: me.id }]);
      expect(blockedEvents).toContainEqual({ blockerId: me.id, blockedId: peer.id });

      const blocked = (await t.api(me).get('/api/blocks').expect(200)).body as UserPublic[];
      expect(blocked.map((u) => u.id)).toEqual([peer.id]);
      expect(blocked[0]!.isBlocked).toBe(true);

      log.clear();
      const before = blockedEvents.length;
      await t.api(me).put(`/api/blocks/${peer.id}`).expect(204);
      await settle();
      expect(log.names()).toEqual([]);
      expect(blockedEvents).toHaveLength(before);
      expect(await db.select().from(blocks).where(eq(blocks.blockerId, me.id))).toHaveLength(1);
    });

    it('the blocked user sees my profile/presence as null and still does not learn about the block', async () => {
      const me = await t.createUser();
      const peer = await t.createUser();
      await t.api(me).post('/api/contacts').send({ userId: peer.id }).expect(201);
      await t.api(me).put(`/api/blocks/${peer.id}`).expect(204);
      const seen = (await t.api(peer).get(`/api/users/${me.id}`).expect(200)).body as UserPublic;
      expect(seen).toMatchObject({ phone: null, online: null, lastSeenAt: null, isBlocked: false });
      expect((await t.api(peer).get('/api/blocks').expect(200)).body).toEqual([]);
    });

    it('blocking someone without a direct chat emits no chat:upsert; validation and 404s', async () => {
      const me = await t.createUser();
      const stranger = await t.createUser();
      const sMe = await t.connect(me);
      const changed = waitForEvent(sMe, 'blocks:changed');
      await t.api(me).put(`/api/blocks/${stranger.id}`).expect(204);
      await changed;
      await expectNoEvent(sMe, 'chat:upsert');
      await t.api(me).put(`/api/blocks/${me.id}`).expect(400);
      await t.api(me).put(`/api/blocks/${crypto.randomUUID()}`).expect(404);
      await t.api(me).put('/api/blocks/nope').expect(400);
      const gone = await t.createUser();
      await t.api(gone).delete('/api/me').send({ password: gone.password }).expect(204);
      await t.api(me).put(`/api/blocks/${gone.id}`).expect(404);
    });

    it('DELETE unblocks with the same events (chat usable again); idempotent', async () => {
      const me = await t.createUser();
      const peer = await t.createUser();
      const chatId = await createDirect(me, peer);
      await t.api(me).put(`/api/blocks/${peer.id}`).expect(204);
      const sMe = await t.connect(me);
      const sPeer = await t.connect(peer);
      const log = recordEvents(sMe);
      const theirs = waitForEvent(sPeer, 'user:changed');
      await t.api(me).delete(`/api/blocks/${peer.id}`).expect(204);
      expect(await theirs).toEqual({ userId: me.id });
      await settle();
      expect(log.names().filter((n) => n !== 'presence:update')).toEqual(['blocks:changed', 'chat:upsert']);
      expect(log.of('chat:upsert')[0]!.chat).toMatchObject({ id: chatId, peer: { isBlocked: false }, permissions: { canSend: true } });
      expect(await db.select().from(blocks).where(and(eq(blocks.blockerId, me.id), eq(blocks.blockedId, peer.id)))).toEqual([]);
      log.clear();
      await t.api(me).delete(`/api/blocks/${peer.id}`).expect(204);
      await settle();
      expect(log.names()).toEqual([]);
      await t.api(me).delete(`/api/blocks/${crypto.randomUUID()}`).expect(404);
    });

    it('a hidden (deleted-for-me) direct chat is not upserted', async () => {
      const me = await t.createUser();
      const peer = await t.createUser();
      await createDirect(peer, me); // my row is hidden until a message arrives
      const sMe = await t.connect(me);
      const changed = waitForEvent(sMe, 'blocks:changed');
      await t.api(me).put(`/api/blocks/${peer.id}`).expect(204);
      await changed;
      await expectNoEvent(sMe, 'chat:upsert');
    });
  });
});
