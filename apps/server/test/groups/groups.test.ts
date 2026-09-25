import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  DEFAULT_GROUP_SETTINGS,
  MAX_GROUP_MEMBERS,
  type AddMembersResult,
  type ChatSummary,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { chatMembers, chats, users } from '../../src/db/schema.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { loadMessagePage } from '../../src/services/messages.js';
import { expectNoEvent, startTestServer, type TestServer, type TestUser } from '../helpers.js';
import {
  block,
  createChannel,
  createCommunity,
  createDirect,
  createGroup,
  memberRow,
  recordEvents,
  saveContact,
  send,
  setSettings,
  settle,
} from '../services/fixtures.js';
import {
  bulkJoin,
  bulkUsers,
  connectAll,
  expectError,
  summary,
  systemKinds,
  uploadImage,
} from './util.js';

describe('groups module', () => {
  let t: TestServer;
  let owner: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    owner = await t.createUser({ displayName: 'Owner' });
  });
  afterAll(() => t.close());

  const makeUsers = (n: number) => Promise.all(Array.from({ length: n }, () => t.createUser()));
  const api = (u: TestUser) => t.api(u);

  describe('POST /groups', () => {
    it('creates the group, adds eligible members and reports needsInvite/failed', async () => {
      const [free, blocker, blockedByMe, nobody, contactsOnly, saved, deleted] = await makeUsers(7);
      await block(blocker!, owner);
      await block(owner, blockedByMe!);
      await setSettings(nobody!, { groupsAddPermission: 'nobody' });
      await setSettings(contactsOnly!, { groupsAddPermission: 'contacts' });
      await setSettings(saved!, { groupsAddPermission: 'contacts' });
      await saveContact(saved!, owner);
      await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, deleted!.id));
      const unknown = crypto.randomUUID();

      const res = await api(owner)
        .post('/api/groups')
        .send({
          name: '  Hikers  ',
          description: 'Weekend trips',
          memberIds: [
            free!.id,
            blocker!.id,
            blockedByMe!.id,
            nobody!.id,
            contactsOnly!.id,
            saved!.id,
            deleted!.id,
            unknown,
            owner.id,
          ],
          settings: { onlyAdminsCanSend: true },
        })
        .expect(201);
      const body = res.body as AddMembersResult;
      expect(body.added).toEqual([free!.id, saved!.id]);
      expect(body.needsInvite).toEqual([
        blocker!.id,
        blockedByMe!.id,
        nobody!.id,
        contactsOnly!.id,
      ]);
      expect(body.failed).toEqual([
        { userId: deleted!.id, reason: 'not_found' },
        { userId: unknown, reason: 'not_found' },
        { userId: owner.id, reason: 'already_member' },
      ]);
      expect(body.chat).toMatchObject({
        type: 'group',
        name: 'Hikers',
        description: 'Weekend trips',
        myRole: 'owner',
        membership: 'active',
        memberCount: 3,
        communityId: null,
        isAnnouncement: false,
        groupSettings: { ...DEFAULT_GROUP_SETTINGS, onlyAdminsCanSend: true },
        disappearingSeconds: null,
      });
      expect(body.chat.inviteCode).toMatch(/^[A-Za-z0-9]{22}$/);
      expect(await systemKinds(body.chat.id)).toEqual(['group_created', 'members_added']);
      // initial members see group_created (joined_seq 0)
      const page = await loadMessagePage(db, free!.id, body.chat.id, { limit: 10 });
      expect(page.messages.map((m) => m.system?.kind)).toEqual(['group_created', 'members_added']);
      expect(await summary(nobody!, body.chat.id)).toBeNull();
    });

    it('emits JOIN (chat:upsert) before the system messages to every initial member; nothing to needsInvite users', async () => {
      const [a, b] = await makeUsers(2);
      await setSettings(b!, { groupsAddPermission: 'nobody' });
      const conns = await connectAll(t, owner, a!, b!);
      const [ownerSock, aSock, bSock] = conns.sockets;
      const ownerRec = recordEvents(ownerSock!);
      const aRec = recordEvents(aSock!);
      const res = await api(owner)
        .post('/api/groups')
        .send({ name: 'G', memberIds: [a!.id, b!.id] })
        .expect(201);
      const chatId = res.body.chat.id as string;
      await settle();
      for (const rec of [ownerRec, aRec]) {
        const relevant = rec.log.filter((e) => ['chat:upsert', 'message:new'].includes(e.event));
        expect(relevant.map((e) => e.event)).toEqual(['chat:upsert', 'message:new', 'message:new']);
        expect(relevant.slice(1).map((e) => e.payload.message.system.kind)).toEqual([
          'group_created',
          'members_added',
        ]);
        expect(relevant[0]!.payload.chat.id).toBe(chatId);
      }
      await expectNoEvent(bSock!, 'chat:upsert', 100);
      await conns.close();
    });

    it("uses the creator's default disappearing timer unless given; validates avatars and bodies", async () => {
      const creator = await t.createUser();
      await setSettings(creator, { defaultDisappearingSeconds: 86400 });
      const r1 = await api(creator).post('/api/groups').send({ name: 'Timer' }).expect(201);
      expect(r1.body.chat.disappearingSeconds).toBe(86400);
      const r2 = await api(creator)
        .post('/api/groups')
        .send({ name: 'No timer', disappearingSeconds: null })
        .expect(201);
      expect(r2.body.chat.disappearingSeconds).toBeNull();

      const mine = await uploadImage(t, creator);
      const r3 = await api(creator)
        .post('/api/groups')
        .send({ name: 'Pic', avatarMediaId: mine })
        .expect(201);
      expect(r3.body.chat.avatarUrl).toMatch(/^\/uploads\/.+\.png$/);
      const theirs = await uploadImage(t, owner);
      expectError(
        await api(creator).post('/api/groups').send({ name: 'Pic', avatarMediaId: theirs }),
        404,
        'not_found',
      );
      const doc = (
        await api(creator)
          .post('/api/media')
          .field('kind', 'file')
          .attach('file', Buffer.from('plain text'), { filename: 'a.txt' })
          .expect(201)
      ).body.id;
      expectError(
        await api(creator).post('/api/groups').send({ name: 'Doc', avatarMediaId: doc }),
        400,
        'validation_error',
      );

      expectError(
        await api(creator).post('/api/groups').send({ name: '   ' }),
        400,
        'validation_error',
      );
      const x = crypto.randomUUID();
      expectError(
        await api(creator)
          .post('/api/groups')
          .send({ name: 'Dup', memberIds: [x, x] }),
        400,
        'validation_error',
      );
      expectError(
        await api(creator).post('/api/groups').send({ name: 'Bad', disappearingSeconds: 5 }),
        400,
        'validation_error',
      );
      expectError(await t.api().post('/api/groups').send({ name: 'Anon' }), 401, 'unauthorized');
    });
  });

  describe('route guards', () => {
    it('404 for outsiders and non-groups, 403 for announcement groups, 403 not_member for former members', async () => {
      const [member, outsider] = await makeUsers(2);
      const chatId = await createGroup(owner, [member!]);
      const channelId = await createChannel(owner);
      const directId = await createDirect(owner, member!);
      const { announcementChatId } = await createCommunity(owner);

      expectError(
        await api(outsider!).patch(`/api/groups/${chatId}`).send({ name: 'x' }),
        404,
        'not_found',
      );
      expectError(await api(outsider!).get(`/api/groups/${chatId}/invite`), 404, 'not_found');
      expectError(
        await api(owner).patch(`/api/groups/${channelId}`).send({ name: 'x' }),
        404,
        'not_found',
      );
      expectError(await api(owner).post(`/api/groups/${directId}/leave`), 404, 'not_found');
      expectError(
        await api(owner).patch(`/api/groups/${crypto.randomUUID()}`).send({ name: 'x' }),
        404,
        'not_found',
      );
      expectError(
        await api(owner).patch('/api/groups/not-a-uuid').send({ name: 'x' }),
        400,
        'validation_error',
      );

      for (const [method, path, body] of [
        ['patch', '', { name: 'x' }],
        ['patch', '/settings', { onlyAdminsCanSend: false }],
        ['post', '/members', { userIds: [member!.id] }],
        ['delete', `/members/${member!.id}`, undefined],
        ['put', `/members/${member!.id}/role`, { role: 'admin' }],
        ['post', '/transfer-ownership', { userId: member!.id }],
        ['post', '/leave', undefined],
        ['get', '/invite', undefined],
        ['post', '/invite/reset', undefined],
      ] as const) {
        const req = api(owner)[method](`/api/groups/${announcementChatId}${path}`);
        const res = body ? await req.send(body) : await req;
        expectError(res, 403, 'forbidden');
      }

      await api(member!).post(`/api/groups/${chatId}/leave`).expect(204);
      expectError(
        await api(member!).patch(`/api/groups/${chatId}`).send({ name: 'x' }),
        403,
        'not_member',
      );
      expectError(await api(member!).post(`/api/groups/${chatId}/leave`), 403, 'not_member');
      expectError(await api(member!).get(`/api/groups/${chatId}/invite`), 403, 'not_member');
      expectError(
        await api(member!)
          .post(`/api/groups/${chatId}/members`)
          .send({ userIds: [outsider!.id] }),
        403,
        'not_member',
      );
    });
  });

  describe('PATCH /groups/:chatId', () => {
    it('one system message per changed field, then chat:updated with the changed fields', async () => {
      const member = await t.createUser();
      const chatId = await createGroup(owner, [member], { name: 'Old' });
      const avatar = await uploadImage(t, member);
      const conns = await connectAll(t, owner);
      const rec = recordEvents(conns.sockets[0]!);
      const res = await api(member)
        .patch(`/api/groups/${chatId}`)
        .send({ name: 'New', description: 'About', avatarMediaId: avatar })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'New', description: 'About' });
      expect(res.body.avatarUrl).toMatch(/^\/uploads\//);
      await settle();
      const relevant = rec.log.filter((e) => ['message:new', 'chat:updated'].includes(e.event));
      expect(
        relevant.map((e) => (e.event === 'message:new' ? e.payload.message.system.kind : e.event)),
      ).toEqual(['name_changed', 'description_changed', 'avatar_changed', 'chat:updated']);
      expect(relevant[0]!.payload.message.system).toEqual({
        kind: 'name_changed',
        actorId: member.id,
        name: 'New',
      });
      expect(relevant[3]!.payload).toEqual({
        chatId,
        changes: { name: 'New', description: 'About', avatarUrl: res.body.avatarUrl },
      });

      rec.clear();
      await api(member)
        .patch(`/api/groups/${chatId}`)
        .send({ name: 'New', description: 'About' })
        .expect(200);
      await settle();
      expect(rec.log.filter((e) => ['message:new', 'chat:updated'].includes(e.event))).toEqual([]);

      await api(owner)
        .patch(`/api/groups/${chatId}`)
        .send({ description: null, avatarMediaId: null })
        .expect(200);
      await settle();
      expect(rec.of('chat:updated').at(-1)!.changes).toEqual({
        description: null,
        avatarUrl: null,
      });
      expect((await systemKinds(chatId)).slice(-2)).toEqual([
        'description_changed',
        'avatar_changed',
      ]);
      await conns.close();
    });

    it('onlyAdminsCanEditInfo: members get 403, admins may edit', async () => {
      const [member, admin] = await makeUsers(2);
      const chatId = await createGroup(owner, [member!, admin!], {
        settings: { onlyAdminsCanEditInfo: true },
        admins: [admin!],
      });
      expectError(
        await api(member!).patch(`/api/groups/${chatId}`).send({ name: 'Nope' }),
        403,
        'forbidden',
      );
      await api(admin!).patch(`/api/groups/${chatId}`).send({ name: 'Yes' }).expect(200);
    });
  });

  describe('PATCH /groups/:chatId/settings', () => {
    it('admins only; one settings_changed per changed key, then chat:updated {groupSettings}', async () => {
      const [member, admin] = await makeUsers(2);
      const chatId = await createGroup(owner, [member!, admin!], { admins: [admin!] });
      expectError(
        await api(member!)
          .patch(`/api/groups/${chatId}/settings`)
          .send({ onlyAdminsCanSend: true }),
        403,
        'forbidden',
      );
      const conns = await connectAll(t, member!);
      const rec = recordEvents(conns.sockets[0]!);
      const res = await api(admin!)
        .patch(`/api/groups/${chatId}/settings`)
        .send({
          onlyAdminsCanSend: true,
          onlyAdminsCanEditInfo: false,
          onlyAdminsCanAddMembers: true,
        })
        .expect(200);
      expect(res.body.groupSettings).toEqual({
        onlyAdminsCanSend: true,
        onlyAdminsCanEditInfo: false,
        onlyAdminsCanAddMembers: true,
      });
      await settle();
      const relevant = rec.log.filter((e) => ['message:new', 'chat:updated'].includes(e.event));
      expect(
        relevant.map((e) => (e.event === 'message:new' ? e.payload.message.system : e.event)),
      ).toEqual([
        { kind: 'settings_changed', actorId: admin!.id, setting: 'onlyAdminsCanSend', value: true },
        {
          kind: 'settings_changed',
          actorId: admin!.id,
          setting: 'onlyAdminsCanAddMembers',
          value: true,
        },
        'chat:updated',
      ]);
      expect(relevant[2]!.payload.changes).toEqual({ groupSettings: res.body.groupSettings });
      // The member's own permissions follow the settings.
      const s = (await summary(member!, chatId))!;
      expect(s.permissions).toMatchObject({
        canSend: false,
        canAddMembers: false,
        canInvite: false,
        canEditInfo: true,
      });
      expect(s.inviteCode).toBeNull();

      rec.clear();
      await api(owner)
        .patch(`/api/groups/${chatId}/settings`)
        .send({ onlyAdminsCanSend: true })
        .expect(200);
      await settle();
      expect(rec.log.filter((e) => ['message:new', 'chat:updated'].includes(e.event))).toEqual([]);
      expectError(
        await api(owner).patch(`/api/groups/${chatId}/settings`).send({ onlyAdminsCanSend: 'yes' }),
        400,
        'validation_error',
      );
      await conns.close();
    });
  });

  describe('POST /groups/:chatId/members', () => {
    it('adds members: new member gets chat:upsert BEFORE message:new; room gets memberCount + members-changed', async () => {
      const [member, newbie, shy] = await makeUsers(3);
      await setSettings(shy!, { groupsAddPermission: 'nobody' });
      const chatId = await createGroup(owner, [member!]);
      await send(owner, chatId, 'history before newbie');
      const conns = await connectAll(t, member!, newbie!);
      const [memberSock, newbieSock] = conns.sockets;
      const memberRec = recordEvents(memberSock!);
      const newbieRec = recordEvents(newbieSock!);
      const res = await api(member!)
        .post(`/api/groups/${chatId}/members`)
        .send({ userIds: [newbie!.id, shy!.id, member!.id] })
        .expect(200);
      const body = res.body as AddMembersResult;
      expect(body).toMatchObject({
        added: [newbie!.id],
        needsInvite: [shy!.id],
        failed: [{ userId: member!.id, reason: 'already_member' }],
      });
      expect(body.chat.memberCount).toBe(3);
      await settle();
      const nb = newbieRec.log.filter((e) =>
        ['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed'].includes(e.event),
      );
      expect(nb.map((e) => e.event)).toEqual([
        'chat:upsert',
        'message:new',
        'chat:updated',
        'chat:members-changed',
      ]);
      expect(nb[0]!.payload.chat).toMatchObject({
        id: chatId,
        membership: 'active',
        memberCount: 3,
      });
      expect(nb[1]!.payload.message.system).toEqual({
        kind: 'members_added',
        actorId: member!.id,
        userIds: [newbie!.id],
      });
      expect(nb[2]!.payload).toEqual({ chatId, changes: { memberCount: 3 } });
      const mb = memberRec.log.filter((e) =>
        ['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed'].includes(e.event),
      );
      expect(mb.map((e) => e.event)).toEqual([
        'message:new',
        'chat:updated',
        'chat:members-changed',
      ]);
      // The new member sees "X added you" but no older history.
      const page = await loadMessagePage(db, newbie!.id, chatId, { limit: 50 });
      expect(page.messages.map((m) => m.system?.kind ?? m.text)).toEqual(['members_added']);
      await conns.close();
    });

    it('onlyAdminsCanAddMembers: members get 403; nothing eligible → no events', async () => {
      const [member, admin, target, shy] = await makeUsers(4);
      await setSettings(shy!, { groupsAddPermission: 'nobody' });
      const chatId = await createGroup(owner, [member!, admin!], {
        settings: { onlyAdminsCanAddMembers: true },
        admins: [admin!],
      });
      expectError(
        await api(member!)
          .post(`/api/groups/${chatId}/members`)
          .send({ userIds: [target!.id] }),
        403,
        'forbidden',
      );
      const conns = await connectAll(t, member!);
      const rec = recordEvents(conns.sockets[0]!);
      const res = await api(admin!)
        .post(`/api/groups/${chatId}/members`)
        .send({ userIds: [shy!.id] })
        .expect(200);
      expect(res.body).toMatchObject({ added: [], needsInvite: [shy!.id], failed: [] });
      await settle();
      expect(rec.log.filter((e) => e.event !== 'presence:update')).toEqual([]);
      expectError(
        await api(admin!).post(`/api/groups/${chatId}/members`).send({ userIds: [] }),
        400,
        'validation_error',
      );
      await conns.close();
    });

    it('re-adding a removed member reactivates the row with a new window', async () => {
      const [member] = await makeUsers(1);
      const chatId = await createGroup(owner, [member!]);
      await api(owner).delete(`/api/groups/${chatId}/members/${member!.id}`).expect(204);
      await send(owner, chatId, 'while away');
      await api(owner)
        .post(`/api/groups/${chatId}/members`)
        .send({ userIds: [member!.id] })
        .expect(200);
      const row = await memberRow(chatId, member!);
      expect(row).toMatchObject({ leftAt: null, leftReason: null, role: 'member' });
      const page = await loadMessagePage(db, member!.id, chatId, { limit: 50 });
      expect(page.messages.map((m) => m.system?.kind ?? m.text)).toEqual(['members_added']);
    });

    it('capacity: users beyond MAX_GROUP_MEMBERS fail with limit_reached', async () => {
      const [x, y] = await makeUsers(2);
      const chatId = await createGroup(owner, []);
      await bulkJoin(chatId, await bulkUsers(MAX_GROUP_MEMBERS - 2)); // owner + filler = MAX − 1
      const res = await api(owner)
        .post(`/api/groups/${chatId}/members`)
        .send({ userIds: [x!.id, y!.id] })
        .expect(200);
      expect(res.body).toMatchObject({
        added: [x!.id],
        needsInvite: [],
        failed: [{ userId: y!.id, reason: 'limit_reached' }],
      });
      expect(res.body.chat.memberCount).toBe(MAX_GROUP_MEMBERS);
    });
    it('rate limit: USER_RATE_LIMITS.addMembers counts added users (a rejected request adds nobody)', async () => {
      const adder = await t.createUser();
      const ids = await bulkUsers(210);
      config.rateLimit = true;
      try {
        const res = await api(adder)
          .post('/api/groups')
          .send({ name: 'Big', memberIds: ids.slice(0, 150) })
          .expect(201);
        const chatId = res.body.chat.id as string;
        expectError(
          await api(adder)
            .post(`/api/groups/${chatId}/members`)
            .send({ userIds: ids.slice(150, 210) }),
          429,
          'rate_limited',
        );
        expect((await summary(adder, chatId))!.memberCount).toBe(151);
        // needsInvite / already-member targets don't count: exactly the remaining 50 fit.
        await api(adder)
          .post(`/api/groups/${chatId}/members`)
          .send({ userIds: ids.slice(100, 200) })
          .expect(200);
        expect((await summary(adder, chatId))!.memberCount).toBe(201);
        expectError(
          await api(adder)
            .post(`/api/groups/${chatId}/members`)
            .send({ userIds: [ids[200]!] }),
          429,
          'rate_limited',
        );
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
    });
  });

  describe('DELETE /groups/:chatId/members/:userId', () => {
    it('removal: member_removed → R, then chat:upsert (removed) → U(u), then no more room events', async () => {
      const [admin, victim, other] = await makeUsers(3);
      const chatId = await createGroup(owner, [admin!, victim!, other!], { admins: [admin!] });
      const conns = await connectAll(t, victim!, other!);
      const [victimSock, otherSock] = conns.sockets;
      const victimRec = recordEvents(victimSock!);
      const otherRec = recordEvents(otherSock!);
      await api(admin!).delete(`/api/groups/${chatId}/members/${victim!.id}`).expect(204);
      await settle();
      const v = victimRec.log.filter((e) =>
        ['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed'].includes(e.event),
      );
      expect(v.map((e) => e.event)).toEqual(['message:new', 'chat:upsert']);
      expect(v[0]!.payload.message.system).toEqual({
        kind: 'member_removed',
        actorId: admin!.id,
        userId: victim!.id,
      });
      expect(v[1]!.payload.chat).toMatchObject({
        id: chatId,
        membership: 'removed',
        myRole: 'member',
        memberCount: 3,
      });
      expect(v[1]!.payload.chat.permissions.canSend).toBe(false);
      const o = otherRec.log.filter((e) =>
        ['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed'].includes(e.event),
      );
      expect(o.map((e) => e.event)).toEqual([
        'message:new',
        'chat:updated',
        'chat:members-changed',
      ]);
      expect(o[1]!.payload).toEqual({ chatId, changes: { memberCount: 3 } });

      victimRec.clear();
      await send(owner, chatId, 'after removal');
      await api(owner).patch(`/api/groups/${chatId}`).send({ name: 'Renamed' }).expect(200);
      await settle();
      expect(
        victimRec.log.filter((e) =>
          ['message:new', 'chat:updated', 'chat:members-changed'].includes(e.event),
        ),
      ).toEqual([]);
      expect(await memberRow(chatId, victim!)).toMatchObject({ leftReason: 'removed' });
      await conns.close();
    });

    it('permissions: members 403; nobody removes the owner; admins may remove admins; 404 non-members; 400 self', async () => {
      const [member, admin1, admin2, outsider] = await makeUsers(4);
      const chatId = await createGroup(owner, [member!, admin1!, admin2!], {
        admins: [admin1!, admin2!],
      });
      expectError(
        await api(member!).delete(`/api/groups/${chatId}/members/${admin1!.id}`),
        403,
        'forbidden',
      );
      expectError(
        await api(admin1!).delete(`/api/groups/${chatId}/members/${owner.id}`),
        403,
        'forbidden',
      );
      expectError(
        await api(admin1!).delete(`/api/groups/${chatId}/members/${outsider!.id}`),
        404,
        'not_found',
      );
      expectError(
        await api(admin1!).delete(`/api/groups/${chatId}/members/${admin1!.id}`),
        400,
        'validation_error',
      );
      await api(admin1!).delete(`/api/groups/${chatId}/members/${admin2!.id}`).expect(204);
      expectError(
        await api(admin1!).delete(`/api/groups/${chatId}/members/${admin2!.id}`),
        404,
        'not_found',
      );
      expect(await memberRow(chatId, admin2!)).toMatchObject({
        role: 'member',
        leftReason: 'removed',
      });
    });
  });

  describe('roles and ownership', () => {
    it('promote/demote: system message, chat:upsert → target, members-changed; owner cannot be demoted', async () => {
      const [member, admin, target] = await makeUsers(3);
      const chatId = await createGroup(owner, [member!, admin!, target!], { admins: [admin!] });
      expectError(
        await api(member!)
          .put(`/api/groups/${chatId}/members/${target!.id}/role`)
          .send({ role: 'admin' }),
        403,
        'forbidden',
      );
      const conns = await connectAll(t, target!);
      const rec = recordEvents(conns.sockets[0]!);
      await api(admin!)
        .put(`/api/groups/${chatId}/members/${target!.id}/role`)
        .send({ role: 'admin' })
        .expect(204);
      await settle();
      const r = rec.log.filter((e) =>
        ['chat:upsert', 'message:new', 'chat:members-changed'].includes(e.event),
      );
      expect(r.map((e) => e.event)).toEqual(['message:new', 'chat:upsert', 'chat:members-changed']);
      expect(r[0]!.payload.message.system).toEqual({
        kind: 'admin_promoted',
        actorId: admin!.id,
        userId: target!.id,
      });
      expect(r[1]!.payload.chat).toMatchObject({
        myRole: 'admin',
        permissions: { canRemoveMembers: true, canManageAdmins: true },
      });

      rec.clear();
      await api(admin!)
        .put(`/api/groups/${chatId}/members/${target!.id}/role`)
        .send({ role: 'admin' })
        .expect(204); // unchanged
      await settle();
      expect(rec.log.filter((e) => e.event !== 'presence:update')).toEqual([]);
      await api(owner)
        .put(`/api/groups/${chatId}/members/${target!.id}/role`)
        .send({ role: 'member' })
        .expect(204);
      expect((await systemKinds(chatId)).at(-1)).toBe('admin_demoted');
      expectError(
        await api(admin!)
          .put(`/api/groups/${chatId}/members/${owner.id}/role`)
          .send({ role: 'member' }),
        403,
        'forbidden',
      );
      expectError(
        await api(admin!)
          .put(`/api/groups/${chatId}/members/${crypto.randomUUID()}/role`)
          .send({ role: 'admin' }),
        404,
        'not_found',
      );
      expectError(
        await api(admin!)
          .put(`/api/groups/${chatId}/members/${target!.id}/role`)
          .send({ role: 'owner' }),
        400,
        'validation_error',
      );
      await conns.close();
    });

    it('transfer-ownership: owner only; old owner becomes admin; owner_transferred + upserts to both', async () => {
      const [admin, member, outsider] = await makeUsers(3);
      const chatId = await createGroup(owner, [admin!, member!], { admins: [admin!] });
      expectError(
        await api(admin!)
          .post(`/api/groups/${chatId}/transfer-ownership`)
          .send({ userId: member!.id }),
        403,
        'forbidden',
      );
      expectError(
        await api(owner)
          .post(`/api/groups/${chatId}/transfer-ownership`)
          .send({ userId: outsider!.id }),
        404,
        'not_found',
      );
      expectError(
        await api(owner)
          .post(`/api/groups/${chatId}/transfer-ownership`)
          .send({ userId: owner.id }),
        400,
        'validation_error',
      );
      const conns = await connectAll(t, owner, member!);
      const [ownerRec, memberRec] = conns.sockets.map((s) => recordEvents(s));
      await api(owner)
        .post(`/api/groups/${chatId}/transfer-ownership`)
        .send({ userId: member!.id })
        .expect(204);
      await settle();
      expect(
        memberRec!
          .names()
          .filter((n) => ['message:new', 'chat:upsert', 'chat:members-changed'].includes(n)),
      ).toEqual(['message:new', 'chat:upsert', 'chat:members-changed']);
      expect(memberRec!.of('message:new')[0]!.message.system).toEqual({
        kind: 'owner_transferred',
        actorId: owner.id,
        userId: member!.id,
      });
      expect(memberRec!.of('chat:upsert')[0]!.chat.myRole).toBe('owner');
      expect(ownerRec!.of('chat:upsert')[0]!.chat.myRole).toBe('admin');
      expect((await memberRow(chatId, owner)).role).toBe('admin');
      await conns.close();
    });

    it('leave: member_left (+ owner_changed on succession), LEAVE(me), chat:upsert → new owner, memberCount, members-changed', async () => {
      const [admin, member] = await makeUsers(2);
      const chatId = await createGroup(owner, [admin!, member!], { admins: [admin!] });
      const conns = await connectAll(t, owner, admin!, member!);
      const [ownerRec, adminRec, memberRec] = conns.sockets.map((s) => recordEvents(s));
      await api(owner).post(`/api/groups/${chatId}/leave`).expect(204);
      await settle();
      const o = ownerRec!.log.filter((e) =>
        ['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed'].includes(e.event),
      );
      expect(o.map((e) => e.event)).toEqual(['message:new', 'chat:upsert']);
      expect(o[1]!.payload.chat).toMatchObject({ membership: 'left', myRole: 'member' });
      const a = adminRec!.log.filter((e) =>
        ['chat:upsert', 'message:new', 'chat:updated', 'chat:members-changed'].includes(e.event),
      );
      expect(
        a.map((e) => (e.event === 'message:new' ? e.payload.message.system.kind : e.event)),
      ).toEqual([
        'member_left',
        'owner_changed',
        'chat:upsert',
        'chat:updated',
        'chat:members-changed',
      ]);
      expect(a[2]!.payload.chat.myRole).toBe('owner');
      expect(a[3]!.payload.changes).toEqual({ memberCount: 2 });
      expect(memberRec!.of('message:new').map((p) => p.message.system?.kind)).toEqual([
        'member_left',
        'owner_changed',
      ]);

      // Former members keep read-only access; they can no longer act.
      const s = (await summary(owner, chatId))!;
      expect(s).toMatchObject({ membership: 'left', inviteCode: null });
      expect(Object.values(s.permissions).every((v) => v === false)).toBe(true);
      expectError(
        await api(owner)
          .post(`/api/groups/${chatId}/members`)
          .send({ userIds: [member!.id] }),
        403,
        'not_member',
      );
      await conns.close();
    });

    it('the last member leaving leaves an empty group (no owner)', async () => {
      const solo = await t.createUser();
      const res = await api(solo).post('/api/groups').send({ name: 'Solo' }).expect(201);
      await api(solo).post(`/api/groups/${res.body.chat.id}/leave`).expect(204);
      const rows = await db
        .select()
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, res.body.chat.id)));
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ role: 'member', leftReason: 'left' });
    });
  });

  describe('invite links', () => {
    it('GET invite requires canInvite; reset (admins) → new code, invite_link_reset, chat:upsert to inviters', async () => {
      const [member, admin] = await makeUsers(2);
      const chatId = await createGroup(owner, [member!, admin!], { admins: [admin!] });
      const { body: first } = await api(member!).get(`/api/groups/${chatId}/invite`).expect(200);
      expect(first.code).toMatch(/^[A-Za-z0-9]{22}$/);
      expectError(await api(member!).post(`/api/groups/${chatId}/invite/reset`), 403, 'forbidden');

      const conns = await connectAll(t, member!, admin!);
      const [memberRec, adminRec] = conns.sockets.map((s) => recordEvents(s));
      const { body: reset } = await api(admin!)
        .post(`/api/groups/${chatId}/invite/reset`)
        .expect(200);
      expect(reset.code).not.toBe(first.code);
      await settle();
      for (const rec of [memberRec!, adminRec!]) {
        const r = rec.log.filter((e) => ['message:new', 'chat:upsert'].includes(e.event));
        expect(r.map((e) => e.event)).toEqual(['message:new', 'chat:upsert']);
        expect(r[0]!.payload.message.system).toEqual({
          kind: 'invite_link_reset',
          actorId: admin!.id,
        });
        expect(r[1]!.payload.chat.inviteCode).toBe(reset.code);
      }
      expectError(await api(member!).get(`/api/invites/${first.code}`), 404, 'not_found');
      expect((await api(member!).get(`/api/invites/${reset.code}`).expect(200)).body.id).toBe(
        chatId,
      );

      // Adding restricted to admins: members can no longer see the link and get no upsert on reset.
      await api(owner)
        .patch(`/api/groups/${chatId}/settings`)
        .send({ onlyAdminsCanAddMembers: true })
        .expect(200);
      expectError(await api(member!).get(`/api/groups/${chatId}/invite`), 403, 'forbidden');
      memberRec!.clear();
      adminRec!.clear();
      await api(owner).post(`/api/groups/${chatId}/invite/reset`).expect(200);
      await settle();
      expect(memberRec!.of('chat:upsert')).toEqual([]);
      expect(adminRec!.of('chat:upsert')).toHaveLength(1);
      await conns.close();
    });
  });

  it('a group without an invite code gets one generated on first GET (stable afterwards)', async () => {
    const chatId = await createGroup(owner, []);
    await db.update(chats).set({ inviteCode: null }).where(eq(chats.id, chatId));
    const first = (await api(owner).get(`/api/groups/${chatId}/invite`).expect(200)).body
      .code as string;
    expect(first).toMatch(/^[A-Za-z0-9]{22}$/);
    expect((await api(owner).get(`/api/groups/${chatId}/invite`).expect(200)).body.code).toBe(
      first,
    );
    expect((await summary(owner, chatId))!.inviteCode).toBe(first);
  });

  it('chat summaries stay consistent with computeChatPermissions for every role', async () => {
    const [admin, member] = await makeUsers(2);
    const chatId = await createGroup(owner, [admin!, member!], {
      admins: [admin!],
      settings: { onlyAdminsCanSend: true },
    });
    const o = (await summary(owner, chatId)) as ChatSummary;
    const a = (await summary(admin!, chatId)) as ChatSummary;
    const m = (await summary(member!, chatId)) as ChatSummary;
    expect(o.permissions).toMatchObject({
      canSend: true,
      canManageAdmins: true,
      canRemoveMembers: true,
      canLeave: true,
    });
    expect(a.permissions).toMatchObject({
      canSend: true,
      canManageAdmins: true,
      canRemoveMembers: true,
    });
    expect(m.permissions).toMatchObject({
      canSend: false,
      canManageAdmins: false,
      canRemoveMembers: false,
      canInvite: true,
    });
  });
});
