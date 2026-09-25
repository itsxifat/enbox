import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, asc, eq, or, sql } from 'drizzle-orm';
import type { Presence, UserPublic } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { blocks, chatMembers, contacts, messages, pushSubscriptions, sessions, statuses, users } from '../../src/db/schema.js';
import { registerAccountDeletionHook } from '../../src/services/hooks.js';
import { toChatSummary } from '../../src/services/summaries.js';
import { emitAck, startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { block, createDirect, createGroup, memberRow, recordEvents, saveContact, send, settle } from '../services/fixtures.js';
import { newDevice, waitDisconnect } from './util.js';

describe('DELETE /api/me (account deletion)', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  it('requires the correct password (403) and a body (400); nothing changes', async () => {
    const u = await t.createUser();
    const s = await t.connect(u);
    expect((await t.api(u).delete('/api/me').send({ password: 'wrong-password' }).expect(403)).body.error.code).toBe('forbidden');
    await t.api(u).delete('/api/me').send({}).expect(400);
    await t.api(u).delete('/api/me').expect(400);
    await t.api(u).get('/api/me').expect(200);
    expect(s.connected).toBe(true);
  });

  describe('end to end', () => {
    let alice: TestUser;
    let bob: TestUser;
    let carol: TestUser;
    let dave: TestUser;
    let erin: TestUser;
    let direct: string;
    let g1: string; // owned by alice, carol is admin → succession
    let g2: string; // owned by bob, alice member
    let g3: string; // alice alone
    let hookSaw: { deletedAt: Date | null; sessions: number; statuses: number } | null = null;
    let bobLog: ReturnType<typeof recordEvents>;
    let carolLog: ReturnType<typeof recordEvents>;
    let daveLog: ReturnType<typeof recordEvents>;
    let erinLog: ReturnType<typeof recordEvents>;
    let bobPresence: Promise<Presence>;
    let aliceGone: Promise<string[]>;

    beforeAll(async () => {
      alice = await t.createUser({ username: 'alice_del', displayName: 'Alice', phone: '+15557770001' });
      const aliceTablet = await newDevice(alice, 'Tablet');
      bob = await t.createUser({ displayName: 'Bob' });
      carol = await t.createUser({ displayName: 'Carol' });
      dave = await t.createUser({ displayName: 'Dave' });
      erin = await t.createUser({ displayName: 'Erin' });

      direct = await createDirect(alice, bob);
      await send(alice, direct, 'hi bob');
      await send(bob, direct, 'hi alice');
      g1 = await createGroup(alice, [bob, carol], { name: 'G1', admins: [carol] });
      g2 = await createGroup(bob, [alice], { name: 'G2' });
      g3 = await createGroup(alice, [], { name: 'G3' });
      await saveContact(bob, alice);
      await saveContact(alice, carol);
      await block(dave, alice);
      await block(alice, erin);
      await db.insert(pushSubscriptions).values({ userId: alice.id, sessionId: alice.sessionId, endpoint: 'https://fcm.googleapis.com/fcm/send/alice', p256dh: 'p', auth: 'a' });
      await db.insert(statuses).values({ userId: alice.id, type: 'text', text: 'my status', audience: [bob.id], expiresAt: new Date(Date.now() + 3_600_000) });

      registerAccountDeletionHook('accounts-test', async (tx, _fx, userId) => {
        if (userId !== alice.id) return;
        const [row] = await tx.select({ deletedAt: users.deletedAt }).from(users).where(eq(users.id, userId));
        const [s] = await tx.select({ n: sql<number>`count(*)::int` }).from(sessions).where(eq(sessions.userId, userId));
        const [st] = await tx.select({ n: sql<number>`count(*)::int` }).from(statuses).where(eq(statuses.userId, userId));
        hookSaw = { deletedAt: row!.deletedAt, sessions: Number(s!.n), statuses: Number(st!.n) };
      });

      const sA1 = await t.connect(alice);
      const sA2 = await t.connect(aliceTablet);
      const sB = await t.connect(bob);
      const sC = await t.connect(carol);
      const sD = await t.connect(dave);
      const sE = await t.connect(erin);
      await emitAck(sB, 'presence:subscribe', { userIds: [alice.id] });
      bobLog = recordEvents(sB);
      carolLog = recordEvents(sC);
      daveLog = recordEvents(sD);
      erinLog = recordEvents(sE);
      bobPresence = waitForEvent(sB, 'presence:update', { filter: (p) => p.userId === alice.id });
      aliceGone = Promise.all([waitDisconnect(sA1), waitDisconnect(sA2)]);

      await t.api(alice).delete('/api/me').send({ password: alice.password }).expect(204);
      await aliceGone;
      await settle(250);
    });

    it('disconnects every device and revokes every session; the account cannot log in', async () => {
      await t.api(alice).get('/api/me').expect(401);
      await expect(t.connect(alice)).rejects.toThrow(/unauthorized/);
      await t.api().post('/api/auth/login').send({ identifier: 'alice_del', password: alice.password }).expect(401);
      await t.api().post('/api/auth/login').send({ identifier: '+15557770001', password: alice.password }).expect(401);
    });

    it('scrubs the row and deletes sessions, push subscriptions, contacts, blocks and statuses', async () => {
      const [row] = await db.select().from(users).where(eq(users.id, alice.id));
      expect(row).toMatchObject({
        username: `deleted_${alice.id.replace(/-/g, '').slice(0, 12)}`,
        displayName: 'Deleted account',
        phone: null,
        about: '',
        avatarMediaId: null,
        passwordHash: '!',
        settings: {},
      });
      expect(row!.deletedAt).toBeInstanceOf(Date);
      expect(await db.select().from(sessions).where(eq(sessions.userId, alice.id))).toEqual([]);
      expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, alice.id))).toEqual([]);
      expect(await db.select().from(contacts).where(or(eq(contacts.ownerId, alice.id), eq(contacts.contactId, alice.id)))).toEqual([]);
      expect(await db.select().from(blocks).where(or(eq(blocks.blockerId, alice.id), eq(blocks.blockedId, alice.id)))).toEqual([]);
      expect(await db.select().from(statuses).where(eq(statuses.userId, alice.id))).toEqual([]);
    });

    it('runs the registered deletion hooks inside the transaction, after the scrub (status hook removes statuses)', () => {
      expect(hookSaw).not.toBeNull();
      expect(hookSaw!.deletedAt).toBeInstanceOf(Date);
      expect(hookSaw!.sessions).toBe(0);
      // Statuses are still present when the hooks start; the status module's own hook
      // (registered before this probe) has already deleted them — and emitted status:deleted.
      expect(hookSaw!.statuses).toBe(0);
    });

    it('leaves every group through the normal pipeline, with ownership succession', async () => {
      for (const g of [g1, g2, g3]) expect(await memberRow(g, alice)).toMatchObject({ leftReason: 'left', role: 'member' });
      expect(await memberRow(g1, carol)).toMatchObject({ role: 'owner' });
      const g1Messages = await db.select().from(messages).where(eq(messages.chatId, g1)).orderBy(asc(messages.seq));
      expect(g1Messages.slice(-2).map((m) => m.metadata.system)).toEqual([
        { kind: 'member_left', actorId: alice.id },
        { kind: 'owner_changed', userId: carol.id },
      ]);
      // A group left without members stays (empty).
      const g3Active = await db.select().from(chatMembers).where(and(eq(chatMembers.chatId, g3), sql`${chatMembers.leftAt} is null`));
      expect(g3Active).toEqual([]);

      // Room events in matrix order (sys → [owner_changed] → memberCount → members-changed).
      // (chat:watermarks: bob's ticks changed because a member left — emitted by the leave pipeline.)
      const inChat = (chatId: string) =>
        bobLog.log.filter((e) => (e.payload?.chatId === chatId || e.payload?.message?.chatId === chatId) && e.event !== 'chat:watermarks');
      const g1Events = inChat(g1);
      expect(g1Events.map((e) => e.event)).toEqual(['message:new', 'message:new', 'chat:updated', 'chat:members-changed']);
      expect(g1Events[2]!.payload).toEqual({ chatId: g1, changes: { memberCount: 2 } });
      expect(inChat(g2).map((e) => e.event)).toEqual(['message:new', 'chat:updated', 'chat:members-changed']);
      // The new owner gets their summary.
      expect(carolLog.of('chat:upsert').map((p) => p.chat)).toContainEqual(expect.objectContaining({ id: g1, myRole: 'owner' }));
    });

    it('keeps the direct chat and its messages; the peer sees a deleted, unmessageable account', async () => {
      const summary = (await toChatSummary(db, bob.id, direct))!;
      expect(summary.peer).toMatchObject({ id: alice.id, isDeleted: true, displayName: 'Deleted account' });
      expect(summary.permissions).toMatchObject({ canSend: false, canCall: false });
      const rows = await db.select().from(messages).where(eq(messages.chatId, direct));
      expect(rows.map((m) => m.text)).toEqual(['hi bob', 'hi alice']);
      expect(await memberRow(direct, alice)).toMatchObject({ leftAt: null });
    });

    it('notifies the people who knew the account: user:changed once per socket, contacts:changed, blocks:changed, presence', async () => {
      expect(bobLog.of('user:changed')).toEqual([{ userId: alice.id }]);
      expect(carolLog.of('user:changed')).toEqual([{ userId: alice.id }]);
      expect(bobLog.of('contacts:changed')).toEqual([{}]); // bob had saved alice
      expect(daveLog.of('blocks:changed')).toEqual([{}]); // dave had blocked alice
      expect(erinLog.names()).not.toContain('blocks:changed'); // erin was blocked BY alice: nothing to update
      expect(await bobPresence).toEqual({ userId: alice.id, online: null, lastSeenAt: null });
    });

    it('cannot be found, looked up or added anymore; the username and phone are free again', async () => {
      const search = (await t.api(bob).get('/api/users/search').query({ q: 'alice_del' }).expect(200)).body as UserPublic[];
      expect(search).toEqual([]);
      await t.api(bob).get('/api/users/by-username/alice_del').expect(404);
      await t.api(bob).post('/api/contacts').send({ userId: alice.id }).expect(404);
      await t.api(bob).put(`/api/blocks/${alice.id}`).expect(404);
      const seen = (await t.api(bob).get(`/api/users/${alice.id}`).expect(200)).body as UserPublic;
      expect(seen).toMatchObject({ isDeleted: true, displayName: 'Deleted account', phone: null, avatarUrl: null, online: null });
      await t.api().post('/api/auth/register').send({ username: 'alice_del', displayName: 'New Alice', password: 'password-2', phone: '+15557770001' }).expect(201);
    });
  });
});
