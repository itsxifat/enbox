import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import type { ChannelDirectoryEntry, ChannelPreview, ChatSummary } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, chats, messageReactions } from '../../src/db/schema.js';
import { loadMessagePage } from '../../src/services/messages.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createDirect, createGroup, memberRow, recordEvents, send, settle } from '../services/fixtures.js';
import { connectAll, expectError, summary, systemKinds, uploadImage } from './util.js';

describe('channels module', () => {
  let t: TestServer;
  let owner: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    owner = await t.createUser({ displayName: 'Owner' });
  });
  afterAll(() => t.close());

  const makeUsers = (n: number) => Promise.all(Array.from({ length: n }, () => t.createUser()));
  const api = (u: TestUser) => t.api(u);
  const token = () => Math.random().toString(36).slice(2, 8);

  async function createChannel(by: TestUser, body: Record<string, unknown> = {}): Promise<ChatSummary> {
    return (await api(by).post('/api/channels').send({ name: 'News', ...body }).expect(201)).body as ChatSummary;
  }
  const follow = (u: TestUser, chatId: string) => api(u).put(`/api/channels/${chatId}/follow`).expect(200);

  describe('POST /channels', () => {
    it('creates the channel with the owner as its only follower and a channel_created message', async () => {
      const conns = await connectAll(t, owner);
      const rec = recordEvents(conns.sockets[0]!);
      const ch = await createChannel(owner, { name: 'Daily', description: 'News daily', isPublic: false, reactions: 'quick' });
      expect(ch).toMatchObject({
        type: 'channel',
        name: 'Daily',
        description: 'News daily',
        myRole: 'owner',
        membership: 'active',
        memberCount: 1,
        channelSettings: { isPublic: false, reactions: 'quick' },
        groupSettings: null,
        readWatermark: 0,
        deliveredWatermark: 0,
      });
      expect(ch.inviteCode).toMatch(/^[A-Za-z0-9]{22}$/);
      expect(ch.permissions).toMatchObject({ canSend: true, canEditInfo: true, canManageAdmins: true, canInvite: true, canLeave: false, canViewMembers: true, canCall: false });
      await settle();
      const r = rec.log.filter((e) => ['chat:upsert', 'message:new'].includes(e.event));
      expect(r.map((e) => e.event)).toEqual(['chat:upsert', 'message:new']);
      expect(r[1]!.payload.message).toMatchObject({ senderId: null, system: { kind: 'channel_created', actorId: owner.id, name: 'Daily' } });
      const defaults = await createChannel(owner);
      expect(defaults.channelSettings).toEqual({ isPublic: true, reactions: 'all' });
      expectError(await api(owner).post('/api/channels').send({ name: 'X', reactions: 'some' }), 400, 'validation_error');
      expectError(await api(owner).post('/api/channels').send({ name: '' }), 400, 'validation_error');
      await conns.close();
    });
  });

  describe('route permissions', () => {
    it('private channel: outsiders get 404 everywhere; followers 403 on admin routes; admins 403 on owner routes', async () => {
      const [follower, admin, outsider] = await makeUsers(3);
      const ch = await createChannel(owner, { name: 'Guarded', isPublic: false });
      for (const u of [follower!, admin!]) await api(u).post(`/api/invites/${ch.inviteCode}/join`).expect(200);
      await api(owner).put(`/api/channels/${ch.id}/admins/${admin!.id}`).expect(204);
      const base = `/api/channels/${ch.id}`;
      const routes = [
        ['get', '', undefined, 'follower'],
        ['patch', '', { name: 'x' }, 'admin'],
        ['delete', '', undefined, 'owner'],
        ['put', '/follow', undefined, 'follower'],
        ['delete', '/follow', undefined, 'follower'],
        ['put', `/admins/${follower!.id}`, undefined, 'owner'],
        ['delete', `/admins/${admin!.id}`, undefined, 'owner'],
        ['get', '/invite', undefined, 'admin'],
        ['post', '/invite/reset', undefined, 'admin'],
        ['post', '/transfer-ownership', { userId: admin!.id }, 'owner'],
      ] as const;
      for (const [method, path, body, level] of routes) {
        const out = api(outsider!)[method](`${base}${path}`);
        expectError(body ? await out.send(body) : await out, 404, 'not_found');
        if (level === 'admin' || level === 'owner') {
          const f = api(follower!)[method](`${base}${path}`);
          expectError(body ? await f.send(body) : await f, 403, 'forbidden');
        }
        if (level === 'owner') {
          const a = api(admin!)[method](`${base}${path}`);
          expectError(body ? await a.send(body) : await a, 403, 'forbidden');
        }
      }
      expect((await summary(follower!, ch.id))!.permissions).toMatchObject({ canViewMembers: false, canSend: false, canPin: false, canDeleteForEveryoneAsAdmin: false });
      expect((await summary(admin!, ch.id))!.permissions).toMatchObject({ canViewMembers: true, canSend: true, canManageAdmins: false });
    });
  });

  describe('GET /channels/discover', () => {
    it('lists public channels only, searching name/description case-insensitively (escaping LIKE wildcards)', async () => {
      const k = token();
      const [f1, f2] = await makeUsers(2);
      const a = await createChannel(owner, { name: `${k} Cooking Tips` });
      const b = await createChannel(owner, { name: `Daily ${k} cooking` });
      const c = await createChannel(owner, { name: 'Gardening', description: `all about ${k.toUpperCase()} COOKING soil` });
      await createChannel(owner, { name: `${k} Secret cooking`, isPublic: false });
      const pct = await createChannel(owner, { name: `${k} 100% juice` });
      await follow(f1!, b.id);
      await follow(f2!, b.id);
      await follow(f1!, c.id);

      const res = await api(f1!).get('/api/channels/discover').query({ q: `${k} cook` }).expect(200);
      expect((res.body as ChannelDirectoryEntry[]).map((e) => e.id)).toEqual([b.id, c.id, a.id]); // name or description, any case; never private
      const tips = await api(f1!).get('/api/channels/discover').query({ q: `${k} COOKING tips` }).expect(200);
      expect((tips.body as ChannelDirectoryEntry[]).map((e) => e.id)).toEqual([a.id]);
      const res2 = await api(f1!).get('/api/channels/discover').query({ q: k }).expect(200);
      const list = res2.body as ChannelDirectoryEntry[];
      expect(list.map((e) => e.id)).toEqual([b.id, c.id, pct.id, a.id]); // followers desc, then newest
      expect(list[0]).toMatchObject({ name: `Daily ${k} cooking`, followerCount: 3, isFollowing: true, isPublic: true, avatarUrl: null, description: null });
      expect(list[1]).toMatchObject({ followerCount: 2, isFollowing: true });
      expect(list[3]).toMatchObject({ followerCount: 1, isFollowing: false });
      expect(typeof list[0]!.createdAt).toBe('string');

      const pctRes = await api(f1!).get('/api/channels/discover').query({ q: '100%' }).expect(200);
      expect((pctRes.body as ChannelDirectoryEntry[]).map((e) => e.id)).toEqual([pct.id]);
      const none = await api(f1!).get('/api/channels/discover').query({ q: `${k}_` }).expect(200);
      expect(none.body).toEqual([]);
      const limited = await api(f1!).get('/api/channels/discover').query({ q: k, limit: 2 }).expect(200);
      expect(limited.body).toHaveLength(2);
      const all = await api(f1!).get('/api/channels/discover').query({ q: '' }).expect(200);
      expect((all.body as ChannelDirectoryEntry[]).every((e) => e.isPublic)).toBe(true);
      expectError(await api(f1!).get('/api/channels/discover').query({ limit: 0 }), 400, 'validation_error');
    });
  });

  describe('GET /channels/:chatId (preview)', () => {
    it('public: anyone sees the entry + latest posts with the channel identity (no senderId, anonymous reactions)', async () => {
      const [follower, outsider] = await makeUsers(2);
      const ch = await createChannel(owner, { name: 'Previewable' });
      await follow(follower!, ch.id);
      const post = await send(owner, ch.id, 'first post');
      await db.insert(messageReactions).values({ messageId: post.message.id, userId: follower!.id, emoji: '👍' });
      const res = await api(outsider!).get(`/api/channels/${ch.id}`).expect(200);
      const body = res.body as ChannelPreview;
      expect(body.channel).toMatchObject({ id: ch.id, name: 'Previewable', followerCount: 2, isFollowing: false, isPublic: true });
      expect(body.messages.map((m) => m.system?.kind ?? m.text)).toEqual(['channel_created', 'first post']);
      expect(body.messages[1]).toMatchObject({ senderId: null, reactions: [{ emoji: '👍', count: 1, userIds: [] }] });
      const mine = (await api(follower!).get(`/api/channels/${ch.id}`).expect(200)).body as ChannelPreview;
      expect(mine.channel.isFollowing).toBe(true);
      expect(mine.messages[1]).toMatchObject({ myReaction: '👍', senderId: null });
    });

    it('private: 404 to non-followers, visible to followers; non-channels and unknown ids → 404', async () => {
      const [follower, outsider] = await makeUsers(2);
      const ch = await createChannel(owner, { name: 'Hidden', isPublic: false });
      expectError(await api(outsider!).get(`/api/channels/${ch.id}`), 404, 'not_found');
      const code = (await api(owner).get(`/api/channels/${ch.id}/invite`).expect(200)).body.code;
      await api(follower!).post(`/api/invites/${code}/join`).expect(200);
      expect((await api(follower!).get(`/api/channels/${ch.id}`).expect(200)).body.channel).toMatchObject({ isPublic: false, isFollowing: true });
      const group = await createGroup(owner, []);
      const direct = await createDirect(owner, outsider!);
      expectError(await api(owner).get(`/api/channels/${group}`), 404, 'not_found');
      expectError(await api(owner).get(`/api/channels/${direct}`), 404, 'not_found');
      expectError(await api(owner).get(`/api/channels/${crypto.randomUUID()}`), 404, 'not_found');
    });
  });

  describe('follow / unfollow', () => {
    it('follow: JOIN(me) with full history and no backlog; memberCount → room; members-changed → admins only', async () => {
      const [early, late] = await makeUsers(2);
      const ch = await createChannel(owner, { name: 'Followable' });
      await follow(early!, ch.id);
      await send(owner, ch.id, 'p1');
      await send(owner, ch.id, 'p2');
      const conns = await connectAll(t, owner, early!, late!);
      const [ownerRec, earlyRec, lateRec] = conns.sockets.map((s) => recordEvents(s));
      const res = await follow(late!, ch.id);
      expect(res.body).toMatchObject({ id: ch.id, membership: 'active', myRole: 'member', memberCount: 3, unreadCount: 0, lastReadSeq: res.body.lastSeq });
      expect(res.body.permissions).toMatchObject({ canSend: false, canViewMembers: false, canLeave: true, canInvite: false, canEditInfo: false });
      expect(res.body.inviteCode).toBeNull();
      await settle();
      expect(lateRec!.names().filter((n) => n !== 'presence:update')).toEqual(['chat:upsert', 'chat:updated']);
      expect(ownerRec!.names().filter((n) => ['chat:updated', 'chat:members-changed'].includes(n))).toEqual(['chat:updated', 'chat:members-changed']);
      expect(earlyRec!.names().filter((n) => ['chat:updated', 'chat:members-changed'].includes(n))).toEqual(['chat:updated']);
      expect(ownerRec!.of('chat:updated')[0]).toEqual({ chatId: ch.id, changes: { memberCount: 3 } });
      const page = await loadMessagePage(db, late!.id, ch.id, { limit: 50 });
      expect(page.messages.map((m) => m.system?.kind ?? m.text)).toEqual(['channel_created', 'p1', 'p2']);
      expect(Number((await memberRow(ch.id, late!)).joinedSeq)).toBe(0);

      // New posts reach followers with the channel identity.
      lateRec!.clear();
      await send(owner, ch.id, 'p3');
      await settle();
      expect(lateRec!.of('message:new').map((p) => [p.message.text, p.message.senderId])).toEqual([['p3', null]]);

      // Following again is idempotent (no events).
      lateRec!.clear();
      ownerRec!.clear();
      await follow(late!, ch.id);
      await settle();
      expect(lateRec!.names().filter((n) => n !== 'presence:update')).toEqual([]);
      expect(ownerRec!.of('chat:updated')).toEqual([]);
      await conns.close();
    });

    it('private channels cannot be followed by id; unfollow deletes the row; the owner gets 409', async () => {
      const [follower, stranger] = await makeUsers(2);
      const priv = await createChannel(owner, { name: 'Private', isPublic: false });
      expectError(await api(stranger!).put(`/api/channels/${priv.id}/follow`), 404, 'not_found');
      const group = await createGroup(owner, [stranger!]);
      expectError(await api(stranger!).put(`/api/channels/${group}/follow`), 404, 'not_found');

      const ch = await createChannel(owner, { name: 'Leavable' });
      await follow(follower!, ch.id);
      const conns = await connectAll(t, owner, follower!);
      const [ownerRec, followerRec] = conns.sockets.map((s) => recordEvents(s));
      await api(follower!).delete(`/api/channels/${ch.id}/follow`).expect(204);
      await settle();
      expect(followerRec!.names().filter((n) => n !== 'presence:update')).toEqual(['chat:removed']);
      expect(followerRec!.of('chat:removed')).toEqual([{ chatId: ch.id }]);
      expect(ownerRec!.names().filter((n) => ['chat:updated', 'chat:members-changed'].includes(n))).toEqual(['chat:updated', 'chat:members-changed']);
      expect(await db.select().from(chatMembers).where(and(eq(chatMembers.chatId, ch.id), eq(chatMembers.userId, follower!.id)))).toEqual([]);
      expect(await summary(follower!, ch.id)).toBeNull();
      followerRec!.clear();
      await send(owner, ch.id, 'after unfollow');
      await settle();
      expect(followerRec!.of('message:new')).toEqual([]);

      expectError(await api(follower!).delete(`/api/channels/${ch.id}/follow`), 404, 'not_found');
      expectError(await api(owner).delete(`/api/channels/${ch.id}/follow`), 409, 'conflict');
      await conns.close();
    });
  });

  describe('PATCH /channels/:chatId', () => {
    it('admins only; per-field system messages; settings changes only emit chat:updated', async () => {
      const [follower, outsider] = await makeUsers(2);
      const ch = await createChannel(owner, { name: 'Editable' });
      await follow(follower!, ch.id);
      expectError(await api(follower!).patch(`/api/channels/${ch.id}`).send({ name: 'Mine' }), 403, 'forbidden');
      expectError(await api(outsider!).patch(`/api/channels/${ch.id}`).send({ name: 'Mine' }), 404, 'not_found');
      const avatar = await uploadImage(t, owner);
      const conns = await connectAll(t, follower!);
      const rec = recordEvents(conns.sockets[0]!);
      const res = await api(owner).patch(`/api/channels/${ch.id}`).send({ name: 'Edited', description: 'Desc', avatarMediaId: avatar, reactions: 'none' }).expect(200);
      expect(res.body).toMatchObject({ name: 'Edited', description: 'Desc', channelSettings: { isPublic: true, reactions: 'none' } });
      await settle();
      const r = rec.log.filter((e) => ['message:new', 'chat:updated'].includes(e.event));
      expect(r.map((e) => (e.event === 'message:new' ? e.payload.message.system.kind : e.event))).toEqual(['name_changed', 'description_changed', 'avatar_changed', 'chat:updated']);
      expect(r[3]!.payload.changes).toEqual({ name: 'Edited', description: 'Desc', avatarUrl: res.body.avatarUrl, channelSettings: { isPublic: true, reactions: 'none' } });

      rec.clear();
      await api(owner).patch(`/api/channels/${ch.id}`).send({ isPublic: false }).expect(200);
      await settle();
      expect(rec.log.filter((e) => ['message:new', 'chat:updated'].includes(e.event)).map((e) => e.event)).toEqual(['chat:updated']);
      expect(rec.of('chat:updated')[0]!.changes).toEqual({ channelSettings: { isPublic: false, reactions: 'none' } });
      expect(await systemKinds(ch.id)).toEqual(['channel_created', 'name_changed', 'description_changed', 'avatar_changed']);
      // Now private: gone from discovery, 404 for outsiders; followers keep it.
      expect(((await api(outsider!).get('/api/channels/discover').query({ q: 'Edited' }).expect(200)).body as ChannelDirectoryEntry[]).map((e) => e.id)).not.toContain(ch.id);
      expectError(await api(outsider!).get(`/api/channels/${ch.id}`), 404, 'not_found');
      await api(follower!).get(`/api/channels/${ch.id}`).expect(200);
      await conns.close();
    });
  });

  describe('DELETE /channels/:chatId', () => {
    it('owner only: chat:removed to the room, then the channel is gone', async () => {
      const [admin, follower] = await makeUsers(2);
      const ch = await createChannel(owner, { name: 'Doomed' });
      await follow(admin!, ch.id);
      await follow(follower!, ch.id);
      await api(owner).put(`/api/channels/${ch.id}/admins/${admin!.id}`).expect(204);
      expectError(await api(admin!).delete(`/api/channels/${ch.id}`), 403, 'forbidden');
      expectError(await api(follower!).delete(`/api/channels/${ch.id}`), 403, 'forbidden');
      await send(owner, ch.id, 'last post');
      const conns = await connectAll(t, follower!);
      const rec = recordEvents(conns.sockets[0]!);
      await api(owner).delete(`/api/channels/${ch.id}`).expect(204);
      await settle();
      expect(rec.of('chat:removed')).toEqual([{ chatId: ch.id }]);
      expect(await db.select().from(chats).where(eq(chats.id, ch.id))).toEqual([]);
      expectError(await api(follower!).get(`/api/channels/${ch.id}`), 404, 'not_found');
      await conns.close();
    });
  });

  describe('admins, invite, ownership', () => {
    it('owner manages admins (targets must follow); chat:upsert → target; members-changed → admins only', async () => {
      const [target, follower, outsider] = await makeUsers(3);
      const ch = await createChannel(owner, { name: 'Staffed' });
      await follow(target!, ch.id);
      await follow(follower!, ch.id);
      expectError(await api(owner).put(`/api/channels/${ch.id}/admins/${outsider!.id}`), 404, 'not_found');
      expectError(await api(follower!).put(`/api/channels/${ch.id}/admins/${target!.id}`), 403, 'forbidden');
      const conns = await connectAll(t, target!, follower!);
      const [tRec, fRec] = conns.sockets.map((s) => recordEvents(s));
      await api(owner).put(`/api/channels/${ch.id}/admins/${target!.id}`).expect(204);
      await settle();
      expect(tRec!.names().filter((n) => ['chat:upsert', 'chat:members-changed', 'message:new'].includes(n))).toEqual(['chat:upsert', 'chat:members-changed']);
      expect(tRec!.of('chat:upsert')[0]!.chat).toMatchObject({ myRole: 'admin', permissions: { canSend: true, canViewMembers: true, canInvite: true, canManageAdmins: false } });
      expect(fRec!.names().filter((n) => n !== 'presence:update')).toEqual([]); // no system message, nothing to followers
      // Admins cannot manage admins.
      expectError(await api(target!).put(`/api/channels/${ch.id}/admins/${follower!.id}`), 403, 'forbidden');
      await api(owner).delete(`/api/channels/${ch.id}/admins/${target!.id}`).expect(204);
      expect((await memberRow(ch.id, target!)).role).toBe('member');
      expectError(await api(owner).delete(`/api/channels/${ch.id}/admins/${owner.id}`), 400, 'validation_error');
      expect(await systemKinds(ch.id)).toEqual(['channel_created']);
      await conns.close();
    });

    it('invite link: admins only; reset → chat:upsert to each admin', async () => {
      const [admin, follower] = await makeUsers(2);
      const ch = await createChannel(owner, { name: 'Linked' });
      await follow(admin!, ch.id);
      await follow(follower!, ch.id);
      await api(owner).put(`/api/channels/${ch.id}/admins/${admin!.id}`).expect(204);
      expect((await api(admin!).get(`/api/channels/${ch.id}/invite`).expect(200)).body).toEqual({ code: ch.inviteCode });
      expectError(await api(follower!).get(`/api/channels/${ch.id}/invite`), 403, 'forbidden');
      expectError(await api(follower!).post(`/api/channels/${ch.id}/invite/reset`), 403, 'forbidden');
      const conns = await connectAll(t, owner, admin!, follower!);
      const [oRec, aRec, fRec] = conns.sockets.map((s) => recordEvents(s));
      const { body } = await api(admin!).post(`/api/channels/${ch.id}/invite/reset`).expect(200);
      await settle();
      expect(oRec!.of('chat:upsert').map((p) => p.chat.inviteCode)).toEqual([body.code]);
      expect(aRec!.of('chat:upsert').map((p) => p.chat.inviteCode)).toEqual([body.code]);
      expect(fRec!.of('chat:upsert')).toEqual([]);
      expect(fRec!.of('message:new')).toEqual([]);
      expectError(await api(follower!).get(`/api/invites/${ch.inviteCode}`), 404, 'not_found');
      await conns.close();
    });

    it('transfer-ownership: owner → a follower; the old owner becomes admin and may then unfollow', async () => {
      const [heir, follower, outsider] = await makeUsers(3);
      const ch = await createChannel(owner, { name: 'Inherited' });
      await follow(heir!, ch.id);
      await follow(follower!, ch.id);
      expectError(await api(follower!).post(`/api/channels/${ch.id}/transfer-ownership`).send({ userId: heir!.id }), 403, 'forbidden');
      expectError(await api(owner).post(`/api/channels/${ch.id}/transfer-ownership`).send({ userId: outsider!.id }), 404, 'not_found');
      const conns = await connectAll(t, owner, heir!, follower!);
      const [oRec, hRec, fRec] = conns.sockets.map((s) => recordEvents(s));
      await api(owner).post(`/api/channels/${ch.id}/transfer-ownership`).send({ userId: heir!.id }).expect(204);
      await settle();
      expect(oRec!.of('chat:upsert').map((p) => p.chat.myRole)).toEqual(['admin']);
      expect(hRec!.of('chat:upsert').map((p) => p.chat.myRole)).toEqual(['owner']);
      expect(hRec!.names()).toContain('chat:members-changed');
      expect(fRec!.names().filter((n) => n !== 'presence:update')).toEqual([]);
      await api(owner).delete(`/api/channels/${ch.id}/follow`).expect(204);
      await api(heir!).delete(`/api/channels/${ch.id}`).expect(204);
      await conns.close();
    });
  });
});
