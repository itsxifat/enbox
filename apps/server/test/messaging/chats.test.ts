import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { MUTE_FOREVER_ISO, type ChatMember, type ChatSummary, type Message } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, starredMessages, users } from '../../src/db/schema.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { block, createChannel, createCommunity, createGroup, recordEvents, setSettings, settle } from '../services/fixtures.js';
import { activeDirect, addToGroup, follow, historyOf, leaveGroup, memberOf, mkMedia, openDirect, sendOk, summaryOf } from './support.js';

describe('chats module (REST)', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
    dave = await t.createUser({ displayName: 'Dave' });
  });
  afterAll(() => t.close());

  describe('POST /chats/direct', () => {
    it('creates the chat lazily: JOIN(me) only, the peer row stays hidden until the first message', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const s1 = await t.connect(u1);
      const s2 = await t.connect(u2);
      const log1 = recordEvents(s1);
      const log2 = recordEvents(s2);

      const chat = await openDirect(t, u1, u2);
      expect(chat).toMatchObject({
        type: 'direct',
        name: null,
        peer: { id: u2.id },
        membership: 'active',
        myRole: 'member',
        memberCount: 2,
        lastMessage: null,
        lastSeq: 0,
        unreadCount: 0,
        permissions: { canSend: true, canCall: true, canPin: true, canViewMembers: true, canLeave: false, canAddMembers: false },
      });
      await settle();
      expect(log1.of('chat:upsert').map((p) => p.chat.id)).toEqual([chat.id]);
      expect(log2.log).toEqual([]);
      // The peer doesn't see it yet.
      const peerList = (await t.api(u2).get('/api/chats').expect(200)).body as ChatSummary[];
      expect(peerList.map((c) => c.id)).not.toContain(chat.id);
      await t.api(u2).get(`/api/chats/${chat.id}`).expect(404);

      // Idempotent: same chat, nothing emitted again.
      log1.clear();
      const again = await openDirect(t, u1, u2);
      expect(again.id).toBe(chat.id);
      await settle();
      expect(log1.log).toEqual([]);

      // The first message makes it visible to the peer: chat:upsert BEFORE message:new.
      const m = await sendOk(t, u1, chat.id, 'first!');
      await settle();
      const names = log2.names();
      expect(names.indexOf('chat:upsert')).toBeGreaterThanOrEqual(0);
      expect(names.indexOf('chat:upsert')).toBeLessThan(names.indexOf('message:new'));
      expect(log2.of('message:new')[0]!.message.id).toBe(m.id);
      const peerView = await summaryOf(t, u2, chat.id);
      expect(peerView).toMatchObject({ peer: { id: u1.id }, unreadCount: 1, lastMessage: { id: m.id } });
      s1.disconnect();
      s2.disconnect();
    });

    it('opening from the peer side unhides their row (JOIN) and reuses the chat', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const chat = await openDirect(t, u1, u2);
      const s2 = await t.connect(u2);
      const log2 = recordEvents(s2);
      const mirror = await openDirect(t, u2, u1);
      expect(mirror.id).toBe(chat.id);
      expect(mirror.peer!.id).toBe(u1.id);
      await settle();
      expect(log2.of('chat:upsert').map((p) => p.chat.id)).toEqual([chat.id]);
      expect((await memberOf(chat.id, u2))!.hidden).toBe(false);
      s2.disconnect();
    });

    it('"Message yourself": one member row, peer = me, ticks = lastSeq, no calls', async () => {
      const me = await t.createUser();
      const chat = await openDirect(t, me, me);
      expect(chat).toMatchObject({ peer: { id: me.id }, memberCount: 1, permissions: { canSend: true, canCall: false } });
      const rows = await db.select().from(chatMembers).where(eq(chatMembers.chatId, chat.id));
      expect(rows).toHaveLength(1);
      const m = await sendOk(t, me, chat.id, 'note to self');
      const after = await summaryOf(t, me, chat.id);
      expect(after).toMatchObject({ lastSeq: m.seq, readWatermark: m.seq, deliveredWatermark: m.seq, unreadCount: 0 });
      expect((await openDirect(t, me, me)).id).toBe(chat.id);
    });

    it('starts with the creator’s default disappearing timer', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      await setSettings(u1.id, { defaultDisappearingSeconds: 86_400 });
      const chat = await openDirect(t, u1, u2);
      expect(chat.disappearingSeconds).toBe(86_400);
      const m = await sendOk(t, u1, chat.id, 'vanishing');
      expect(Date.parse(m.expiresAt!) - Date.parse(m.createdAt)).toBe(86_400_000);
    });

    it('unknown users → 404, invalid ids → 400, deleted users only with existing history', async () => {
      await t.api(alice).post('/api/chats/direct').send({ userId: crypto.randomUUID() }).expect(404);
      await t.api(alice).post('/api/chats/direct').send({ userId: 'nope' }).expect(400);
      await t.api(alice).post('/api/chats/direct').send({}).expect(400);

      const gone = await t.createUser();
      const withHistory = await t.createUser();
      const chatId = await activeDirect(t, withHistory, gone);
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.id));
      await t.api(alice).post('/api/chats/direct').send({ userId: gone.id }).expect(404);
      const existing = await openDirect(t, withHistory, gone);
      expect(existing.id).toBe(chatId);
      expect(existing.peer).toMatchObject({ isDeleted: true, displayName: 'Deleted account' });
      expect(existing.permissions.canSend).toBe(false);
      const res = await t.api(withHistory).post(`/api/chats/${chatId}/messages`).send({ type: 'text', text: 'hello?', clientId: 'x1' }).expect(403);
      expect(res.body.error.code).toBe('forbidden');
    });

    it('can be opened with a blocked user (sending is gated: 403 blocked)', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      await block(u1, u2);
      const chat = await openDirect(t, u1, u2);
      expect(chat.peer).toMatchObject({ id: u2.id, isBlocked: true });
      expect(chat.permissions).toMatchObject({ canSend: false, canCall: false, canEditInfo: false });
      const res = await t.api(u1).post(`/api/chats/${chat.id}/messages`).send({ type: 'text', text: 'x', clientId: 'b1' }).expect(403);
      expect(res.body.error.code).toBe('blocked');
      // The blocked party can open it and doesn't learn about the block.
      const other = await openDirect(t, u2, u1);
      expect(other.permissions.canSend).toBe(true);
      expect(other.peer!.isBlocked).toBe(false);
    });

    it('reopening a chat deleted for me unhides it with the history still cleared', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const chatId = await activeDirect(t, u1, u2);
      await sendOk(t, u2, chatId, 'old');
      await t.api(u1).delete(`/api/chats/${chatId}`).expect(204);
      await t.api(u1).get(`/api/chats/${chatId}`).expect(404);
      const reopened = await openDirect(t, u1, u2);
      expect(reopened).toMatchObject({ id: chatId, lastMessage: null, unreadCount: 0 });
      expect(await historyOf(t, u1, chatId)).toEqual([]);
      expect((await historyOf(t, u2, chatId)).map((m) => m.text)).toEqual(['hi', 'old']);
    });
  });

  describe('GET /chats, GET /chats/:chatId', () => {
    it('lists archived and left chats, excludes deleted ones, newest activity first; 404 without a visible row', async () => {
      const u = await t.createUser();
      const other = await t.createUser();
      const third = await t.createUser();
      const g1 = await createGroup(alice, [u], { name: 'Left group' });
      const d1 = await activeDirect(t, u, other);
      const d2 = await activeDirect(t, third, u);
      const g2 = await createGroup(alice, [u], { name: 'Archived' });
      await leaveGroup(g1, u);
      await t.api(u).patch(`/api/chats/${g2}/prefs`).send({ isArchived: true }).expect(200);
      await t.api(u).delete(`/api/chats/${d2}`).expect(204);
      await sendOk(t, other, d1, 'newest');

      const list = (await t.api(u).get('/api/chats').expect(200)).body as ChatSummary[];
      const ids = list.map((c) => c.id);
      expect(ids).toContain(g1);
      expect(ids).toContain(g2);
      expect(ids).not.toContain(d2);
      expect(ids[0]).toBe(d1);
      expect(list.find((c) => c.id === g1)).toMatchObject({ membership: 'left', permissions: { canSend: false } });
      expect(list.find((c) => c.id === g2)).toMatchObject({ isArchived: true, membership: 'active' });
      const sorted = [...list].sort((a, b) => (a.lastActivityAt < b.lastActivityAt ? 1 : -1));
      expect(list.map((c) => c.id)).toEqual(sorted.map((c) => c.id));

      expect((await summaryOf(t, u, g1)).name).toBe('Left group');
      await t.api(carol).get(`/api/chats/${g1}`).expect(404);
      await t.api(u).get(`/api/chats/${d2}`).expect(404);
      await t.api(u).get('/api/chats/not-a-uuid').expect(400);
      await t.api().get('/api/chats').expect(401);
    });
  });

  describe('PATCH /chats/:chatId/prefs', () => {
    it('pins at most MAX_PINNED_CHATS chats (409 limit_reached), emits chat:upsert to me', async () => {
      const u = await t.createUser();
      const groups = [];
      for (let i = 0; i < 4; i++) groups.push(await createGroup(u, [], { name: `g${i}` }));
      const sock = await t.connect(u);
      const log = recordEvents(sock);
      for (const g of groups.slice(0, 3)) {
        const res = await t.api(u).patch(`/api/chats/${g}/prefs`).send({ isPinned: true }).expect(200);
        expect(res.body.isPinned).toBe(true);
      }
      const over = await t.api(u).patch(`/api/chats/${groups[3]}/prefs`).send({ isPinned: true }).expect(409);
      expect(over.body.error.code).toBe('limit_reached');
      // Re-pinning an already pinned chat is fine.
      await t.api(u).patch(`/api/chats/${groups[0]}/prefs`).send({ isPinned: true }).expect(200);
      await t.api(u).patch(`/api/chats/${groups[0]}/prefs`).send({ isPinned: false }).expect(200);
      await t.api(u).patch(`/api/chats/${groups[3]}/prefs`).send({ isPinned: true }).expect(200);
      await settle();
      const upserts = log.of('chat:upsert');
      expect(upserts.map((p) => p.chat.id)).toEqual([groups[0], groups[1], groups[2], groups[0], groups[0], groups[3]]);
      expect(upserts.at(-1)!.chat.isPinned).toBe(true);
      sock.disconnect();
    });

    it('archives, mutes (until / forever / off) and marks unread without moving the read position', async () => {
      const chatId = await createGroup(alice, [bob]);
      const m = await sendOk(t, alice, chatId, 'hello bob');
      await t.api(bob).post(`/api/chats/${chatId}/read`).send({ seq: m.seq }).expect(204);

      let s = (await t.api(bob).patch(`/api/chats/${chatId}/prefs`).send({ isArchived: true, mutedUntil: MUTE_FOREVER_ISO }).expect(200)).body as ChatSummary;
      expect(s).toMatchObject({ isArchived: true, mutedUntil: MUTE_FOREVER_ISO });
      const until = new Date(Date.now() + 8 * 3600_000).toISOString();
      s = (await t.api(bob).patch(`/api/chats/${chatId}/prefs`).send({ mutedUntil: until }).expect(200)).body;
      expect(s.mutedUntil).toBe(until);
      s = (await t.api(bob).patch(`/api/chats/${chatId}/prefs`).send({ mutedUntil: null, isArchived: false }).expect(200)).body;
      expect(s).toMatchObject({ isArchived: false, mutedUntil: null });

      s = (await t.api(bob).patch(`/api/chats/${chatId}/prefs`).send({ markedUnread: true }).expect(200)).body;
      expect(s).toMatchObject({ markedUnread: true, lastReadSeq: m.seq, unreadCount: 0 });
      // Reading clears it.
      await t.api(bob).post(`/api/chats/${chatId}/read`).send({ seq: m.seq }).expect(204);
      expect((await summaryOf(t, bob, chatId)).markedUnread).toBe(false);
      // Alice's view is unaffected.
      expect(await summaryOf(t, alice, chatId)).toMatchObject({ isArchived: false, mutedUntil: null, markedUnread: false });
    });

    it('validates the body; 404 for non-members; former members may change prefs', async () => {
      const chatId = await createGroup(alice, [bob, carol]);
      await t.api(bob).patch(`/api/chats/${chatId}/prefs`).send({ mutedUntil: 'tomorrow' }).expect(400);
      await t.api(bob).patch(`/api/chats/${chatId}/prefs`).send({ isPinned: 'yes' }).expect(400);
      await t.api(dave).patch(`/api/chats/${chatId}/prefs`).send({ isArchived: true }).expect(404);
      await leaveGroup(chatId, carol);
      const s = (await t.api(carol).patch(`/api/chats/${chatId}/prefs`).send({ isArchived: true }).expect(200)).body as ChatSummary;
      expect(s).toMatchObject({ membership: 'left', isArchived: true });
    });
  });

  describe('POST /chats/:chatId/clear', () => {
    it('clears history for me only, removes my stars in range, emits chat:cleared', async () => {
      const chatId = await createGroup(alice, [bob]);
      const m1 = await sendOk(t, bob, chatId, 'one');
      const m2 = await sendOk(t, bob, chatId, 'two');
      await t.api(alice).put(`/api/messages/${m1.id}/star`).expect(204);
      await t.api(bob).put(`/api/messages/${m1.id}/star`).expect(204);
      const sock = await t.connect(alice);
      const log = recordEvents(sock);
      await t.api(alice).post(`/api/chats/${chatId}/clear`).expect(204);
      await settle();
      expect(log.of('chat:cleared')).toEqual([{ chatId, clearedSeq: m2.seq }]);
      expect(await historyOf(t, alice, chatId)).toEqual([]);
      expect(await summaryOf(t, alice, chatId)).toMatchObject({ lastMessage: null, unreadCount: 0 });
      const stars = await db.select().from(starredMessages).where(eq(starredMessages.messageId, m1.id));
      expect(stars.map((s) => s.userId)).toEqual([bob.id]);
      expect((await historyOf(t, bob, chatId)).map((m) => m.id)).toContain(m1.id);
      // New messages show up again.
      const m3 = await sendOk(t, bob, chatId, 'three');
      expect((await historyOf(t, alice, chatId)).map((m) => m.id)).toEqual([m3.id]);
      expect((await summaryOf(t, alice, chatId)).unreadCount).toBe(1);
      await t.api(dave).post(`/api/chats/${chatId}/clear`).expect(404);
      sock.disconnect();
    });
  });

  describe('DELETE /chats/:chatId', () => {
    it('active group / channel → 409; former group members may delete', async () => {
      const g = await createGroup(alice, [bob]);
      const r1 = await t.api(bob).delete(`/api/chats/${g}`).expect(409);
      expect(r1.body.error.code).toBe('conflict');
      const ch = await createChannel(alice);
      await follow(ch, [bob]);
      await t.api(bob).delete(`/api/chats/${ch}`).expect(409);
      const { announcementChatId } = await createCommunity(alice);
      await t.api(alice).delete(`/api/chats/${announcementChatId}`).expect(409);

      await t.api(bob).patch(`/api/chats/${g}/prefs`).send({ isPinned: true }).expect(200);
      await leaveGroup(g, bob);
      await t.api(bob).delete(`/api/chats/${g}`).expect(204);
      const row = await memberOf(g, bob);
      expect(row).toMatchObject({ hidden: true, isPinned: false, markedUnread: false });
      const list = (await t.api(bob).get('/api/chats').expect(200)).body as ChatSummary[];
      expect(list.map((c) => c.id)).not.toContain(g);
      await t.api(bob).get(`/api/chats/${g}/messages`).expect(404);
    });

    it('direct chat: leaves the room, chat:removed; a new message unhides it without the old history', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const chatId = await activeDirect(t, u1, u2);
      const old = await sendOk(t, u2, chatId, 'old');
      await t.api(u1).put(`/api/messages/${old.id}/star`).expect(204);
      await t.api(u1).patch(`/api/chats/${chatId}/prefs`).send({ isPinned: true, markedUnread: true }).expect(200);
      const s1 = await t.connect(u1);
      const s2 = await t.connect(u2);
      const log = recordEvents(s1);
      await t.api(u1).delete(`/api/chats/${chatId}`).expect(204);
      await settle();
      expect(log.of('chat:removed')).toEqual([{ chatId }]);
      await t.api(u1).delete(`/api/chats/${chatId}`).expect(404);
      expect(await db.select().from(starredMessages).where(eq(starredMessages.userId, u1.id))).toEqual([]);

      // Out of the room: typing/edits of the peer don't reach me.
      log.clear();
      s2.emit('chat:typing', { chatId, state: 'typing' });
      await t.api(u2).patch(`/api/messages/${old.id}`).send({ text: 'old (edited)' }).expect(200);
      await settle();
      expect(log.log).toEqual([]);

      const fresh = await sendOk(t, u2, chatId, 'are you there?');
      await settle();
      const names = log.names();
      expect(names.slice(0, 2)).toEqual(['chat:upsert', 'message:new']);
      const upsert = log.of('chat:upsert')[0]!.chat;
      expect(upsert).toMatchObject({ id: chatId, isPinned: false, markedUnread: false, unreadCount: 1, lastMessage: { id: fresh.id } });
      expect((await historyOf(t, u1, chatId)).map((m) => m.id)).toEqual([fresh.id]);
      s1.disconnect();
      s2.disconnect();
    });
  });

  describe('PUT /chats/:chatId/disappearing', () => {
    it('direct chat: system message then chat:updated to the room; new messages expire; no-op when unchanged', async () => {
      const u1 = await t.createUser();
      const u2 = await t.createUser();
      const chatId = await activeDirect(t, u1, u2);
      const s2 = await t.connect(u2);
      const log = recordEvents(s2);
      const res = await t.api(u2).put(`/api/chats/${chatId}/disappearing`).send({ seconds: 604_800 }).expect(200);
      expect((res.body as ChatSummary).disappearingSeconds).toBe(604_800);
      await settle();
      const relevant = log.log.filter((e) => e.event === 'message:new' || e.event === 'chat:updated');
      expect(relevant.map((e) => e.event)).toEqual(['message:new', 'chat:updated']);
      expect(relevant[0]!.payload.message.system).toEqual({ kind: 'disappearing_changed', actorId: u2.id, seconds: 604_800 });
      expect(relevant[0]!.payload.message.expiresAt).toBeNull();
      expect(relevant[1]!.payload).toEqual({ chatId, changes: { disappearingSeconds: 604_800 } });

      const m = await sendOk(t, u1, chatId, 'vanishing');
      expect(Date.parse(m.expiresAt!) - Date.parse(m.createdAt)).toBe(604_800_000);

      log.clear();
      await t.api(u1).put(`/api/chats/${chatId}/disappearing`).send({ seconds: 604_800 }).expect(200);
      await settle();
      expect(log.log.filter((e) => e.event === 'chat:updated' || e.event === 'message:new')).toEqual([]);

      const off = await t.api(u1).put(`/api/chats/${chatId}/disappearing`).send({ seconds: null }).expect(200);
      expect(off.body.disappearingSeconds).toBeNull();
      const last = (await historyOf(t, u1, chatId)).at(-1)!;
      expect(last.system).toEqual({ kind: 'disappearing_changed', actorId: u1.id, seconds: null });
      expect((await sendOk(t, u1, chatId, 'stays')).expiresAt).toBeNull();

      await t.api(u1).put(`/api/chats/${chatId}/disappearing`).send({ seconds: 12_345 }).expect(400);
      await t.api(u1).put(`/api/chats/${chatId}/disappearing`).send({}).expect(400);
      await t.api(dave).put(`/api/chats/${chatId}/disappearing`).send({ seconds: null }).expect(404);
      await block(u1, u2);
      const blocked = await t.api(u1).put(`/api/chats/${chatId}/disappearing`).send({ seconds: 86_400 }).expect(403);
      expect(blocked.body.error.code).toBe('blocked');
      s2.disconnect();
    });

    it('groups follow canEditInfo; channels: admins, no system message; announcement groups and former members → 403', async () => {
      const g = await createGroup(alice, [bob, carol], { settings: { onlyAdminsCanEditInfo: true } });
      const denied = await t.api(bob).put(`/api/chats/${g}/disappearing`).send({ seconds: 86_400 }).expect(403);
      expect(denied.body.error.code).toBe('forbidden');
      await t.api(alice).put(`/api/chats/${g}/disappearing`).send({ seconds: 86_400 }).expect(200);
      await leaveGroup(g, carol);
      const former = await t.api(carol).put(`/api/chats/${g}/disappearing`).send({ seconds: null }).expect(403);
      expect(former.body.error.code).toBe('not_member');

      const ch = await createChannel(alice);
      await follow(ch, [bob]);
      await t.api(bob).put(`/api/chats/${ch}/disappearing`).send({ seconds: 86_400 }).expect(403);
      const bobSock = await t.connect(bob);
      const log = recordEvents(bobSock);
      await t.api(alice).put(`/api/chats/${ch}/disappearing`).send({ seconds: 86_400 }).expect(200);
      await settle();
      expect(log.of('chat:updated')).toEqual([{ chatId: ch, changes: { disappearingSeconds: 86_400 } }]);
      expect(log.of('message:new')).toEqual([]);
      expect((await historyOf(t, alice, ch)).some((m) => m.system?.kind === 'disappearing_changed')).toBe(false);

      const { announcementChatId } = await createCommunity(alice);
      await t.api(alice).put(`/api/chats/${announcementChatId}/disappearing`).send({ seconds: 86_400 }).expect(403);
      bobSock.disconnect();
    });
  });

  describe('GET /chats/:chatId/members', () => {
    it('lists active members (owner, admins, members) with viewer-specific users', async () => {
      const g = await createGroup(alice, [bob, carol, dave], { admins: [carol] });
      await leaveGroup(g, dave);
      const res = await t.api(bob).get(`/api/chats/${g}/members`).expect(200);
      const members = res.body as ChatMember[];
      expect(members.map((m) => [m.user.id, m.role])).toEqual([
        [alice.id, 'owner'],
        [carol.id, 'admin'],
        [bob.id, 'member'],
      ]);
      expect(members[0]!.user).toMatchObject({ displayName: 'Alice', isContact: false });
      expect(typeof members[0]!.joinedAt).toBe('string');
      const former = await t.api(dave).get(`/api/chats/${g}/members`).expect(403);
      expect(former.body.error.code).toBe('not_member');
      const stranger = await t.createUser();
      await t.api(stranger).get(`/api/chats/${g}/members`).expect(404);
    });

    it('channels and announcement groups: admins only; direct chats: both', async () => {
      const ch = await createChannel(alice, { admins: [carol] });
      await follow(ch, [bob]);
      const denied = await t.api(bob).get(`/api/chats/${ch}/members`).expect(403);
      expect(denied.body.error.code).toBe('forbidden');
      const list = (await t.api(carol).get(`/api/chats/${ch}/members`).expect(200)).body as ChatMember[];
      expect(list.map((m) => m.role)).toEqual(['owner', 'admin', 'member']);

      const { announcementChatId } = await createCommunity(alice);
      await follow(announcementChatId, [bob]);
      await t.api(bob).get(`/api/chats/${announcementChatId}/members`).expect(403);
      expect((await t.api(alice).get(`/api/chats/${announcementChatId}/members`).expect(200)).body).toHaveLength(2);

      const d = await openDirect(t, alice, dave);
      const both = (await t.api(alice).get(`/api/chats/${d.id}/members`).expect(200)).body as ChatMember[];
      expect(both.map((m) => m.user.id).sort()).toEqual([alice.id, dave.id].sort());
    });
  });

  describe('GET /chats/:chatId/media', () => {
    it('media / docs / voice / links, newest first with a seq cursor, visible and not deleted', async () => {
      const g = await createGroup(alice, [bob]);
      const img = await sendOk(t, alice, g, { type: 'image', mediaId: (await mkMedia(alice.id, 'image')).id, text: 'see https://example.com' });
      const vid = await sendOk(t, bob, g, { type: 'video', mediaId: (await mkMedia(bob.id, 'video')).id });
      const file = await sendOk(t, alice, g, { type: 'file', mediaId: (await mkMedia(alice.id, 'file')).id });
      const audio = await sendOk(t, alice, g, { type: 'audio', mediaId: (await mkMedia(alice.id, 'audio')).id });
      const voice = await sendOk(t, bob, g, { type: 'voice', mediaId: (await mkMedia(bob.id, 'voice')).id });
      const link = await sendOk(t, alice, g, 'read www.enbox.dev/docs today');
      await sendOk(t, alice, g, 'no links here');
      const gone = await sendOk(t, alice, g, { type: 'image', mediaId: (await mkMedia(alice.id, 'image')).id });
      await t.api(alice).delete(`/api/messages/${gone.id}?for=everyone`).expect(204);
      const hidden = await sendOk(t, alice, g, { type: 'image', mediaId: (await mkMedia(alice.id, 'image')).id });
      await t.api(bob).delete(`/api/messages/${hidden.id}?for=me`).expect(204);

      const get = async (q: string) => ((await t.api(bob).get(`/api/chats/${g}/media${q}`).expect(200)).body as Message[]).map((m) => m.id);
      expect(await get('')).toEqual([vid.id, img.id]);
      expect(await get('?kind=media&limit=1')).toEqual([vid.id]);
      expect(await get(`?kind=media&before=${vid.seq}`)).toEqual([img.id]);
      expect(await get('?kind=docs')).toEqual([audio.id, file.id]);
      expect(await get('?kind=voice')).toEqual([voice.id]);
      expect(await get('?kind=links')).toEqual([link.id, img.id]);
      const full = (await t.api(bob).get(`/api/chats/${g}/media?kind=voice`).expect(200)).body as Message[];
      expect(full[0]).toMatchObject({ type: 'voice', media: { kind: 'voice' }, starred: false });
      await t.api(bob).get(`/api/chats/${g}/media?kind=photos`).expect(400);

      // A member who joined later sees nothing from before.
      await addToGroup(g, alice, [carol]);
      expect(((await t.api(carol).get(`/api/chats/${g}/media`).expect(200)).body as Message[])).toEqual([]);
      await t.api(dave).get(`/api/chats/${g}/media`).expect(404);
    });
  });

  describe('pins', () => {
    it('pin: system message then chat:pins; the oldest pin is replaced beyond MAX_PINNED_MESSAGES', async () => {
      const g = await createGroup(alice, [bob]);
      const ms: Message[] = [];
      for (let i = 1; i <= 4; i++) ms.push(await sendOk(t, bob, g, `m${i}`));
      const bobSock = await t.connect(bob);
      const log = recordEvents(bobSock);
      const res = await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: ms[0]!.id }).expect(200);
      expect((res.body as Message[]).map((m) => m.id)).toEqual([ms[0]!.id]);
      await settle();
      const seq = log.log.filter((e) => e.event === 'message:new' || e.event === 'chat:pins');
      expect(seq.map((e) => e.event)).toEqual(['message:new', 'chat:pins']);
      expect(seq[0]!.payload.message.system).toEqual({ kind: 'message_pinned', actorId: alice.id, messageId: ms[0]!.id });
      expect(seq[1]!.payload).toEqual({ chatId: g, messageIds: [ms[0]!.id] });

      await t.api(bob).post(`/api/chats/${g}/pins`).send({ messageId: ms[1]!.id }).expect(200);
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: ms[2]!.id }).expect(200);
      const full = await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: ms[3]!.id }).expect(200);
      expect((full.body as Message[]).map((m) => m.text)).toEqual(['m2', 'm3', 'm4']);
      await settle();
      expect(log.of('chat:pins').at(-1)!.messageIds).toEqual([ms[1]!.id, ms[2]!.id, ms[3]!.id]);

      // Already pinned: no-op, no events.
      log.clear();
      const same = await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: ms[3]!.id }).expect(200);
      expect((same.body as Message[]).map((m) => m.text)).toEqual(['m2', 'm3', 'm4']);
      await settle();
      expect(log.log).toEqual([]);

      // Unpin → chat:pins; unpinning something not pinned is a no-op.
      const after = await t.api(bob).delete(`/api/chats/${g}/pins/${ms[2]!.id}`).expect(200);
      expect((after.body as Message[]).map((m) => m.text)).toEqual(['m2', 'm4']);
      await settle();
      expect(log.of('chat:pins')).toEqual([{ chatId: g, messageIds: [ms[1]!.id, ms[3]!.id] }]);
      await t.api(bob).delete(`/api/chats/${g}/pins/${ms[2]!.id}`).expect(200);
      expect(((await t.api(bob).get(`/api/chats/${g}/pins`).expect(200)).body as Message[]).map((m) => m.text)).toEqual(['m2', 'm4']);
      bobSock.disconnect();
    });

    it('validates the target: same chat, visible, not system/call/deleted', async () => {
      const g = await createGroup(alice, [bob]);
      const other = await createGroup(alice, []);
      const foreign = await sendOk(t, alice, other, 'elsewhere');
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: foreign.id }).expect(404);
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: crypto.randomUUID() }).expect(404);
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: 'x' }).expect(400);
      const sys = (await historyOf(t, alice, g)).find((m) => m.type === 'system')!;
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: sys.id }).expect(400);
      const del = await sendOk(t, alice, g, 'bye');
      await t.api(alice).delete(`/api/messages/${del.id}?for=everyone`).expect(204);
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: del.id }).expect(400);
      const hidden = await sendOk(t, alice, g, 'hidden for bob');
      await t.api(bob).delete(`/api/messages/${hidden.id}?for=me`).expect(204);
      await t.api(bob).post(`/api/chats/${g}/pins`).send({ messageId: hidden.id }).expect(404);
    });

    it('permissions: canPin in groups; channels admins only without a system message; former members → 403', async () => {
      const g = await createGroup(alice, [bob, carol], { settings: { onlyAdminsCanEditInfo: true } });
      const m = await sendOk(t, bob, g, 'pin me');
      const denied = await t.api(bob).post(`/api/chats/${g}/pins`).send({ messageId: m.id }).expect(403);
      expect(denied.body.error.code).toBe('forbidden');
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: m.id }).expect(200);
      await t.api(bob).delete(`/api/chats/${g}/pins/${m.id}`).expect(403);
      await leaveGroup(g, carol);
      const former = await t.api(carol).get(`/api/chats/${g}/pins`).expect(403);
      expect(former.body.error.code).toBe('not_member');
      await t.api(dave).get(`/api/chats/${g}/pins`).expect(404);

      const ch = await createChannel(alice);
      await follow(ch, [bob]);
      const post = await sendOk(t, alice, ch, 'announcement');
      await t.api(bob).post(`/api/chats/${ch}/pins`).send({ messageId: post.id }).expect(403);
      const bobSock = await t.connect(bob);
      const log = recordEvents(bobSock);
      await t.api(alice).post(`/api/chats/${ch}/pins`).send({ messageId: post.id }).expect(200);
      await settle();
      expect(log.of('message:new')).toEqual([]);
      expect(log.of('chat:pins')).toEqual([{ chatId: ch, messageIds: [post.id] }]);
      const pins = (await t.api(bob).get(`/api/chats/${ch}/pins`).expect(200)).body as Message[];
      expect(pins.map((p) => [p.id, p.senderId])).toEqual([[post.id, null]]);

      // Direct chats: both sides may pin (with a system message).
      const d = await activeDirect(t, carol, dave);
      const dm = (await historyOf(t, dave, d))[0]!;
      await t.api(dave).post(`/api/chats/${d}/pins`).send({ messageId: dm.id }).expect(200);
      expect((await historyOf(t, carol, d)).at(-1)!.system).toMatchObject({ kind: 'message_pinned', actorId: dave.id });
      bobSock.disconnect();
    });

    it('pins are filtered by the viewer’s visibility', async () => {
      const g = await createGroup(alice, [bob]);
      const early = await sendOk(t, alice, g, 'before carol');
      await t.api(alice).post(`/api/chats/${g}/pins`).send({ messageId: early.id }).expect(200);
      await addToGroup(g, alice, [carol]);
      expect((await t.api(carol).get(`/api/chats/${g}/pins`).expect(200)).body).toEqual([]);
      expect(((await t.api(bob).get(`/api/chats/${g}/pins`).expect(200)).body as Message[]).map((m) => m.id)).toEqual([early.id]);
      const rows = await db.select().from(chatMembers).where(and(eq(chatMembers.chatId, g), eq(chatMembers.userId, carol.id)));
      expect(rows).toHaveLength(1);
    });
  });
});
