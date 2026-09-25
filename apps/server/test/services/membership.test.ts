import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { chatMembers, messages, users } from '../../src/db/schema.js';
import { activeMemberIds, getChat, ownerId } from '../../src/services/chats.js';
import { transact } from '../../src/services/effects.js';
import { domainEvents } from '../../src/services/events.js';
import {
  changeRole,
  ensureOwner,
  evaluateAddTargets,
  transferOwnership,
  upsertMembership,
  wasRemovedByAdmin,
  wasRemovedFromCommunity,
} from '../../src/services/membership.js';
import { loadMessagePage } from '../../src/services/messages.js';
import { systemMessageAllowed } from '../../src/services/system.js';
import { toChatSummary } from '../../src/services/summaries.js';
import { expectNoEvent, startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import {
  block,
  createChannel,
  createCommunity,
  createGroup,
  goOffline,
  memberRow,
  recordEvents,
  saveContact,
  send,
  setSettings,
  settle,
} from './fixtures.js';

describe('services/membership', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
  });
  afterAll(() => t.close());

  const add = (chatId: string, userIds: string[], actorId = alice.id) =>
    transact((tx, fx) =>
      upsertMembership(tx, fx, { kind: 'activate', chatId, userIds, addedBy: actorId, systemEvent: { kind: 'members_added', actorId, userIds } }),
    );
  const remove = (chatId: string, userId: string, actorId = alice.id) =>
    transact((tx, fx) =>
      upsertMembership(tx, fx, { kind: 'deactivate', chatId, userId, reason: 'removed', systemEvent: { kind: 'member_removed', actorId, userId } }),
    );
  const leave = (chatId: string, userId: string) =>
    transact((tx, fx) => upsertMembership(tx, fx, { kind: 'deactivate', chatId, userId, reason: 'left', systemEvent: { kind: 'member_left', actorId: userId } }));

  describe('activate', () => {
    it('new member: joined_seq = S.seq − 1, receives chat:upsert BEFORE message:new of S', async () => {
      const chatId = await createGroup(alice, [bob]);
      await send(alice, chatId, 'old history');
      const carolSock = await t.connect(carol);
      const rec = recordEvents(carolSock);
      const res = await add(chatId, [carol.id]);
      await settle();
      const S = res.systemMessage!;
      const relevant = rec.log.filter((e) => e.event === 'chat:upsert' || e.event === 'message:new');
      expect(relevant.map((e) => e.event)).toEqual(['chat:upsert', 'message:new']);
      expect(relevant[0]!.payload.chat).toMatchObject({ id: chatId, membership: 'active', lastMessage: { id: S.id } });
      expect(relevant[1]!.payload.message).toMatchObject({ id: S.id, system: { kind: 'members_added', userIds: [carol.id] } });
      const row = await memberRow(chatId, carol);
      expect(Number(row.joinedSeq)).toBe(Number(S.seq) - 1);
      expect(Number(row.lastReadSeq)).toBe(Number(row.joinedSeq));
      expect(row.addedBy).toBe(alice.id);
      const page = await loadMessagePage(db, carol.id, chatId, { limit: 50 });
      expect(page.messages.map((m) => m.id)).toEqual([S.id]); // sees "X added you", no older history
      await goOffline(carol, carolSock);
    });

    it('rejects already-active users and rejoin starts a new window keeping prefs', async () => {
      const chatId = await createGroup(alice, [bob]);
      await expect(add(chatId, [bob.id])).rejects.toMatchObject({ status: 409 });
      await db.update(chatMembers).set({ isPinned: true, mutedUntil: new Date('2999-01-01') }).where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, bob.id)));
      await leave(chatId, bob.id);
      const between = await send(alice, chatId, 'while bob was away');
      const res = await add(chatId, [bob.id]);
      const row = await memberRow(chatId, bob);
      expect(row).toMatchObject({ leftAt: null, leftSeq: null, leftReason: null, role: 'member', hidden: false, isPinned: true });
      expect(row.mutedUntil).not.toBeNull();
      expect(Number(row.joinedSeq)).toBe(Number(res.systemMessage!.seq) - 1);
      const page = await loadMessagePage(db, bob.id, chatId, { limit: 50 });
      expect(page.messages.map((m) => m.id)).not.toContain(between.message.id);
    });

    it('announcement groups (no system message): joined_seq = last_seq; channels: joined_seq 0, marks = last_seq', async () => {
      const { announcementChatId } = await createCommunity(alice);
      await send(alice, announcementChatId, 'announcement 1');
      const res = await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: announcementChatId, userIds: [bob.id], addedBy: alice.id }));
      expect(res.systemMessage).toBeNull();
      expect(Number((await memberRow(announcementChatId, bob)).joinedSeq)).toBe(Number(res.chat.lastSeq));
      expect(systemMessageAllowed(res.chat, 'members_added')).toBe(false);

      const channelId = await createChannel(alice);
      await send(alice, channelId, 'p1');
      await send(alice, channelId, 'p2');
      const bobSock = await t.connect(bob);
      const upsert = waitForEvent(bobSock, 'chat:upsert', { filter: (p) => p.chat.id === channelId });
      const follow = await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: channelId, userIds: [bob.id] }));
      const row = await memberRow(channelId, bob);
      expect(Number(row.joinedSeq)).toBe(0);
      expect(Number(row.lastReadSeq)).toBe(Number(follow.chat.lastSeq));
      expect(Number(row.lastDeliveredSeq)).toBe(Number(follow.chat.lastSeq));
      const summary = (await upsert).chat;
      expect(summary).toMatchObject({ unreadCount: 0, membership: 'active' }); // full history, no backlog
      expect((await loadMessagePage(db, bob.id, channelId, { limit: 50 })).messages).toHaveLength(3);
      await goOffline(bob, bobSock);
    });
  });

  describe('deactivate', () => {
    it('removed member gets the removal message, then chat:upsert (removed), then no further room events', async () => {
      const chatId = await createGroup(alice, [bob, carol]);
      const bobSock = await t.connect(bob);
      const rec = recordEvents(bobSock);
      const left: unknown[] = [];
      const off = domainEvents.on('member.left', (e) => void left.push(e));
      const res = await remove(chatId, bob.id);
      off();
      await settle();
      const S = res.systemMessage!;
      const relevant = rec.log.filter((e) => ['message:new', 'chat:upsert'].includes(e.event));
      expect(relevant.map((e) => e.event)).toEqual(['message:new', 'chat:upsert']);
      expect(relevant[0]!.payload.message).toMatchObject({ id: S.id, system: { kind: 'member_removed', userId: bob.id } });
      expect(relevant[1]!.payload.chat).toMatchObject({ id: chatId, membership: 'removed', lastSeq: Number(S.seq), lastMessage: { id: S.id } });
      expect(left).toEqual([{ chatId, userId: bob.id, reason: 'removed' }]);
      const row = await memberRow(chatId, bob);
      expect(row).toMatchObject({ leftReason: 'removed', role: 'member', leftSeq: S.seq });

      rec.clear();
      await send(alice, chatId, 'after removal');
      await transact(async (tx, fx) => {
        fx.chatUpdated(chatId, { name: 'Renamed' });
      });
      await settle();
      expect(rec.log.filter((e) => ['message:new', 'chat:updated', 'message:updated'].includes(e.event))).toEqual([]);
      await goOffline(bob, bobSock);
    });

    it('owner leaving: succession to the oldest admin, owner_changed after member_left, leaver excluded from it', async () => {
      const dan = await t.createUser();
      const chatId = await createGroup(alice, [bob, carol, dan], { admins: [carol, dan] });
      // dan became admin at the same time as carol; make carol the older admin
      await db.update(chatMembers).set({ joinedAt: new Date(Date.now() - 60_000) }).where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, carol.id)));
      const aliceSock = await t.connect(alice);
      const carolSock = await t.connect(carol);
      const aliceRec = recordEvents(aliceSock);
      const carolRec = recordEvents(carolSock);
      const res = await leave(chatId, alice.id);
      await settle();
      expect(res.newOwnerId).toBe(carol.id);
      expect(await ownerId(db, chatId)).toBe(carol.id);
      const sys = await db.select().from(messages).where(and(eq(messages.chatId, chatId), eq(messages.type, 'system')));
      const kinds = sys.sort((a, b) => Number(a.seq) - Number(b.seq)).map((m) => m.metadata.system!.kind);
      expect(kinds.slice(-2)).toEqual(['member_left', 'owner_changed']);

      const aliceNew = aliceRec.of('message:new').map((p) => p.message.system?.kind);
      expect(aliceNew).toEqual(['member_left']); // owner_changed is after her window
      expect(aliceRec.of('chat:upsert').at(-1)!.chat).toMatchObject({ membership: 'left', myRole: 'member' });
      expect(carolRec.of('message:new').map((p) => p.message.system?.kind)).toEqual(['member_left', 'owner_changed']);
      const carolOrder = carolRec.names().filter((n) => n === 'message:new' || n === 'chat:upsert');
      expect(carolOrder).toEqual(['message:new', 'message:new', 'chat:upsert']);
      expect(carolRec.of('chat:upsert').at(-1)!.chat).toMatchObject({ myRole: 'owner' });
      await goOffline(alice, aliceSock);
      await goOffline(carol, carolSock);
    });

    it('succession falls back to the oldest member; empty groups stay ownerless', async () => {
      const chatId = await createGroup(alice, [bob]);
      await leave(chatId, alice.id);
      expect(await ownerId(db, chatId)).toBe(bob.id);
      const r = await leave(chatId, bob.id);
      expect(r.newOwnerId).toBeNull();
      expect(await activeMemberIds(db, chatId)).toEqual([]);
      expect(await transact((tx, fx) => ensureOwner(tx, fx, chatId))).toBeNull();
    });

    it('announcement groups: hide → chat:removed, no system message', async () => {
      const { announcementChatId, communityId } = await createCommunity(alice);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: announcementChatId, userIds: [bob.id], addedBy: alice.id }));
      const bobSock = await t.connect(bob);
      const removed = waitForEvent(bobSock, 'chat:removed');
      const res = await transact((tx, fx) =>
        upsertMembership(tx, fx, { kind: 'deactivate', chatId: announcementChatId, userId: bob.id, reason: 'removed', hide: true }),
      );
      expect(await removed).toEqual({ chatId: announcementChatId });
      expect(res.systemMessage).toBeNull();
      expect(await memberRow(announcementChatId, bob)).toMatchObject({ hidden: true, leftReason: 'removed' });
      expect(await toChatSummary(db, bob.id, announcementChatId)).toBeNull();
      expect(await wasRemovedFromCommunity(db, communityId, bob.id)).toBe(true);
      await goOffline(bob, bobSock);
    });
  });

  describe('channels', () => {
    it('unfollow deletes the row and emits chat:removed; the owner cannot unfollow', async () => {
      const channelId = await createChannel(alice);
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: channelId, userIds: [bob.id] }));
      const bobSock = await t.connect(bob);
      const removed = waitForEvent(bobSock, 'chat:removed');
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'unfollow', chatId: channelId, userId: bob.id }));
      expect(await removed).toEqual({ chatId: channelId });
      expect(await db.select().from(chatMembers).where(and(eq(chatMembers.chatId, channelId), eq(chatMembers.userId, bob.id)))).toHaveLength(0);
      await send(alice, channelId, 'after unfollow');
      await expectNoEvent(bobSock, 'message:new');
      await expect(transact((tx, fx) => upsertMembership(tx, fx, { kind: 'unfollow', chatId: channelId, userId: alice.id }))).rejects.toMatchObject({ status: 409 });
      await goOffline(bob, bobSock);
    });

    it('channel succession promotes only admins', async () => {
      const channelId = await createChannel(alice, { admins: [carol] });
      await transact((tx, fx) => upsertMembership(tx, fx, { kind: 'activate', chatId: channelId, userIds: [bob.id] }));
      await db.update(chatMembers).set({ role: 'member' }).where(and(eq(chatMembers.chatId, channelId), eq(chatMembers.userId, alice.id)));
      expect(await transact((tx, fx) => ensureOwner(tx, fx, channelId))).toBe(carol.id);
      const noAdmins = await createChannel(bob);
      await db.update(chatMembers).set({ role: 'member' }).where(eq(chatMembers.chatId, noAdmins));
      expect(await transact((tx, fx) => ensureOwner(tx, fx, noAdmins))).toBeNull();
    });
  });

  describe('roles', () => {
    it('changeRole / transferOwnership: system messages, upserts, owner protection', async () => {
      const chatId = await createGroup(alice, [bob, carol]);
      const bobSock = await t.connect(bob);
      const rec = recordEvents(bobSock);
      expect(await transact((tx, fx) => changeRole(tx, fx, { chatId, userId: bob.id, role: 'admin', systemEvent: { kind: 'admin_promoted', actorId: alice.id, userId: bob.id } }))).toBe(true);
      await settle();
      expect(rec.names().filter((n) => n === 'message:new' || n === 'chat:upsert')).toEqual(['message:new', 'chat:upsert']);
      expect(rec.of('chat:upsert')[0]!.chat.myRole).toBe('admin');
      expect(await transact((tx, fx) => changeRole(tx, fx, { chatId, userId: bob.id, role: 'admin' }))).toBe(false);
      await expect(transact((tx, fx) => changeRole(tx, fx, { chatId, userId: alice.id, role: 'member' }))).rejects.toMatchObject({ status: 403 });

      await expect(transact((tx, fx) => transferOwnership(tx, fx, { chatId, fromUserId: bob.id, toUserId: carol.id }))).rejects.toMatchObject({ status: 403 });
      await transact((tx, fx) =>
        transferOwnership(tx, fx, { chatId, fromUserId: alice.id, toUserId: carol.id, systemEvent: { kind: 'owner_transferred', actorId: alice.id, userId: carol.id } }),
      );
      expect(await ownerId(db, chatId)).toBe(carol.id);
      expect((await memberRow(chatId, alice)).role).toBe('admin');
      await goOffline(bob, bobSock);
    });
  });

  describe('add rules', () => {
    it('evaluateAddTargets: not_found, already_member, needsInvite (blocks, nobody, contacts)', async () => {
      const [free, blocker, blocked, nobody, contactsOnly, contactsSaved, deleted] = await Promise.all(Array.from({ length: 7 }, () => t.createUser()));
      await block(blocker!, alice);
      await block(alice, blocked!);
      await setSettings(nobody!, { groupsAddPermission: 'nobody' });
      await setSettings(contactsOnly!, { groupsAddPermission: 'contacts' });
      await setSettings(contactsSaved!, { groupsAddPermission: 'contacts' });
      await saveContact(contactsSaved!, alice);
      await saveContact(alice, contactsOnly!); // the ADDER saving the target doesn't count
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted!.id));
      const unknown = crypto.randomUUID();
      const r = await evaluateAddTargets(db, {
        adderId: alice.id,
        userIds: [free!.id, blocker!.id, blocked!.id, nobody!.id, contactsOnly!.id, contactsSaved!.id, deleted!.id, unknown, bob.id],
        activeIds: [alice.id, bob.id],
      });
      expect(r.eligible).toEqual([free!.id, contactsSaved!.id]);
      expect(r.needsInvite).toEqual([blocker!.id, blocked!.id, nobody!.id, contactsOnly!.id]);
      expect(r.failed).toEqual([
        { userId: deleted!.id, reason: 'not_found' },
        { userId: unknown, reason: 'not_found' },
        { userId: bob.id, reason: 'already_member' },
      ]);
    });

    it('wasRemovedByAdmin: own removal or removal from the community', async () => {
      const chatId = await createGroup(alice, [bob, carol]);
      await remove(chatId, bob.id);
      await leave(chatId, carol.id);
      const chat = (await getChat(db, chatId))!;
      expect(await wasRemovedByAdmin(db, chat, bob.id)).toBe(true);
      expect(await wasRemovedByAdmin(db, chat, carol.id)).toBe(false);
    });
  });
});
