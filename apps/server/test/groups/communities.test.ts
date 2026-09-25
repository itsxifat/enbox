import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq, sql } from 'drizzle-orm';
import { ANNOUNCEMENT_GROUP_SETTINGS, MAX_COMMUNITY_GROUPS, MAX_GROUP_MEMBERS, type Community, type CommunityMember } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, chats, communities, communityMembers } from '../../src/db/schema.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createChannel, createGroup, memberRow, recordEvents, send, setSettings, settle } from '../services/fixtures.js';
import { bulkCommunityJoin, bulkUsers, connectAll, expectError, summary, systemKinds, uploadImage } from './util.js';

describe('communities module', () => {
  let t: TestServer;
  let owner: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    owner = await t.createUser({ displayName: 'Owner' });
  });
  afterAll(() => t.close());

  const makeUsers = (n: number) => Promise.all(Array.from({ length: n }, () => t.createUser()));
  const api = (u: TestUser) => t.api(u);

  async function createCommunity(by: TestUser, groupIds: string[] = [], name = 'Neighbours'): Promise<Community> {
    return (await api(by).post('/api/communities').send({ name, groupIds }).expect(201)).body as Community;
  }
  async function communityMemberIds(communityId: string) {
    const rows = await db.select().from(communityMembers).where(eq(communityMembers.communityId, communityId));
    return rows.map((r) => r.userId).sort();
  }
  async function activeIn(chatId: string) {
    const rows = await db.select().from(chatMembers).where(eq(chatMembers.chatId, chatId));
    return rows.filter((r) => !r.leftAt).map((r) => r.userId).sort();
  }
  /** Invariant: active announcement members = community members ⊇ active members of every linked group. */
  async function expectInvariant(communityId: string) {
    const [c] = await db.select().from(communities).where(eq(communities.id, communityId));
    const members = await communityMemberIds(communityId);
    expect(await activeIn(c!.announcementChatId!)).toEqual(members);
    const linked = await db.select().from(chats).where(and(eq(chats.communityId, communityId), eq(chats.isAnnouncement, false)));
    for (const g of linked) for (const u of await activeIn(g.id)) expect(members).toContain(u);
  }

  describe('POST /communities', () => {
    it('creates the community + announcement group and links the initial groups (cascading their members)', async () => {
      const [m1] = await makeUsers(1);
      const g1 = await createGroup(owner, [m1!], { name: 'G1' });
      const conns = await connectAll(t, owner, m1!);
      const [ownerRec, m1Rec] = conns.sockets.map((s) => recordEvents(s));
      const c = await createCommunity(owner, [g1]);
      expect(c).toMatchObject({ name: 'Neighbours', description: null, createdBy: owner.id, myRole: 'owner', memberCount: 2 });
      expect(c.inviteCode).toMatch(/^[A-Za-z0-9]{22}$/);
      expect(c.groups.map((g) => [g.chatId, g.isAnnouncement, g.isMember, g.memberCount])).toEqual([
        [c.announcementChatId, true, true, 2],
        [g1, false, true, 2],
      ]);
      const ann = (await summary(owner, c.announcementChatId))!;
      expect(ann).toMatchObject({ type: 'group', isAnnouncement: true, communityId: c.id, name: 'Neighbours', myRole: 'owner', inviteCode: null, groupSettings: ANNOUNCEMENT_GROUP_SETTINGS });
      expect(ann.permissions).toMatchObject({ canSend: true, canEditInfo: false, canAddMembers: false, canLeave: false, canViewMembers: true });
      expect(ann.lastMessage?.system).toEqual({ kind: 'community_created', actorId: owner.id, name: 'Neighbours' });
      const annM1 = (await summary(m1!, c.announcementChatId))!;
      expect(annM1).toMatchObject({ myRole: 'member', membership: 'active', permissions: { canSend: false, canViewMembers: false } });
      expect(await systemKinds(g1)).toEqual(['group_created', 'members_added', 'added_to_community']);
      expect((await summary(m1!, g1))!.communityId).toBe(c.id);
      await expectInvariant(c.id);

      await settle();
      const o = ownerRec!.log.filter((e) => ['chat:upsert', 'message:new', 'chat:updated', 'community:upsert'].includes(e.event));
      expect(o.map((e) => e.event)).toEqual(['chat:upsert', 'message:new', 'community:upsert', 'message:new', 'chat:updated', 'chat:updated', 'community:upsert']);
      expect(o[1]!.payload.message.system.kind).toBe('community_created');
      expect(o[3]!.payload.message.system.kind).toBe('added_to_community');
      expect(o[4]!.payload).toEqual({ chatId: g1, changes: { communityId: c.id } });
      const m = m1Rec!.log.filter((e) => ['chat:upsert', 'message:new', 'chat:updated', 'community:upsert', 'chat:members-changed'].includes(e.event));
      expect(m.map((e) => e.event)).toEqual(['message:new', 'chat:updated', 'chat:upsert', 'chat:updated', 'community:upsert']);
      expect(m[2]!.payload.chat).toMatchObject({ id: c.announcementChatId, isAnnouncement: true });
      expect(m[3]!.payload).toEqual({ chatId: c.announcementChatId, changes: { memberCount: 2 } });
      expect(m[4]!.payload.community).toMatchObject({ id: c.id, myRole: 'member', inviteCode: null });
      expect(ownerRec!.of('chat:members-changed').map((p) => p.chatId)).toContain(c.announcementChatId);
      await conns.close();
    });

    it('linking requires admin rights on each group and an unlinked regular group', async () => {
      const [member, outsider] = await makeUsers(2);
      const memberOf = await createGroup(member!, [owner]);
      const notIn = await createGroup(outsider!, []);
      const channel = await createChannel(owner);
      const linked = await createGroup(owner, []);
      const other = await createCommunity(owner, [linked], 'Other');
      expectError(await api(owner).post('/api/communities').send({ name: 'X', groupIds: [memberOf] }), 403, 'forbidden');
      expectError(await api(owner).post('/api/communities').send({ name: 'X', groupIds: [notIn] }), 404, 'not_found');
      expectError(await api(owner).post('/api/communities').send({ name: 'X', groupIds: [channel] }), 404, 'not_found');
      expectError(await api(owner).post('/api/communities').send({ name: 'X', groupIds: [linked] }), 409, 'conflict');
      expectError(await api(owner).post('/api/communities').send({ name: 'X', groupIds: [other.announcementChatId] }), 409, 'conflict');
      expectError(await api(owner).post('/api/communities').send({ name: 'X', groupIds: [crypto.randomUUID()] }), 404, 'not_found');
      expectError(await api(owner).post('/api/communities').send({ name: '' }), 400, 'validation_error');
      // Nothing was created by the failed attempts (single transaction).
      const mine = await api(owner).get('/api/communities').expect(200);
      expect((mine.body as Community[]).filter((c) => c.name === 'X')).toEqual([]);
    });
  });

  describe('GET /communities[/:id]', () => {
    it('lists my communities; 404 for non-members; invite code only for owner/admins', async () => {
      const [member, outsider] = await makeUsers(2);
      const g = await createGroup(owner, [member!]);
      const c = await createCommunity(owner, [g], 'Readable');
      const list = (await api(member!).get('/api/communities').expect(200)).body as Community[];
      expect(list.map((x) => x.id)).toEqual([c.id]);
      expect(list[0]).toMatchObject({ myRole: 'member', inviteCode: null, memberCount: 2 });
      expect((await api(owner).get(`/api/communities/${c.id}`).expect(200)).body.inviteCode).toBe(c.inviteCode);
      expectError(await api(outsider!).get(`/api/communities/${c.id}`), 404, 'not_found');
      expect((await api(outsider!).get('/api/communities').expect(200)).body).toEqual([]);
      expectError(await api(owner).get('/api/communities/nope'), 400, 'validation_error');
    });
  });

  describe('route permissions', () => {
    it('outsiders and former members get 404 everywhere; plain members get 403 on admin/owner routes', async () => {
      const [member, outsider, leaver, target] = await makeUsers(4);
      const g = await createGroup(owner, [member!]);
      const c = await createCommunity(owner, [g], 'Guarded');
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [leaver!.id, target!.id] }).expect(200);
      await api(leaver!).post(`/api/communities/${c.id}/leave`).expect(204);
      const base = `/api/communities/${c.id}`;
      const routes = [
        ['get', '', undefined, 'member'],
        ['patch', '', { name: 'x' }, 'admin'],
        ['delete', '', undefined, 'owner'],
        ['post', '/groups', { name: 'x' }, 'admin'],
        ['post', '/groups/link', { chatIds: [g] }, 'admin'],
        ['delete', `/groups/${g}`, undefined, 'admin'],
        ['post', `/groups/${g}/join`, undefined, 'member'],
        ['get', '/members', undefined, 'admin'],
        ['post', '/members', { userIds: [outsider!.id] }, 'admin'],
        ['delete', `/members/${target!.id}`, undefined, 'admin'],
        ['put', `/members/${target!.id}/role`, { role: 'admin' }, 'admin'],
        ['post', '/transfer-ownership', { userId: target!.id }, 'owner'],
        ['post', '/leave', undefined, 'member'],
        ['get', '/invite', undefined, 'admin'],
        ['post', '/invite/reset', undefined, 'admin'],
      ] as const;
      for (const [method, path, body, level] of routes) {
        for (const who of [outsider!, leaver!]) {
          const req = api(who)[method](`${base}${path}`);
          expectError(body ? await req.send(body) : await req, 404, 'not_found');
        }
        if (level !== 'member') {
          const req = api(member!)[method](`${base}${path}`);
          expectError(body ? await req.send(body) : await req, 403, 'forbidden');
        }
      }
      expectError(await api(owner).get(`/api/communities/${crypto.randomUUID()}`), 404, 'not_found');
      // The member is still in (nothing above changed state).
      expect(await communityMemberIds(c.id)).toContain(member!.id);
      await expectInvariant(c.id);
    });
  });

  describe('PATCH /communities/:id', () => {
    it('owner/admins only; mirrors into the announcement group with per-field messages; community:upsert to members', async () => {
      const [member] = await makeUsers(1);
      const g = await createGroup(owner, [member!]);
      const c = await createCommunity(owner, [g], 'Before');
      expectError(await api(member!).patch(`/api/communities/${c.id}`).send({ name: 'Nope' }), 403, 'forbidden');
      const conns = await connectAll(t, member!);
      const rec = recordEvents(conns.sockets[0]!);
      const res = await api(owner).patch(`/api/communities/${c.id}`).send({ name: 'After', description: 'Street news' }).expect(200);
      expect(res.body).toMatchObject({ name: 'After', description: 'Street news' });
      await settle();
      const r = rec.log.filter((e) => ['message:new', 'chat:updated', 'community:upsert'].includes(e.event));
      expect(r.map((e) => (e.event === 'message:new' ? e.payload.message.system.kind : e.event))).toEqual([
        'name_changed',
        'description_changed',
        'chat:updated',
        'community:upsert',
      ]);
      expect(r[0]!.payload.message.chatId).toBe(c.announcementChatId);
      expect(r[2]!.payload).toEqual({ chatId: c.announcementChatId, changes: { name: 'After', description: 'Street news' } });
      expect(r[3]!.payload.community).toMatchObject({ name: 'After', myRole: 'member' });
      expect((await summary(member!, c.announcementChatId))!.name).toBe('After');

      // Avatar changes are mirrored too; other people's uploads are rejected.
      const avatar = await uploadImage(t, owner);
      const withAvatar = (await api(owner).patch(`/api/communities/${c.id}`).send({ avatarMediaId: avatar }).expect(200)).body as Community;
      expect(withAvatar.avatarUrl).toMatch(/^\/uploads\//);
      expect((await summary(member!, c.announcementChatId))!.avatarUrl).toBe(withAvatar.avatarUrl);
      expectError(await api(owner).patch(`/api/communities/${c.id}`).send({ avatarMediaId: await uploadImage(t, member!) }), 404, 'not_found');
      await conns.close();
    });
  });

  describe('groups inside a community', () => {
    it('POST /communities/:id/groups creates a linked group; its members join the community', async () => {
      const [admin, member, outsider] = await makeUsers(3);
      const c = await createCommunity(owner);
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [admin!.id, member!.id] }).expect(200);
      await api(owner).put(`/api/communities/${c.id}/members/${admin!.id}/role`).send({ role: 'admin' }).expect(204);
      expectError(await api(member!).post(`/api/communities/${c.id}/groups`).send({ name: 'Nope' }), 403, 'forbidden');
      expectError(await api(outsider!).post(`/api/communities/${c.id}/groups`).send({ name: 'Nope' }), 404, 'not_found');

      const conns = await connectAll(t, outsider!, member!);
      const [outRec, memberRec] = conns.sockets.map((s) => recordEvents(s));
      const res = await api(admin!).post(`/api/communities/${c.id}/groups`).send({ name: 'Linked', memberIds: [outsider!.id] }).expect(201);
      expect(res.body.added).toEqual([outsider!.id]);
      expect(res.body.chat).toMatchObject({ communityId: c.id, myRole: 'owner', name: 'Linked', isAnnouncement: false });
      const groupId = res.body.chat.id as string;
      await settle();
      const o = outRec!.log.filter((e) => ['chat:upsert', 'message:new', 'chat:updated', 'community:upsert'].includes(e.event));
      expect(o.map((e) => (e.event === 'chat:upsert' ? `upsert:${e.payload.chat.id === groupId ? 'g' : 'ann'}` : e.event))).toEqual([
        'upsert:g',
        'message:new',
        'message:new',
        'upsert:ann',
        'chat:updated',
        'community:upsert',
      ]);
      const upserted = o.at(-1)!.payload.community as Community;
      expect(upserted.groups.find((g) => g.chatId === groupId)).toMatchObject({ isMember: true, memberCount: 2 });
      // Existing members learn about the new group.
      const mc = memberRec!.of('community:upsert').at(-1)!.community;
      expect(mc.groups.find((g) => g.chatId === groupId)).toMatchObject({ isMember: false });
      await expectInvariant(c.id);
      await conns.close();
    });

    it('link / unlink: system messages, communityId changes, cascade on link; nobody leaves on unlink', async () => {
      const [member, stranger] = await makeUsers(2);
      const c = await createCommunity(owner);
      const g = await createGroup(owner, [stranger!], { name: 'Late' });
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [member!.id] }).expect(200);
      expectError(await api(member!).post(`/api/communities/${c.id}/groups/link`).send({ chatIds: [g] }), 403, 'forbidden');
      const linked = (await api(owner).post(`/api/communities/${c.id}/groups/link`).send({ chatIds: [g] }).expect(200)).body as Community;
      expect(linked.groups.map((x) => x.chatId)).toEqual([c.announcementChatId, g]);
      expect(linked.memberCount).toBe(3);
      expect(await communityMemberIds(c.id)).toContain(stranger!.id);
      expectError(await api(owner).post(`/api/communities/${c.id}/groups/link`).send({ chatIds: [g] }), 409, 'conflict');

      const conns = await connectAll(t, stranger!);
      const rec = recordEvents(conns.sockets[0]!);
      expectError(await api(member!).delete(`/api/communities/${c.id}/groups/${g}`), 403, 'forbidden');
      expectError(await api(owner).delete(`/api/communities/${c.id}/groups/${c.announcementChatId}`), 403, 'forbidden');
      expectError(await api(owner).delete(`/api/communities/${c.id}/groups/${crypto.randomUUID()}`), 404, 'not_found');
      const after = (await api(owner).delete(`/api/communities/${c.id}/groups/${g}`).expect(200)).body as Community;
      expect(after.groups.map((x) => x.chatId)).toEqual([c.announcementChatId]);
      await settle();
      const r = rec.log.filter((e) => ['message:new', 'chat:updated', 'community:upsert'].includes(e.event));
      expect(r.map((e) => e.event)).toEqual(['message:new', 'chat:updated', 'community:upsert']);
      expect(r[0]!.payload.message.system).toEqual({ kind: 'removed_from_community', actorId: owner.id, communityId: c.id, communityName: c.name });
      expect(r[1]!.payload).toEqual({ chatId: g, changes: { communityId: null } });
      expect(await communityMemberIds(c.id)).toContain(stranger!.id); // unlinking removes nobody
      expect((await summary(stranger!, g))!.communityId).toBeNull();
      await conns.close();
    });

    it('POST /communities/:id/groups/:c/join: community members join linked groups (not if removed by an admin)', async () => {
      const [member, kicked, outsider] = await makeUsers(3);
      const g = await createGroup(owner, [kicked!]);
      const c = await createCommunity(owner, [g]);
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [member!.id] }).expect(200);
      expectError(await api(outsider!).post(`/api/communities/${c.id}/groups/${g}/join`), 404, 'not_found');

      const conns = await connectAll(t, member!);
      const rec = recordEvents(conns.sockets[0]!);
      const res = await api(member!).post(`/api/communities/${c.id}/groups/${g}/join`).expect(200);
      expect(res.body).toMatchObject({ id: g, membership: 'active', communityId: c.id, memberCount: 3 });
      await settle();
      const r = rec.log.filter((e) => ['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed', 'community:upsert'].includes(e.event));
      expect(r.map((e) => e.event)).toEqual(['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed', 'community:upsert']);
      expect(r[1]!.payload.message.system).toEqual({ kind: 'member_joined', actorId: member!.id });
      expect((r[4]!.payload.community as Community).groups.find((x) => x.chatId === g)!.isMember).toBe(true);
      expectError(await api(member!).post(`/api/communities/${c.id}/groups/${g}/join`), 409, 'conflict');
      expectError(await api(member!).post(`/api/communities/${c.id}/groups/${c.announcementChatId}/join`), 409, 'conflict');

      await api(owner).delete(`/api/groups/${g}/members/${kicked!.id}`).expect(204);
      expectError(await api(kicked!).post(`/api/communities/${c.id}/groups/${g}/join`), 403, 'forbidden');
      await api(member!).post(`/api/groups/${g}/leave`).expect(204);
      await api(member!).post(`/api/communities/${c.id}/groups/${g}/join`).expect(200); // left ≠ removed
      await conns.close();
    });

    it('invariant: adding a non-member to a linked group makes them a community member', async () => {
      const [newbie] = await makeUsers(1);
      const g = await createGroup(owner, []);
      const c = await createCommunity(owner, [g]);
      const conns = await connectAll(t, newbie!);
      const rec = recordEvents(conns.sockets[0]!);
      await api(owner).post(`/api/groups/${g}/members`).send({ userIds: [newbie!.id] }).expect(200);
      await settle();
      expect(await communityMemberIds(c.id)).toContain(newbie!.id);
      await expectInvariant(c.id);
      const names = rec.log
        .filter((e) => ['chat:upsert', 'message:new', 'community:upsert'].includes(e.event))
        .map((e) => (e.event === 'chat:upsert' ? `upsert:${e.payload.chat.id === g ? 'g' : 'ann'}` : e.event));
      expect(names).toEqual(['upsert:g', 'message:new', 'upsert:ann', 'community:upsert']);
      // Removing them from the group keeps them in the community.
      await api(owner).delete(`/api/groups/${g}/members/${newbie!.id}`).expect(204);
      expect(await communityMemberIds(c.id)).toContain(newbie!.id);
      await conns.close();
    });

    it('limits: MAX_COMMUNITY_GROUPS linked groups; community capacity on cascades', async () => {
      const c = await createCommunity(owner);
      await db.execute(
        sql`insert into chats (type, name, group_settings, community_id)
            select 'group', 'filler ' || g, '{"onlyAdminsCanSend":false,"onlyAdminsCanEditInfo":false,"onlyAdminsCanAddMembers":false}'::jsonb, ${c.id}
            from generate_series(1, ${MAX_COMMUNITY_GROUPS}) g`,
      );
      expectError(await api(owner).post(`/api/communities/${c.id}/groups`).send({ name: 'One too many' }), 409, 'limit_reached');
      const g = await createGroup(owner, []);
      expectError(await api(owner).post(`/api/communities/${c.id}/groups/link`).send({ chatIds: [g] }), 409, 'limit_reached');

      const [extra, extra2] = await makeUsers(2);
      const g2 = await createGroup(owner, []);
      const c2 = await createCommunity(owner, [g2], 'Full');
      await bulkCommunityJoin(c2.id, c2.announcementChatId, await bulkUsers(MAX_GROUP_MEMBERS - 1));
      expectError(await api(owner).post(`/api/groups/${g2}/members`).send({ userIds: [extra!.id] }), 409, 'limit_reached');
      const add = await api(owner).post(`/api/communities/${c2.id}/members`).send({ userIds: [extra!.id, extra2!.id] }).expect(200);
      expect(add.body).toMatchObject({ added: [], failed: [{ userId: extra!.id, reason: 'limit_reached' }, { userId: extra2!.id, reason: 'limit_reached' }] });
    });
  });

  describe('members', () => {
    it('GET members: owner/admins only, owner first', async () => {
      const [admin, member, outsider] = await makeUsers(3);
      const c = await createCommunity(owner);
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [member!.id, admin!.id] }).expect(200);
      await api(owner).put(`/api/communities/${c.id}/members/${admin!.id}/role`).send({ role: 'admin' }).expect(204);
      const list = (await api(admin!).get(`/api/communities/${c.id}/members`).expect(200)).body as CommunityMember[];
      expect(list.map((m) => [m.user.id, m.role])).toEqual([
        [owner.id, 'owner'],
        [admin!.id, 'admin'],
        [member!.id, 'member'],
      ]);
      expect(list[0]!.user.displayName).toBe('Owner');
      expectError(await api(member!).get(`/api/communities/${c.id}/members`), 403, 'forbidden');
      expectError(await api(outsider!).get(`/api/communities/${c.id}/members`), 404, 'not_found');
    });

    it('POST members: add rules (needsInvite, already_member, not_found) and the matrix events', async () => {
      const [a, shy, existing] = await makeUsers(3);
      await setSettings(shy!, { groupsAddPermission: 'nobody' });
      const c = await createCommunity(owner);
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [existing!.id] }).expect(200);
      expectError(await api(existing!).post(`/api/communities/${c.id}/members`).send({ userIds: [a!.id] }), 403, 'forbidden');
      const conns = await connectAll(t, a!, existing!);
      const [aRec, existingRec] = conns.sockets.map((s) => recordEvents(s));
      const unknown = crypto.randomUUID();
      const res = await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [a!.id, shy!.id, existing!.id, unknown] }).expect(200);
      expect(res.body).toMatchObject({
        added: [a!.id],
        needsInvite: [shy!.id],
        failed: [
          { userId: existing!.id, reason: 'already_member' },
          { userId: unknown, reason: 'not_found' },
        ],
      });
      expect(res.body.community).toMatchObject({ id: c.id, memberCount: 3, myRole: 'owner' });
      await settle();
      const r = aRec!.log.filter((e) => ['chat:upsert', 'message:new', 'chat:updated', 'community:upsert', 'chat:members-changed'].includes(e.event));
      expect(r.map((e) => e.event)).toEqual(['chat:upsert', 'community:upsert', 'chat:updated']);
      expect(r[0]!.payload.chat).toMatchObject({ id: c.announcementChatId, lastMessage: null, unreadCount: 0 });
      expect(r[2]!.payload).toEqual({ chatId: c.announcementChatId, changes: { memberCount: 3 } });
      // members-changed of announcement groups goes to admins only
      expect(existingRec!.of('chat:members-changed')).toEqual([]);
      expect(existingRec!.of('chat:updated')).toEqual([{ chatId: c.announcementChatId, changes: { memberCount: 3 } }]);
      await expectInvariant(c.id);
      await conns.close();
    });

    it('DELETE member: cascades out of every linked group and the announcement group; removed users cannot rejoin themselves', async () => {
      const [admin, victim, other] = await makeUsers(3);
      const g1 = await createGroup(owner, [victim!, other!], { name: 'G1' });
      const g2 = await createGroup(owner, [victim!], { name: 'G2' });
      const g3 = await createGroup(owner, [other!], { name: 'G3' });
      const c = await createCommunity(owner, [g1, g2, g3]);
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [admin!.id] }).expect(200);
      await api(owner).put(`/api/communities/${c.id}/members/${admin!.id}/role`).send({ role: 'admin' }).expect(204);
      expectError(await api(other!).delete(`/api/communities/${c.id}/members/${victim!.id}`), 403, 'forbidden');
      expectError(await api(admin!).delete(`/api/communities/${c.id}/members/${owner.id}`), 403, 'forbidden');
      expectError(await api(admin!).delete(`/api/communities/${c.id}/members/${admin!.id}`), 400, 'validation_error');

      const conns = await connectAll(t, victim!, other!);
      const [vRec, oRec] = conns.sockets.map((s) => recordEvents(s));
      await api(admin!).delete(`/api/communities/${c.id}/members/${victim!.id}`).expect(204);
      await settle();
      const v = vRec!.log
        .filter((e) => ['chat:upsert', 'message:new', 'chat:removed', 'community:removed', 'chat:updated'].includes(e.event))
        .map((e) => {
          if (e.event === 'message:new') return `new:${e.payload.message.chatId === g1 ? 'g1' : 'g2'}:${e.payload.message.system.kind}`;
          if (e.event === 'chat:upsert') return `upsert:${e.payload.chat.id === g1 ? 'g1' : 'g2'}:${e.payload.chat.membership}`;
          if (e.event === 'chat:removed') return `removed:${e.payload.chatId === c.announcementChatId ? 'ann' : '?'}`;
          return e.event;
        });
      expect(v).toEqual(['new:g1:member_removed', 'upsert:g1:removed', 'new:g2:member_removed', 'upsert:g2:removed', 'removed:ann', 'community:removed']);
      expect(oRec!.of('chat:updated')).toEqual(
        expect.arrayContaining([
          { chatId: g1, changes: { memberCount: 2 } },
          { chatId: c.announcementChatId, changes: { memberCount: 3 } },
        ]),
      );
      expect(await communityMemberIds(c.id)).not.toContain(victim!.id);
      expect(await memberRow(c.announcementChatId, victim!)).toMatchObject({ hidden: true, leftReason: 'removed' });
      expect(await summary(victim!, c.announcementChatId)).toBeNull();
      expect((await summary(victim!, g1))!.membership).toBe('removed');
      await expectInvariant(c.id);

      // Removed users cannot rejoin themselves: community link or any linked group's link.
      const communityCode = (await api(owner).get(`/api/communities/${c.id}/invite`).expect(200)).body.code;
      const g3Code = (await api(owner).get(`/api/groups/${g3}/invite`).expect(200)).body.code;
      expectError(await api(victim!).post(`/api/invites/${communityCode}/join`), 403, 'forbidden');
      expectError(await api(victim!).post(`/api/invites/${g3Code}/join`), 403, 'forbidden');
      expect((await api(victim!).get(`/api/invites/${g3Code}`).expect(200)).body).toMatchObject({ canJoin: false, reason: 'You were removed by an admin' });
      expectError(await api(victim!).get(`/api/communities/${c.id}`), 404, 'not_found');
      // An admin add lifts it.
      await api(admin!).post(`/api/communities/${c.id}/members`).send({ userIds: [victim!.id] }).expect(200);
      expect((await summary(victim!, c.announcementChatId))!.membership).toBe('active');
      await api(victim!).post(`/api/invites/${g3Code}/join`).expect(200);
      await expectInvariant(c.id);
      await conns.close();
    });
  });

  describe('roles, ownership, leave', () => {
    it('roles mirror into the announcement group (admins can post); owner cannot be demoted', async () => {
      const [member, member2] = await makeUsers(2);
      const c = await createCommunity(owner);
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [member!.id, member2!.id] }).expect(200);
      expectError(await api(member2!).put(`/api/communities/${c.id}/members/${member!.id}/role`).send({ role: 'admin' }), 403, 'forbidden');
      const conns = await connectAll(t, member!);
      const rec = recordEvents(conns.sockets[0]!);
      await api(owner).put(`/api/communities/${c.id}/members/${member!.id}/role`).send({ role: 'admin' }).expect(204);
      await settle();
      const r = rec.log.filter((e) => ['community:upsert', 'chat:upsert', 'chat:members-changed', 'message:new'].includes(e.event));
      expect(r.map((e) => e.event)).toEqual(['community:upsert', 'chat:upsert', 'chat:members-changed']);
      expect(r[0]!.payload.community).toMatchObject({ myRole: 'admin', inviteCode: c.inviteCode });
      expect(r[1]!.payload.chat).toMatchObject({ id: c.announcementChatId, myRole: 'admin', permissions: { canSend: true, canViewMembers: true } });
      expect((await memberRow(c.announcementChatId, member!)).role).toBe('admin');
      expectError(await api(member!).put(`/api/communities/${c.id}/members/${owner.id}/role`).send({ role: 'member' }), 403, 'forbidden');
      // Admins manage other members' roles.
      await api(member!).put(`/api/communities/${c.id}/members/${member2!.id}/role`).send({ role: 'admin' }).expect(204);
      await api(owner).put(`/api/communities/${c.id}/members/${member!.id}/role`).send({ role: 'member' }).expect(204);
      expect((await memberRow(c.announcementChatId, member!)).role).toBe('member');
      expectError(await api(owner).put(`/api/communities/${c.id}/members/${crypto.randomUUID()}/role`).send({ role: 'admin' }), 404, 'not_found');
      await conns.close();
    });

    it('transfer-ownership: owner only, target must be a member; mirrored into the announcement group', async () => {
      const [member, outsider] = await makeUsers(2);
      const c = await createCommunity(owner);
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [member!.id] }).expect(200);
      expectError(await api(member!).post(`/api/communities/${c.id}/transfer-ownership`).send({ userId: member!.id }), 403, 'forbidden');
      expectError(await api(owner).post(`/api/communities/${c.id}/transfer-ownership`).send({ userId: outsider!.id }), 404, 'not_found');
      const conns = await connectAll(t, member!);
      const rec = recordEvents(conns.sockets[0]!);
      await api(owner).post(`/api/communities/${c.id}/transfer-ownership`).send({ userId: member!.id }).expect(204);
      await settle();
      expect(rec.names().filter((n) => ['community:upsert', 'chat:upsert'].includes(n))).toEqual(['community:upsert', 'chat:upsert']);
      expect((await api(member!).get(`/api/communities/${c.id}`).expect(200)).body.myRole).toBe('owner');
      expect((await api(owner).get(`/api/communities/${c.id}`).expect(200)).body.myRole).toBe('admin');
      expect((await memberRow(c.announcementChatId, member!)).role).toBe('owner');
      expect((await memberRow(c.announcementChatId, owner)).role).toBe('admin');
      await api(member!).delete(`/api/communities/${c.id}`).expect(204);
      await conns.close();
    });

    it('owner leaves: out of every group, succession to the oldest admin (mirrored), community:upsert + chat:upsert(ann) → new owner', async () => {
      const [boss, admin1, admin2, member] = await makeUsers(4);
      const g = await createGroup(boss!, [member!]);
      const c = await createCommunity(boss!, [g]);
      await api(boss!).post(`/api/communities/${c.id}/members`).send({ userIds: [admin1!.id, admin2!.id] }).expect(200);
      await api(boss!).put(`/api/communities/${c.id}/members/${admin2!.id}/role`).send({ role: 'admin' }).expect(204);
      await api(boss!).put(`/api/communities/${c.id}/members/${admin1!.id}/role`).send({ role: 'admin' }).expect(204);
      await db
        .update(communityMembers)
        .set({ joinedAt: new Date(Date.now() - 60_000) })
        .where(and(eq(communityMembers.communityId, c.id), eq(communityMembers.userId, admin1!.id)));

      const conns = await connectAll(t, boss!, admin1!, member!);
      const [bossRec, a1Rec, memberRec] = conns.sockets.map((s) => recordEvents(s));
      await api(boss!).post(`/api/communities/${c.id}/leave`).expect(204);
      await settle();
      const b = bossRec!.log
        .filter((e) => ['message:new', 'chat:upsert', 'chat:removed', 'community:removed'].includes(e.event))
        .map((e) => (e.event === 'message:new' ? e.payload.message.system.kind : e.event));
      // owner_changed in the group is outside the leaver's window.
      expect(b).toEqual(['member_left', 'chat:upsert', 'chat:removed', 'community:removed']);
      const a1 = a1Rec!.log.filter((e) => ['community:upsert', 'chat:upsert'].includes(e.event));
      expect(a1.map((e) => e.event)).toEqual(['community:upsert', 'chat:upsert']);
      expect(a1[0]!.payload.community.myRole).toBe('owner');
      expect(a1[1]!.payload.chat).toMatchObject({ id: c.announcementChatId, myRole: 'owner' });
      // The group had its own succession (boss owned it): member became its owner.
      expect(memberRec!.of('message:new').map((p) => p.message.system?.kind)).toEqual(['member_left', 'owner_changed']);
      expect((await summary(member!, g))!.myRole).toBe('owner');
      expect((await memberRow(c.announcementChatId, admin1!)).role).toBe('owner');
      await expectInvariant(c.id);
      expectError(await api(boss!).post(`/api/communities/${c.id}/leave`), 404, 'not_found');
      await conns.close();
    });

    it('the last member leaving deactivates the community', async () => {
      const solo = await t.createUser();
      const g = await createGroup(solo, []);
      const c = await createCommunity(solo, [g]);
      await api(solo).post(`/api/communities/${c.id}/leave`).expect(204);
      expect(await db.select().from(communities).where(eq(communities.id, c.id))).toEqual([]);
      expect(await db.select().from(chats).where(eq(chats.id, c.announcementChatId))).toEqual([]);
      const [group] = await db.select().from(chats).where(eq(chats.id, g));
      expect(group!.communityId).toBeNull();
      expect((await systemKinds(g)).slice(-2)).toEqual(['member_left', 'removed_from_community']);
    });
  });

  describe('DELETE /communities/:id (deactivation)', () => {
    it('owner only; groups unlinked with a message; announcement group deleted; community:removed to every member', async () => {
      const [admin, member] = await makeUsers(2);
      const g = await createGroup(owner, [member!]);
      const c = await createCommunity(owner, [g], 'Doomed');
      await send(owner, c.announcementChatId, 'announcement');
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [admin!.id] }).expect(200);
      await api(owner).put(`/api/communities/${c.id}/members/${admin!.id}/role`).send({ role: 'admin' }).expect(204);
      expectError(await api(admin!).delete(`/api/communities/${c.id}`), 403, 'forbidden');

      const conns = await connectAll(t, member!, admin!);
      const [memberRec, adminRec] = conns.sockets.map((s) => recordEvents(s));
      await api(owner).delete(`/api/communities/${c.id}`).expect(204);
      await settle();
      const m = memberRec!.log
        .filter((e) => ['message:new', 'chat:updated', 'chat:removed', 'community:removed'].includes(e.event))
        .map((e) => (e.event === 'message:new' ? e.payload.message.system.kind : e.event));
      expect(m).toEqual(['removed_from_community', 'chat:updated', 'chat:removed', 'community:removed']);
      expect(memberRec!.of('chat:removed')).toEqual([{ chatId: c.announcementChatId }]);
      expect(adminRec!.of('chat:removed')).toEqual([{ chatId: c.announcementChatId }]);
      expect(adminRec!.of('community:removed')).toEqual([{ communityId: c.id }]);
      expect(await db.select().from(chats).where(eq(chats.id, c.announcementChatId))).toEqual([]);
      expect((await summary(member!, g))!.communityId).toBeNull();
      expectError(await api(owner).get(`/api/communities/${c.id}`), 404, 'not_found');
      expectError(await api(owner).get(`/api/invites/${c.inviteCode}`), 404, 'not_found');

      // Rooms were cleared: later announcement-room emits reach nobody (the chat is gone anyway).
      memberRec!.clear();
      await send(owner, g, 'group lives on');
      await settle();
      expect(memberRec!.of('message:new')).toHaveLength(1);
      await conns.close();
    });
  });

  describe('invite link', () => {
    it('owner/admins see and reset it; reset → community:upsert to owner/admins only', async () => {
      const [admin, member] = await makeUsers(2);
      const c = await createCommunity(owner);
      await api(owner).post(`/api/communities/${c.id}/members`).send({ userIds: [admin!.id, member!.id] }).expect(200);
      await api(owner).put(`/api/communities/${c.id}/members/${admin!.id}/role`).send({ role: 'admin' }).expect(204);
      expect((await api(admin!).get(`/api/communities/${c.id}/invite`).expect(200)).body).toEqual({ code: c.inviteCode });
      expectError(await api(member!).get(`/api/communities/${c.id}/invite`), 403, 'forbidden');
      expectError(await api(member!).post(`/api/communities/${c.id}/invite/reset`), 403, 'forbidden');

      const conns = await connectAll(t, admin!, member!);
      const [adminRec, memberRec] = conns.sockets.map((s) => recordEvents(s));
      const { body } = await api(admin!).post(`/api/communities/${c.id}/invite/reset`).expect(200);
      expect(body.code).not.toBe(c.inviteCode);
      await settle();
      expect(adminRec!.of('community:upsert').map((p) => p.community.inviteCode)).toEqual([body.code]);
      expect(memberRec!.of('community:upsert')).toEqual([]);
      expectError(await api(member!).get(`/api/invites/${c.inviteCode}`), 404, 'not_found');
      await conns.close();
    });
  });
});
