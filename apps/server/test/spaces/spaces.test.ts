/**
 * Spaces (docs/design/spaces-at-scale.md): creation, invites, computed channel access and the
 * virtual channel rooms, roles/overwrites, moderation, mentions, slowmode, typing focus.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  PERM,
  type ChatSummary,
  type Message,
  type Space,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  emitAck,
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { settle } from '../services/fixtures.js';

describe('spaces', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let invite: SpaceInvite;
  const general = () => detail.channels.find((c) => c.name === 'general')!;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
  });
  afterAll(() => t.close());

  async function sendText(
    user: TestUser,
    chatId: string,
    text: string,
    clientId = Math.random().toString(36),
  ) {
    const res = await t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId, type: 'text', text });
    return res;
  }

  async function join(user: TestUser) {
    const res = await t.api(user).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    return res;
  }

  it('creates a Space with @everyone, #general (system channel), a General voice channel and the owner', async () => {
    const res = await t.api(owner).post('/api/spaces').send({ name: 'Rockets' }).expect(201);
    detail = res.body as SpaceDetail;
    expect(detail.space).toMatchObject({ name: 'Rockets', ownerId: owner.id, memberCount: 1 });
    expect(detail.space.roles.map((r) => r.name)).toEqual(['@everyone']);
    expect(detail.channels.map((c) => [c.type, c.name])).toEqual([
      ['space_text', 'general'],
      ['space_voice', 'General'],
    ]);
    expect(detail.space.systemChannelId).toBe(general().id);
    expect(general().permissions.canSend).toBe(true);
    // Space channels never show up in the chat list…
    const chats = (await t.api(owner).get('/api/chats').expect(200)).body as ChatSummary[];
    expect(chats.some((c) => c.id === general().id)).toBe(false);
    // …but are served by id (clients look up unknown chats of message:new).
    const one = (await t.api(owner).get(`/api/chats/${general().id}`).expect(200))
      .body as ChatSummary;
    expect(one.space?.spaceId).toBe(detail.space.id);
    const mine = (await t.api(owner).get('/api/spaces').expect(200)).body as Space[];
    expect(mine.map((s) => s.id)).toEqual([detail.space.id]);
  });

  it('non-members get 404 for the Space and its channels', async () => {
    await t.api(bob).get(`/api/spaces/${detail.space.id}`).expect(404);
    await t.api(bob).get(`/api/chats/${general().id}`).expect(404);
    await t.api(bob).get(`/api/chats/${general().id}/messages`).expect(404);
    await sendText(bob, general().id, 'nope').then((r) => expect(r.status).toBe(404));
  });

  it('invites: preview and join; the system channel gets a join notice; members get events', async () => {
    invite = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    const preview = (await t.api(bob).get(`/api/invites/${invite.code}`).expect(200)).body;
    expect(preview).toMatchObject({
      kind: 'space',
      id: detail.space.id,
      name: 'Rockets',
      canJoin: true,
      memberCount: 1,
    });
    const so = await t.connect(owner);
    const joinedEvt = waitForEvent(so, 'message:new', {
      filter: (p) => p.message.system?.kind === 'member_joined_space',
    });
    const sb = await t.connect(bob);
    const upsert = waitForEvent(sb, 'space:upsert');
    const res = await join(bob);
    expect(res.body).toMatchObject({ kind: 'space', id: detail.space.id, channelId: general().id });
    expect((await upsert).space.id).toBe(detail.space.id);
    expect((await joinedEvt).message.system).toEqual({
      kind: 'member_joined_space',
      actorId: bob.id,
    });
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(409);
    so.disconnect();
    sb.disconnect();
  });

  it('messages reach members through the virtual channel room; reading creates the read row', async () => {
    const sb = await t.connect(bob);
    const got = waitForEvent(sb, 'message:new', {
      filter: (p) => p.message.text === 'hello space',
    });
    await sendText(owner, general().id, 'hello space').then((r) => expect(r.status).toBe(201));
    const m = (await got).message;
    expect(m.senderId).toBe(owner.id); // senders are shown in Spaces
    const before = (await t.api(bob).get(`/api/chats/${general().id}`).expect(200))
      .body as ChatSummary;
    expect(before.unreadCount).toBeGreaterThanOrEqual(1);
    expect(
      await db
        .select()
        .from(chatMembers)
        .where(and(eq(chatMembers.chatId, general().id), eq(chatMembers.userId, bob.id))),
    ).toHaveLength(0);
    await t.api(bob).post(`/api/chats/${general().id}/read`).send({ seq: m.seq }).expect(204);
    const after = (await t.api(bob).get(`/api/chats/${general().id}`).expect(200))
      .body as ChatSummary;
    expect([after.unreadCount, after.lastReadSeq]).toEqual([0, m.seq]);
    sb.disconnect();
  });

  it('a private channel is invisible (no 200, no events) until a role grants VIEW_CHANNEL', async () => {
    const staff = (
      await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/roles`)
        .send({ name: 'Staff' })
        .expect(201)
    ).body as SpaceRole;
    const secret = (
      await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/channels`)
        .send({ type: 'space_text', name: 'Staff Room', privateRoleIds: [staff.id] })
        .expect(201)
    ).body as ChatSummary;
    expect(secret.name).toBe('staff-room');
    await spaceRegistryIdle();
    await t.api(bob).get(`/api/chats/${secret.id}`).expect(404);
    const bobChannels = (
      await t.api(bob).get(`/api/spaces/${detail.space.id}/channels`).expect(200)
    ).body as ChatSummary[];
    expect(bobChannels.some((c) => c.id === secret.id)).toBe(false);
    const sb = await t.connect(bob);
    const quiet = expectNoEvent(sb, 'message:new', 400);
    await sendText(owner, secret.id, 'staff only').then((r) => expect(r.status).toBe(201));
    await quiet;

    const changed = waitForEvent(sb, 'space:channels-changed');
    await t
      .api(owner)
      .put(`/api/spaces/${detail.space.id}/members/${bob.id}/roles/${staff.id}`)
      .expect(200);
    await changed;
    await spaceRegistryIdle();
    const visible = (await t.api(bob).get(`/api/spaces/${detail.space.id}/channels`).expect(200))
      .body as ChatSummary[];
    expect(visible.some((c) => c.id === secret.id)).toBe(true);
    const got = waitForEvent(sb, 'message:new', {
      filter: (p) => p.message.text === 'now you see it',
    });
    await sendText(owner, secret.id, 'now you see it').then((r) => expect(r.status).toBe(201));
    await got;
    sb.disconnect();
  });

  it('permissions: members cannot manage channels or roles; hierarchy protects the owner', async () => {
    await t
      .api(bob)
      .post(`/api/spaces/${detail.space.id}/channels`)
      .send({ type: 'space_text', name: 'x' })
      .expect(403);
    await t
      .api(bob)
      .post(`/api/spaces/${detail.space.id}/roles`)
      .send({ name: 'Mine' })
      .expect(403);
    // Give Bob KICK_MEMBERS through a role; he still cannot kick the owner.
    const mods = (
      await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/roles`)
        .send({ name: 'Mods', permissions: PERM.KICK_MEMBERS })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${detail.space.id}/members/${bob.id}/roles/${mods.id}`)
      .expect(200);
    await t.api(bob).delete(`/api/spaces/${detail.space.id}/members/${owner.id}`).expect(403);
    // Role editors cannot grant bits they do not have.
    await t
      .api(owner)
      .patch(`/api/spaces/${detail.space.id}/roles/${mods.id}`)
      .send({ permissions: PERM.KICK_MEMBERS | PERM.MANAGE_ROLES })
      .expect(200);
    const low = (
      await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/roles`)
        .send({ name: 'Low' })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(bob)
      .patch(`/api/spaces/${detail.space.id}/roles/${low.id}`)
      .send({ permissions: PERM.BAN_MEMBERS })
      .expect(403);
  });

  it('@everyone needs MENTION_EVERYONE; with it, members get a mention count', async () => {
    const plain = await sendText(bob, general().id, 'hey @{everyone}');
    expect((plain.body as Message).mentionEveryone).toBe(false);
    await t
      .api(owner)
      .post(`/api/chats/${general().id}/read`)
      .send({ seq: (plain.body as Message).seq })
      .expect(204);
    const loud = await sendText(owner, general().id, 'listen @{everyone}');
    expect((loud.body as Message).mentionEveryone).toBe(true);
    const s = (await t.api(bob).get(`/api/chats/${general().id}`).expect(200)).body as ChatSummary;
    expect(s.unreadMentionCount).toBeGreaterThanOrEqual(1);
    const spaces = (await t.api(bob).get('/api/spaces').expect(200)).body as Space[];
    expect(spaces[0]!.unreadMentionCount).toBeGreaterThanOrEqual(1);
  });

  it('slowmode: one message per window for members, moderators bypass', async () => {
    await t
      .api(owner)
      .patch(`/api/spaces/${detail.space.id}/channels/${general().id}`)
      .send({ slowmodeSeconds: 30 })
      .expect(200);
    expect((await sendText(carol, general().id, 'x')).status).toBe(404); // not a member yet
    await join(carol);
    expect((await sendText(carol, general().id, 'first')).status).toBe(201);
    expect((await sendText(carol, general().id, 'second')).status).toBe(429);
    expect((await sendText(owner, general().id, 'owner bypasses')).status).toBe(201);
    await t
      .api(owner)
      .patch(`/api/spaces/${detail.space.id}/channels/${general().id}`)
      .send({ slowmodeSeconds: 0 })
      .expect(200);
  });

  it('typing in a space channel only reaches devices that have it open', async () => {
    const sb = await t.connect(bob);
    const sc = await t.connect(carol);
    await emitAck(sb, 'space:focus', { chatId: general().id });
    const toBob = waitForEvent(sb, 'chat:typing');
    const notCarol = expectNoEvent(sc, 'chat:typing', 400);
    const so = await t.connect(owner);
    so.emit('chat:typing', { chatId: general().id, state: 'typing' });
    expect((await toBob).userId).toBe(owner.id);
    await notCarol;
    [sb, sc, so].forEach((s) => s.disconnect());
  });

  it('timeout: the member can read but not send; the timeout can be lifted', async () => {
    const until = new Date(Date.now() + 60_000).toISOString();
    await t
      .api(owner)
      .patch(`/api/spaces/${detail.space.id}/members/${carol.id}`)
      .send({ timedOutUntil: until })
      .expect(200);
    expect((await sendText(carol, general().id, 'muted?')).status).toBe(403);
    await t.api(carol).get(`/api/chats/${general().id}/messages`).expect(200);
    await t
      .api(owner)
      .patch(`/api/spaces/${detail.space.id}/members/${carol.id}`)
      .send({ timedOutUntil: null })
      .expect(200);
    expect((await sendText(carol, general().id, 'back')).status).toBe(201);
  });

  it('kick and ban: removed members lose access and get space:removed; banned users cannot rejoin', async () => {
    const sc = await t.connect(carol);
    const removed = waitForEvent(sc, 'space:removed');
    await t.api(owner).delete(`/api/spaces/${detail.space.id}/members/${carol.id}`).expect(204);
    expect((await removed).reason).toBe('kicked');
    await spaceRegistryIdle();
    await t.api(carol).get(`/api/chats/${general().id}`).expect(404);
    const quiet = expectNoEvent(sc, 'message:new', 400);
    await sendText(owner, general().id, 'after the kick');
    await quiet;
    await join(carol);
    await t
      .api(owner)
      .put(`/api/spaces/${detail.space.id}/bans/${carol.id}`)
      .send({ reason: 'spam', deleteMessageSeconds: 3600 })
      .expect(204);
    const preview = (await t.api(carol).get(`/api/invites/${invite.code}`).expect(200)).body;
    expect(preview).toMatchObject({ canJoin: false, reason: 'You are banned from this Space' });
    await t.api(carol).post(`/api/invites/${invite.code}/join`).expect(403);
    const log = (await t.api(owner).get(`/api/spaces/${detail.space.id}/audit-log`).expect(200))
      .body as { action: string }[];
    expect(log.map((e) => e.action)).toEqual(
      expect.arrayContaining(['member.kick', 'member.ban', 'channel.create', 'role.create']),
    );
    sc.disconnect();
  });

  it('member list: paged by name, searchable; batch lookup', async () => {
    const page = (
      await t.api(bob).get(`/api/spaces/${detail.space.id}/members?limit=1`).expect(200)
    ).body;
    expect(page.members).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = (
      await t
        .api(bob)
        .get(`/api/spaces/${detail.space.id}/members?limit=10&after=${page.nextCursor}`)
        .expect(200)
    ).body;
    expect(
      [...page.members, ...next.members].map((m: { userId: string }) => m.userId).sort(),
    ).toEqual([owner.id, bob.id].sort());
    const found = (await t.api(bob).get(`/api/spaces/${detail.space.id}/members?q=own`).expect(200))
      .body;
    expect(found.members.map((m: { userId: string }) => m.userId)).toEqual([owner.id]);
    const batch = (
      await t
        .api(bob)
        .post(`/api/spaces/${detail.space.id}/members/batch`)
        .send({ userIds: [owner.id, carol.id] })
        .expect(200)
    ).body;
    expect(batch.map((m: { userId: string }) => m.userId)).toEqual([owner.id]);
  });

  it('leaving, ownership and deletion', async () => {
    await t.api(owner).post(`/api/spaces/${detail.space.id}/leave`).expect(403);
    await t
      .api(owner)
      .post(`/api/spaces/${detail.space.id}/transfer-ownership`)
      .send({ userId: bob.id })
      .expect(200);
    await t.api(owner).post(`/api/spaces/${detail.space.id}/leave`).expect(204);
    const sb = await t.connect(bob);
    const gone = waitForEvent(sb, 'space:removed');
    await t.api(bob).delete(`/api/spaces/${detail.space.id}`).expect(204);
    expect((await gone).reason).toBe('deleted');
    await t.api(bob).get(`/api/spaces/${detail.space.id}`).expect(404);
    await settle(50);
    sb.disconnect();
  });
});
