/**
 * `GET /messages/:id/info` exposes the current member roster with read/delivered times, so
 * it follows the member list's rules (docs "Former members", permissions matrix
 * `canViewMembers`): former members → 403 not_member, announcement groups → admins only.
 * Regression tests for review findings AUTHZ-3 / P4.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ChatSummary, Community, MessageInfo } from '@enbox/shared';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createGroup } from '../services/fixtures.js';
import { leaveGroup, sendOk } from './support.js';

describe('message info: only for those who may see the member list', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  /** User ids a MessageInfo response exposes. */
  const exposed = (body: MessageInfo) => [...body.readBy.map((r) => r.user.id), ...body.deliveredTo.map((r) => r.user.id), ...body.pending.map((u) => u.id)];

  it('a removed member gets 403 not_member (like the member list), not the current roster', async () => {
    const [owner, alice, bob] = [await t.createUser(), await t.createUser(), await t.createUser()];
    const g = await createGroup(owner, [alice, bob]);
    const m = await sendOk(t, alice, g, 'hello all');
    const before = await t.api(alice).get(`/api/messages/${m.id}/info`).expect(200);
    expect(exposed(before.body as MessageInfo).sort()).toEqual([owner.id, bob.id].sort());

    await leaveGroup(g, alice, owner);
    expect((await t.api(alice).get(`/api/chats/${g}/members`)).status).toBe(403);
    const res = await t.api(alice).get(`/api/messages/${m.id}/info`);
    expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 403, code: 'not_member' });
  });

  it('a member who left gets 403 not_member too', async () => {
    const [owner, carol] = [await t.createUser(), await t.createUser()];
    const g = await createGroup(owner, [carol]);
    const m = await sendOk(t, carol, g, 'mine');
    await leaveGroup(g, carol);
    const res = await t.api(carol).get(`/api/messages/${m.id}/info`);
    expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 403, code: 'not_member' });
  });

  it('announcement group: a demoted admin cannot enumerate community members through the info of old posts', async () => {
    const [owner, bob, carol, dave] = [await t.createUser(), await t.createUser(), await t.createUser(), await t.createUser()];
    const community = (await t.api(owner).post('/api/communities').send({ name: 'Neighbourhood' }).expect(201)).body as Community;
    await t.api(owner).post(`/api/communities/${community.id}/members`).send({ userIds: [bob.id, carol.id, dave.id] }).expect(200);
    await t.api(owner).put(`/api/communities/${community.id}/members/${bob.id}/role`).send({ role: 'admin' }).expect(204);
    const ann = community.announcementChatId;
    const m = await sendOk(t, bob, ann, 'announcement');
    // As an admin, bob may see who read it.
    expect(exposed((await t.api(bob).get(`/api/messages/${m.id}/info`).expect(200)).body as MessageInfo)).toHaveLength(3);

    await t.api(owner).put(`/api/communities/${community.id}/members/${bob.id}/role`).send({ role: 'member' }).expect(204);
    const summary = (await t.api(bob).get(`/api/chats/${ann}`).expect(200)).body as ChatSummary;
    expect(summary.permissions.canViewMembers).toBe(false);
    expect((await t.api(bob).get(`/api/chats/${ann}/members`)).status).toBe(403);
    const res = await t.api(bob).get(`/api/messages/${m.id}/info`);
    expect({ status: res.status, code: res.body.error?.code, exposed: res.status === 200 ? exposed(res.body as MessageInfo) : [] }).toEqual({
      status: 403,
      code: 'forbidden',
      exposed: [],
    });
  });

  it('active members of regular groups and direct chats keep seeing the info of their messages', async () => {
    const [owner, member] = [await t.createUser(), await t.createUser()];
    const g = await createGroup(owner, [member]);
    const m = await sendOk(t, member, g, 'still here');
    const res = (await t.api(member).get(`/api/messages/${m.id}/info`).expect(200)).body as MessageInfo;
    expect(exposed(res)).toEqual([owner.id]);
    // Someone else's message: still sender-only.
    const other = await sendOk(t, owner, g, 'owner speaking');
    expect((await t.api(member).get(`/api/messages/${other.id}/info`)).status).toBe(403);
  });

  it('keeps the 404 for channel posts', async () => {
    const owner: TestUser = await t.createUser();
    const channel = (await t.api(owner).post('/api/channels').send({ name: 'News' }).expect(201)).body as { id?: string; chat?: { id: string } };
    const channelId = channel.chat?.id ?? channel.id!;
    const post = await sendOk(t, owner, channelId, 'post');
    expect((await t.api(owner).get(`/api/messages/${post.id}/info`)).status).toBe(404);
  });
});
