import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  MAX_GROUP_MEMBERS,
  type Community,
  type InviteJoinResult,
  type InvitePreview,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { communityMembers } from '../../src/db/schema.js';
import { loadMessagePage } from '../../src/services/messages.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createGroup, memberRow, recordEvents, send, settle } from '../services/fixtures.js';
import {
  bulkCommunityJoin,
  bulkJoin,
  bulkUsers,
  connectAll,
  expectError,
  summary,
  systemKinds,
} from './util.js';

describe('invites module', () => {
  let t: TestServer;
  let owner: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    owner = await t.createUser({ displayName: 'Owner' });
  });
  afterAll(() => t.close());

  const makeUsers = (n: number) => Promise.all(Array.from({ length: n }, () => t.createUser()));
  const api = (u: TestUser) => t.api(u);
  const groupCode = async (chatId: string) =>
    (await api(owner).get(`/api/groups/${chatId}/invite`).expect(200)).body.code as string;
  const preview = async (u: TestUser, code: string) =>
    (await api(u).get(`/api/invites/${code}`).expect(200)).body as InvitePreview;
  const join = (u: TestUser, code: string) => api(u).post(`/api/invites/${code}/join`);

  it('validates codes: malformed → 400, unknown → 404', async () => {
    expectError(await api(owner).get('/api/invites/short'), 400, 'validation_error');
    expectError(await api(owner).get(`/api/invites/${'A'.repeat(21)}0`), 400, 'validation_error'); // 0 is not in the alphabet
    expectError(await api(owner).get(`/api/invites/${'A'.repeat(22)}`), 404, 'not_found');
    expectError(await api(owner).post(`/api/invites/${'A'.repeat(22)}/join`), 404, 'not_found');
    expectError(await t.api().get(`/api/invites/${'A'.repeat(22)}`), 401, 'unauthorized');
  });

  it('invite lookups and joins are rate-limited per IP', async () => {
    const u = await t.createUser();
    config.rateLimit = true;
    try {
      let last = 0;
      for (let i = 0; i < 61; i++)
        last = (await api(u).get(`/api/invites/${'B'.repeat(22)}`)).status;
      expect(last).toBe(429);
      expectError(await api(u).post(`/api/invites/${'B'.repeat(22)}/join`), 429, 'rate_limited');
    } finally {
      config.rateLimit = false;
    }
  });

  describe('groups', () => {
    it('preview: members vs outsiders', async () => {
      const [member, outsider] = await makeUsers(2);
      const chatId = await createGroup(owner, [member!], { name: 'Club' });
      const code = await groupCode(chatId);
      expect(await preview(outsider!, code)).toEqual({
        code,
        kind: 'group',
        id: chatId,
        name: 'Club',
        description: null,
        avatarUrl: null,
        memberCount: 2,
        communityId: null,
        communityName: null,
        isMember: false,
        canJoin: true,
        reason: null,
      });
      expect(await preview(member!, code)).toMatchObject({
        isMember: true,
        canJoin: false,
        reason: null,
      });
    });

    it('join: JOIN(me) then member_joined_via_link; room gets memberCount + members-changed; already a member → 409', async () => {
      const [member, joiner] = await makeUsers(2);
      const chatId = await createGroup(owner, [member!]);
      await send(owner, chatId, 'before the join');
      const code = await groupCode(chatId);
      const conns = await connectAll(t, joiner!, member!);
      const [jRec, mRec] = conns.sockets.map((s) => recordEvents(s));
      const res = await join(joiner!, code).expect(200);
      const body = res.body as InviteJoinResult;
      expect(body).toMatchObject({ kind: 'group', id: chatId, community: null });
      expect(body.chat).toMatchObject({
        id: chatId,
        membership: 'active',
        myRole: 'member',
        memberCount: 3,
      });
      await settle();
      const j = jRec!.log.filter((e) =>
        ['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed'].includes(e.event),
      );
      expect(j.map((e) => e.event)).toEqual([
        'chat:upsert',
        'message:new',
        'chat:updated',
        'chat:members-changed',
      ]);
      expect(j[1]!.payload.message.system).toEqual({
        kind: 'member_joined_via_link',
        actorId: joiner!.id,
      });
      expect(
        mRec!
          .names()
          .filter((n) => ['message:new', 'chat:updated', 'chat:members-changed'].includes(n)),
      ).toEqual(['message:new', 'chat:updated', 'chat:members-changed']);
      const page = await loadMessagePage(db, joiner!.id, chatId, { limit: 50 });
      expect(page.messages.map((m) => m.system?.kind ?? m.text)).toEqual([
        'member_joined_via_link',
      ]);
      expect((await memberRow(chatId, joiner!)).addedBy).toBeNull();
      expectError(await join(joiner!, code), 409, 'conflict');
      await conns.close();
    });

    it('former members: left → may rejoin; removed by an admin → canJoin false + 403', async () => {
      const [leaver, kicked] = await makeUsers(2);
      const chatId = await createGroup(owner, [leaver!, kicked!]);
      const code = await groupCode(chatId);
      await api(leaver!).post(`/api/groups/${chatId}/leave`).expect(204);
      await api(owner).delete(`/api/groups/${chatId}/members/${kicked!.id}`).expect(204);
      expect(await preview(leaver!, code)).toMatchObject({
        isMember: false,
        canJoin: true,
        reason: null,
      });
      expect(await preview(kicked!, code)).toMatchObject({
        isMember: false,
        canJoin: false,
        reason: 'You were removed by an admin',
      });
      await join(leaver!, code).expect(200);
      expectError(await join(kicked!, code), 403, 'forbidden');
      expect((await summary(kicked!, chatId))!.membership).toBe('removed');
    });

    it('full groups: preview reason + 409 limit_reached', async () => {
      const joiner = await t.createUser();
      const chatId = await createGroup(owner, []);
      await bulkJoin(chatId, await bulkUsers(MAX_GROUP_MEMBERS - 1));
      const code = await groupCode(chatId);
      expect(await preview(joiner, code)).toMatchObject({
        canJoin: false,
        reason: 'This group is full',
        memberCount: MAX_GROUP_MEMBERS,
      });
      expectError(await join(joiner, code), 409, 'limit_reached');
    });

    it('joining an emptied group makes the joiner its owner', async () => {
      const [solo, joiner] = await makeUsers(2);
      const res = await api(solo!).post('/api/groups').send({ name: 'Ghost town' }).expect(201);
      const code = res.body.chat.inviteCode as string;
      await api(solo!).post(`/api/groups/${res.body.chat.id}/leave`).expect(204);
      const joined = (await join(joiner!, code).expect(200)).body as InviteJoinResult;
      expect(joined.chat).toMatchObject({ myRole: 'owner', memberCount: 1 });
      expect((await systemKinds(res.body.chat.id)).slice(-2)).toEqual([
        'member_joined_via_link',
        'owner_changed',
      ]);
    });

    it('linked groups: preview shows the community; joining also joins the community (cascade)', async () => {
      const [joiner, late] = await makeUsers(2);
      const g = await createGroup(owner, []);
      const community = (
        await api(owner)
          .post('/api/communities')
          .send({ name: 'Hood', groupIds: [g] })
          .expect(201)
      ).body as Community;
      const code = await groupCode(g);
      expect(await preview(joiner!, code)).toMatchObject({
        kind: 'group',
        communityId: community.id,
        communityName: 'Hood',
        canJoin: true,
      });

      const conns = await connectAll(t, joiner!);
      const rec = recordEvents(conns.sockets[0]!);
      const res = (await join(joiner!, code).expect(200)).body as InviteJoinResult;
      expect(res.chat).toMatchObject({ id: g, communityId: community.id });
      expect(res.community).toMatchObject({ id: community.id, myRole: 'member', memberCount: 2 });
      expect(res.community!.groups.find((x) => x.chatId === g)).toMatchObject({ isMember: true });
      await settle();
      const names = rec.log
        .filter((e) =>
          [
            'chat:upsert',
            'message:new',
            'chat:updated',
            'chat:members-changed',
            'community:upsert',
          ].includes(e.event),
        )
        .map((e) =>
          e.event === 'chat:upsert' || e.event === 'chat:updated'
            ? `${e.event}:${(e.payload.chat?.id ?? e.payload.chatId) === g ? 'g' : 'ann'}`
            : e.event,
        );
      expect(names).toEqual([
        'chat:upsert:g',
        'message:new',
        'chat:updated:g',
        'chat:members-changed',
        'chat:upsert:ann',
        'chat:updated:ann',
        'community:upsert',
      ]);
      const members = await db
        .select()
        .from(communityMembers)
        .where(eq(communityMembers.communityId, community.id));
      expect(members.map((m) => m.userId)).toContain(joiner!.id);
      expect((await summary(joiner!, community.announcementChatId))!.membership).toBe('active');

      // A full community blocks joins of non-members through its groups.
      await bulkCommunityJoin(
        community.id,
        community.announcementChatId,
        await bulkUsers(MAX_GROUP_MEMBERS - 2),
      );
      expect(await preview(late!, code)).toMatchObject({
        canJoin: false,
        reason: 'This community is full',
      });
      expectError(await join(late!, code), 409, 'limit_reached');
      await conns.close();
    });
  });

  describe('channels', () => {
    it('private channels are joined through the link (as a follow); already following → 409', async () => {
      const [joiner] = await makeUsers(1);
      const ch = (
        await api(owner)
          .post('/api/channels')
          .send({ name: 'Insiders', isPublic: false })
          .expect(201)
      ).body;
      const code = (await api(owner).get(`/api/channels/${ch.id}/invite`).expect(200)).body
        .code as string;
      expect(await preview(joiner!, code)).toEqual({
        code,
        kind: 'channel',
        id: ch.id,
        name: 'Insiders',
        description: null,
        avatarUrl: null,
        memberCount: 1,
        communityId: null,
        communityName: null,
        isMember: false,
        canJoin: true,
        reason: null,
      });
      await send(owner, ch.id, 'post 1');
      const conns = await connectAll(t, joiner!, owner);
      const [jRec, oRec] = conns.sockets.map((s) => recordEvents(s));
      const res = (await join(joiner!, code).expect(200)).body as InviteJoinResult;
      expect(res).toMatchObject({ kind: 'channel', id: ch.id, community: null });
      expect(res.chat).toMatchObject({
        type: 'channel',
        membership: 'active',
        unreadCount: 0,
        memberCount: 2,
      });
      await settle();
      expect(jRec!.names().filter((n) => n !== 'presence:update')).toEqual([
        'chat:upsert',
        'chat:updated',
      ]);
      expect(
        oRec!.names().filter((n) => ['chat:updated', 'chat:members-changed'].includes(n)),
      ).toEqual(['chat:updated', 'chat:members-changed']);
      expect(
        (await loadMessagePage(db, joiner!.id, ch.id, { limit: 10 })).messages.map(
          (m) => m.system?.kind ?? m.text,
        ),
      ).toEqual(['channel_created', 'post 1']);
      expect(await preview(joiner!, code)).toMatchObject({ isMember: true, canJoin: false });
      expectError(await join(joiner!, code), 409, 'conflict');
      await conns.close();
    });
  });

  describe('communities', () => {
    it('preview + join into the announcement group; removed members get 403; already a member → 409', async () => {
      const [joiner, kicked] = await makeUsers(2);
      const c = (
        await api(owner)
          .post('/api/communities')
          .send({ name: 'Town', description: 'Our town' })
          .expect(201)
      ).body as Community;
      expect(await preview(joiner!, c.inviteCode!)).toEqual({
        code: c.inviteCode,
        kind: 'community',
        id: c.id,
        name: 'Town',
        description: 'Our town',
        avatarUrl: null,
        memberCount: 1,
        communityId: null,
        communityName: null,
        isMember: false,
        canJoin: true,
        reason: null,
      });
      const conns = await connectAll(t, joiner!, owner);
      const [jRec, oRec] = conns.sockets.map((s) => recordEvents(s));
      const res = (await join(joiner!, c.inviteCode!).expect(200)).body as InviteJoinResult;
      expect(res).toMatchObject({
        kind: 'community',
        id: c.id,
        chat: null,
        community: { id: c.id, myRole: 'member', memberCount: 2 },
      });
      await settle();
      expect(
        jRec!
          .names()
          .filter((n) => ['chat:upsert', 'community:upsert', 'chat:updated'].includes(n)),
      ).toEqual(['chat:upsert', 'community:upsert', 'chat:updated']);
      expect(jRec!.of('chat:upsert')[0]!.chat).toMatchObject({
        id: c.announcementChatId,
        isAnnouncement: true,
      });
      expect(oRec!.of('chat:members-changed')).toEqual([{ chatId: c.announcementChatId }]);
      expect(jRec!.of('chat:members-changed')).toEqual([]);
      expect(await systemKinds(c.announcementChatId)).toEqual(['community_created']); // no join messages in announcement groups
      expect(await preview(joiner!, c.inviteCode!)).toMatchObject({
        isMember: true,
        canJoin: false,
      });
      expectError(await join(joiner!, c.inviteCode!), 409, 'conflict');

      await api(owner)
        .post(`/api/communities/${c.id}/members`)
        .send({ userIds: [kicked!.id] })
        .expect(200);
      await api(owner).delete(`/api/communities/${c.id}/members/${kicked!.id}`).expect(204);
      expect(await preview(kicked!, c.inviteCode!)).toMatchObject({
        canJoin: false,
        reason: 'You were removed by an admin',
      });
      expectError(await join(kicked!, c.inviteCode!), 403, 'forbidden');
      await conns.close();
    });

    it('full communities: preview reason + 409', async () => {
      const joiner = await t.createUser();
      const c = (await api(owner).post('/api/communities').send({ name: 'Packed' }).expect(201))
        .body as Community;
      await bulkCommunityJoin(c.id, c.announcementChatId, await bulkUsers(MAX_GROUP_MEMBERS - 1));
      expect(await preview(joiner, c.inviteCode!)).toMatchObject({
        canJoin: false,
        reason: 'This community is full',
      });
      expectError(await join(joiner, c.inviteCode!), 409, 'limit_reached');
    });
  });
});
