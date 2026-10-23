/**
 * Group DMs (W7-E): friends only (blocks either way and privacy refused with one answer),
 * one friend → the DM, the 10-member cap, adds by any member (their own friends), removal by
 * the owner, the silent leave and the owner handoff, renames by any member, the admin-only
 * group features refused, and `ChatSummary.isGroupDm` on summaries and `chat:upsert`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GROUP_DM_MAX_MEMBERS, type ChatSummary } from '@enbox/shared';
import { FRIENDS_ONLY, GROUP_DM_FULL } from '../../src/modules/groupDms/service.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import {
  block,
  createDirect,
  createGroup,
  memberRow,
  saveContact,
  setSettings,
} from '../services/fixtures.js';
import { connectAll, expectError, summary, systemKinds, uploadImage } from './util.js';

describe('group DMs', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const api = (u: TestUser) => t.api(u);
  const makeUsers = (n: number) => Promise.all(Array.from({ length: n }, () => t.createUser()));

  /** Friends the way an accepted request leaves them: each saved as the other's contact. */
  async function befriend(a: TestUser, ...others: TestUser[]) {
    for (const b of others) {
      await saveContact(a, b);
      await saveContact(b, a);
    }
  }

  async function createGroupDm(owner: TestUser, members: TestUser[], name?: string) {
    const res = await api(owner)
      .post('/api/chats/group-dm')
      .send({ userIds: members.map((m) => m.id), ...(name === undefined ? {} : { name }) })
      .expect(201);
    return res.body as ChatSummary;
  }

  const addMembers = (actor: TestUser, chatId: string, users: TestUser[]) =>
    api(actor)
      .post(`/api/chats/${chatId}/group-dm/members`)
      .send({ userIds: users.map((u) => u.id) });
  const removeMember = (actor: TestUser, chatId: string, user: TestUser) =>
    api(actor).delete(`/api/chats/${chatId}/group-dm/members/${user.id}`);

  describe('POST /chats/group-dm', () => {
    it('creates a group DM with my friends: me as owner, no admins or invite link, a members_added notice', async () => {
      const [me, ann, bob] = await makeUsers(3);
      // Real requests: accepting is what makes us friends.
      for (const friend of [ann!, bob!]) {
        await api(me!).post('/api/friends/requests').send({ userId: friend.id }).expect(200);
        await api(friend).post(`/api/friends/requests/${me!.id}/accept`).expect(204);
      }
      const chat = await createGroupDm(me!, [ann!, bob!]);
      expect(chat).toMatchObject({
        type: 'group',
        isGroupDm: true,
        name: null,
        memberCount: 3,
        myRole: 'owner',
        membership: 'active',
        inviteCode: null,
        communityId: null,
        isAnnouncement: false,
        createdBy: me!.id,
      });
      expect(chat.permissions).toMatchObject({
        canSend: true,
        canEditInfo: true,
        canAddMembers: true,
        canRemoveMembers: true,
        canLeave: true,
      });
      expect(await systemKinds(chat.id)).toEqual(['members_added']);
      expect(await summary(ann!, chat.id)).toMatchObject({
        isGroupDm: true,
        myRole: 'member',
        permissions: { canEditInfo: true, canAddMembers: true, canRemoveMembers: false },
      });

      // A new one every time (as Discord does); a blank name is no name.
      const named = await createGroupDm(me!, [ann!, bob!], '  Road trip  ');
      expect(named.id).not.toBe(chat.id);
      expect(named.name).toBe('Road trip');
      expect((await createGroupDm(me!, [ann!, bob!], '   ')).name).toBeNull();
    });

    it('friends only: strangers, blocks either way, "nobody can add me" and unknown users get one answer', async () => {
      const [me, friend, stranger, blockedByMe, blocker, closed] = await makeUsers(6);
      await befriend(me!, friend!, blockedByMe!, blocker!, closed!);
      await block(me!, blockedByMe!);
      await block(blocker!, me!);
      await setSettings(closed!, { groupsAddPermission: 'nobody' });
      // Saved me, but I never saved them: not my friend.
      await saveContact(stranger!, me!);
      const others = [stranger!, blockedByMe!, blocker!, closed!].map((u) => u.id);
      for (const other of [...others, crypto.randomUUID()]) {
        const res = await api(me!)
          .post('/api/chats/group-dm')
          .send({ userIds: [friend!.id, other] });
        expect({ status: res.status, body: res.body }).toEqual({
          status: 403,
          body: { error: { code: 'forbidden', message: FRIENDS_ONLY } },
        });
      }
      // The one-friend path checks the same.
      expectError(
        await api(me!)
          .post('/api/chats/group-dm')
          .send({ userIds: [blocker!.id] }),
        403,
        'forbidden',
      );
      const mine = (await api(me!).get('/api/chats').expect(200)).body as ChatSummary[];
      expect(mine).toEqual([]);
      expect(
        ((await api(friend!).get('/api/chats').expect(200)).body as ChatSummary[]).length,
      ).toBe(0);
    });

    it('one friend → our 1:1 DM (the same chat as POST /chats/direct)', async () => {
      const [me, ann] = await makeUsers(2);
      await befriend(me!, ann!);
      const first = await api(me!)
        .post('/api/chats/group-dm')
        .send({ userIds: [ann!.id] })
        .expect(200);
      expect(first.body).toMatchObject({ type: 'direct', peer: { id: ann!.id }, isGroupDm: false });
      const direct = await api(me!).post('/api/chats/direct').send({ userId: ann!.id }).expect(200);
      expect(direct.body.id).toBe(first.body.id);
      // Me and duplicates don't count.
      const again = await api(me!)
        .post('/api/chats/group-dm')
        .send({ userIds: [ann!.id, me!.id, ann!.id] })
        .expect(200);
      expect(again.body.id).toBe(first.body.id);
      for (const userIds of [[me!.id], []])
        expectError(
          await api(me!).post('/api/chats/group-dm').send({ userIds }),
          400,
          'validation_error',
        );
    });

    it(`holds up to ${GROUP_DM_MAX_MEMBERS} members, me included`, async () => {
      const [me, ...friends] = await makeUsers(GROUP_DM_MAX_MEMBERS + 1);
      await befriend(me!, ...friends);
      expectError(
        await api(me!)
          .post('/api/chats/group-dm')
          .send({ userIds: friends.map((f) => f.id) }),
        400,
        'validation_error',
      );
      const full = await createGroupDm(me!, friends.slice(0, GROUP_DM_MAX_MEMBERS - 1));
      expect(full.memberCount).toBe(GROUP_DM_MAX_MEMBERS);
    });
  });

  describe('POST /chats/:chatId/group-dm/members', () => {
    it('any member adds their own friends: JOIN for them, members_added → the room', async () => {
      const [owner, ann, bob, annsFriend] = await makeUsers(4);
      await befriend(owner!, ann!, bob!);
      await befriend(ann!, annsFriend!);
      const chat = await createGroupDm(owner!, [ann!, bob!]);
      const conns = await connectAll(t, owner!, annsFriend!);
      const [ownerSock, newSock] = conns.sockets;
      const joined = waitForEvent(newSock!, 'chat:upsert', {
        filter: (p) => p.chat.id === chat.id,
      });
      const notice = waitForEvent(ownerSock!, 'message:new', {
        filter: (p) => p.message.chatId === chat.id,
      });
      const res = await addMembers(ann!, chat.id, [annsFriend!]).expect(200);
      expect(res.body).toMatchObject({ id: chat.id, memberCount: 4, isGroupDm: true });
      expect((await joined).chat).toMatchObject({ isGroupDm: true, membership: 'active' });
      expect((await notice).message.system).toEqual({
        kind: 'members_added',
        actorId: ann!.id,
        userIds: [annsFriend!.id],
      });
      expect(await systemKinds(chat.id)).toEqual(['members_added', 'members_added']);
      await conns.close();
    });

    it("only the adder's friends; members already in are skipped; the /groups route follows the same rules", async () => {
      const [owner, ann, bob, ownersFriend] = await makeUsers(4);
      await befriend(owner!, ann!, bob!, ownersFriend!);
      const chat = await createGroupDm(owner!, [ann!, bob!]);
      const res = await addMembers(ann!, chat.id, [ownersFriend!]);
      expect({ status: res.status, message: res.body.error?.message }).toEqual({
        status: 403,
        message: FRIENDS_ONLY,
      });
      await addMembers(ann!, chat.id, [bob!]).expect(200);
      expect(await systemKinds(chat.id)).toEqual(['members_added']);

      // Old clients see a group DM as a group and add through /groups: same rules.
      expectError(
        await api(ann!)
          .post(`/api/groups/${chat.id}/members`)
          .send({ userIds: [ownersFriend!.id] }),
        403,
        'forbidden',
      );
      const viaGroups = await api(owner!)
        .post(`/api/groups/${chat.id}/members`)
        .send({ userIds: [ownersFriend!.id, bob!.id] })
        .expect(200);
      expect(viaGroups.body).toMatchObject({
        added: [ownersFriend!.id],
        needsInvite: [],
        failed: [{ userId: bob!.id, reason: 'already_member' }],
      });

      // Not a group DM: the group DM routes don't know it.
      const group = await createGroup(owner!, [ann!]);
      expectError(await addMembers(owner!, group, [bob!]), 404, 'not_found');
      expectError(await removeMember(owner!, group, ann!), 404, 'not_found');
    });

    it(`stops at ${GROUP_DM_MAX_MEMBERS} members`, async () => {
      const [owner, ...friends] = await makeUsers(GROUP_DM_MAX_MEMBERS + 1);
      await befriend(owner!, ...friends);
      const chat = await createGroupDm(owner!, friends.slice(0, GROUP_DM_MAX_MEMBERS - 2));
      expect(chat.memberCount).toBe(GROUP_DM_MAX_MEMBERS - 1);
      const res = await addMembers(owner!, chat.id, friends.slice(GROUP_DM_MAX_MEMBERS - 2));
      expect({ status: res.status, error: res.body.error }).toEqual({
        status: 400,
        error: { code: 'validation_error', message: GROUP_DM_FULL },
      });
      expect(GROUP_DM_FULL).toBe('Group DMs can have up to 10 members');
      const ok = await addMembers(owner!, chat.id, [friends[GROUP_DM_MAX_MEMBERS - 2]!]).expect(
        200,
      );
      expect(ok.body.memberCount).toBe(GROUP_DM_MAX_MEMBERS);
      expectError(
        await addMembers(owner!, chat.id, [friends[GROUP_DM_MAX_MEMBERS - 1]!]),
        400,
        'validation_error',
      );
    });
  });

  describe('DELETE /chats/:chatId/group-dm/members/:userId', () => {
    it('only the owner removes others (member_removed); they can be added back', async () => {
      const [owner, ann, bob] = await makeUsers(3);
      await befriend(owner!, ann!, bob!);
      const chat = await createGroupDm(owner!, [ann!, bob!]);
      expectError(await removeMember(ann!, chat.id, bob!), 403, 'forbidden');
      const conns = await connectAll(t, bob!);
      const gone = waitForEvent(conns.sockets[0]!, 'chat:upsert', {
        filter: (p) => p.chat.id === chat.id,
      });
      await removeMember(owner!, chat.id, bob!).expect(204);
      expect((await gone).chat).toMatchObject({ membership: 'removed', isGroupDm: true });
      expect(await systemKinds(chat.id)).toEqual(['members_added', 'member_removed']);
      expect((await summary(owner!, chat.id))!.memberCount).toBe(2);
      expectError(await removeMember(owner!, chat.id, bob!), 404, 'not_found');
      await befriend(ann!, bob!);
      await addMembers(ann!, chat.id, [bob!]).expect(200);
      expect(await summary(bob!, chat.id)).toMatchObject({ membership: 'active' });
      await conns.close();
    });

    it('leaving is silent; an owner leaving hands over to the longest-standing member; the last one out empties it', async () => {
      const [owner, ann, bob, cy] = await makeUsers(4);
      await befriend(owner!, ann!, bob!, cy!);
      const chat = await createGroupDm(owner!, [ann!, bob!]);
      await addMembers(owner!, chat.id, [cy!]).expect(200);

      await removeMember(ann!, chat.id, ann!).expect(204);
      expect(await systemKinds(chat.id)).toEqual(['members_added', 'members_added']);
      expect(await summary(ann!, chat.id)).toMatchObject({ membership: 'left', isGroupDm: true });

      // Bob has been in since the start, Cy came later.
      const conns = await connectAll(t, bob!);
      const promoted = waitForEvent(conns.sockets[0]!, 'chat:upsert', {
        filter: (p) => p.chat.id === chat.id && p.chat.myRole === 'owner',
      });
      await removeMember(owner!, chat.id, owner!).expect(204);
      await promoted;
      expect(await systemKinds(chat.id)).toEqual([
        'members_added',
        'members_added',
        'owner_changed',
      ]);
      expect((await memberRow(chat.id, bob!)).role).toBe('owner');
      expect((await memberRow(chat.id, owner!)).role).toBe('member');

      await removeMember(bob!, chat.id, cy!).expect(204);
      await removeMember(bob!, chat.id, bob!).expect(204);
      expect(await summary(bob!, chat.id)).toMatchObject({ membership: 'left', memberCount: 0 });
      expectError(await addMembers(bob!, chat.id, [owner!]), 403, 'not_member');
      await conns.close();
    });
  });

  describe('rename, icon and the admin-only group features', () => {
    it('any member renames it, clears the name or changes the icon; groups keep a name', async () => {
      const [owner, ann, bob] = await makeUsers(3);
      await befriend(owner!, ann!, bob!);
      const chat = await createGroupDm(owner!, [ann!, bob!]);
      const conns = await connectAll(t, owner!);
      const sock = conns.sockets[0]!;
      const renamed = waitForEvent(sock, 'chat:updated', {
        filter: (p) => p.chatId === chat.id && p.changes.name === 'Weekend',
      });
      const res = await api(ann!)
        .patch(`/api/groups/${chat.id}`)
        .send({ name: 'Weekend' })
        .expect(200);
      expect(res.body).toMatchObject({ name: 'Weekend', isGroupDm: true });
      await renamed;

      const cleared = waitForEvent(sock, 'chat:updated', {
        filter: (p) => p.chatId === chat.id && p.changes.name === null,
      });
      const res2 = await api(bob!).patch(`/api/groups/${chat.id}`).send({ name: null }).expect(200);
      expect(res2.body.name).toBeNull();
      await cleared;
      expect(await systemKinds(chat.id)).toEqual(['members_added', 'name_changed']);

      const icon = await uploadImage(t, bob!);
      const res3 = await api(bob!)
        .patch(`/api/groups/${chat.id}`)
        .send({ avatarMediaId: icon })
        .expect(200);
      expect(res3.body.avatarUrl).toMatch(/^\/uploads\/.+\.png$/);

      const group = await createGroup(owner!, [ann!]);
      expectError(
        await api(owner!).patch(`/api/groups/${group}`).send({ name: null }),
        400,
        'validation_error',
      );
      await conns.close();
    });

    it('refuses invite links, admin settings and admins (400); ownership moves without an admin left behind', async () => {
      const [owner, ann, bob, outsider] = await makeUsers(4);
      await befriend(owner!, ann!, bob!);
      const chat = await createGroupDm(owner!, [ann!, bob!]);
      for (const res of [
        await api(owner!).get(`/api/groups/${chat.id}/invite`),
        await api(owner!).post(`/api/groups/${chat.id}/invite/reset`),
        await api(owner!)
          .patch(`/api/groups/${chat.id}/settings`)
          .send({ onlyAdminsCanSend: true }),
        await api(owner!)
          .put(`/api/groups/${chat.id}/members/${ann!.id}/role`)
          .send({ role: 'admin' }),
      ])
        expectError(res, 400, 'validation_error');
      expect((await memberRow(chat.id, ann!)).role).toBe('member');
      expect((await summary(owner!, chat.id))!.inviteCode).toBeNull();
      // Outsiders learn nothing (404 before the 400).
      expectError(await api(outsider!).get(`/api/groups/${chat.id}/invite`), 404, 'not_found');

      await api(owner!)
        .post(`/api/groups/${chat.id}/transfer-ownership`)
        .send({ userId: ann!.id })
        .expect(204);
      expect((await memberRow(chat.id, ann!)).role).toBe('owner');
      expect((await memberRow(chat.id, owner!)).role).toBe('member');
      expectError(await removeMember(owner!, chat.id, bob!), 403, 'forbidden');
      await removeMember(ann!, chat.id, bob!).expect(204);
    });
  });

  describe('permissions', () => {
    it('everyone sends, renames and adds; only the owner removes; no invites, admins or deleting others', async () => {
      const [me, ann, bob] = await makeUsers(3);
      await befriend(me!, ann!, bob!);
      const dm = await createGroupDm(me!, [ann!, bob!]);
      expect(dm.permissions).toMatchObject({
        canSend: true,
        canEditInfo: true,
        canAddMembers: true,
        canRemoveMembers: true,
        canInvite: false,
        canManageAdmins: false,
        canDeleteForEveryoneAsAdmin: false,
      });
      const annView = (await api(ann!).get(`/api/chats/${dm.id}`).expect(200)).body as ChatSummary;
      expect(annView.permissions).toMatchObject({
        canSend: true,
        canEditInfo: true,
        canAddMembers: true,
        canRemoveMembers: false,
        canInvite: false,
      });
      // The owner can't delete Ann's message for everyone; Ann can.
      const sent = await api(ann!)
        .post(`/api/chats/${dm.id}/messages`)
        .send({ clientId: 'gdm-perm-1', type: 'text', text: 'mine' })
        .expect(201);
      await api(me!).delete(`/api/messages/${sent.body.id}`).query({ for: 'everyone' }).expect(403);
      await api(ann!)
        .delete(`/api/messages/${sent.body.id}`)
        .query({ for: 'everyone' })
        .expect(204);
      // Nor remove someone else's reaction.
      const other = await api(ann!)
        .post(`/api/chats/${dm.id}/messages`)
        .send({ clientId: 'gdm-perm-2', type: 'text', text: 'react' })
        .expect(201);
      await api(bob!)
        .put(`/api/messages/${other.body.id}/reactions/${encodeURIComponent('👍')}/@me`)
        .expect(204);
      await api(me!)
        .delete(`/api/messages/${other.body.id}/reactions/${encodeURIComponent('👍')}/${bob!.id}`)
        .expect(403);
    });
  });

  it('a group DM cannot be linked to a community', async () => {
    const [me, ann] = await makeUsers(2);
    await befriend(me!, ann!);
    const [bob] = await makeUsers(1);
    await befriend(me!, bob!);
    const dm = await createGroupDm(me!, [ann!, bob!]);
    await api(me!)
      .post('/api/communities')
      .send({ name: 'Club', groupIds: [dm.id] })
      .expect(400);
  });

  describe('ChatSummary.isGroupDm', () => {
    it('is on every chat summary and on chat:upsert', async () => {
      const [me, ann, bob] = await makeUsers(3);
      await befriend(me!, ann!, bob!);
      const conns = await connectAll(t, ann!);
      const joined = waitForEvent(conns.sockets[0]!, 'chat:upsert', {
        filter: (p) => p.chat.type === 'group',
      });
      const dm = await createGroupDm(me!, [ann!, bob!]);
      expect((await joined).chat).toMatchObject({ id: dm.id, isGroupDm: true, myRole: 'member' });

      const group = await createGroup(me!, [ann!]);
      const direct = await createDirect(me!, ann!);
      const list = (await api(me!).get('/api/chats').expect(200)).body as ChatSummary[];
      const byId = new Map(list.map((c) => [c.id, c.isGroupDm]));
      expect(Object.fromEntries([dm.id, group, direct].map((id) => [id, byId.get(id)]))).toEqual({
        [dm.id]: true,
        [group]: false,
        [direct]: false,
      });
      expect((await api(ann!).get(`/api/chats/${dm.id}`).expect(200)).body.isGroupDm).toBe(true);
      await conns.close();
    });
  });
});
