/**
 * Threads in Space text channels (Discord model): create (plain / from a message, one per
 * message), messages and the counter, read state, the parent's visibility (REST and socket),
 * archive / revive on send, lock, rename, delete, the auto-archive job, and the chat list.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import type { ChatSummary, Message, MessagePage, SpaceDetail, SpaceInvite, SpaceRole, ThreadsPage } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chats } from '../../src/db/schema.js';
import { archiveIdleThreads } from '../../src/modules/threads/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { resetThreadFanout } from '../../src/services/threads.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';

describe('threads', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let invite: SpaceInvite;
  const general = () => detail.channels.find((c) => c.name === 'general')!;
  const voice = () => detail.channels.find((c) => c.type === 'space_voice')!;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Threads' }).expect(201))
      .body as SpaceDetail;
    invite = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const u of [bob, carol])
      await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(() => t.close());
  beforeEach(() => resetThreadFanout());

  async function send(user: TestUser, chatId: string, text: string) {
    return t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId: Math.random().toString(36), type: 'text', text });
  }

  async function createThread(user: TestUser, chatId: string, body: object, status = 201) {
    const res = await t.api(user).post(`/api/chats/${chatId}/threads`).send(body).expect(status);
    await spaceRegistryIdle();
    return res.body as ChatSummary;
  }

  const summary = async (user: TestUser, chatId: string) =>
    (await t.api(user).get(`/api/chats/${chatId}`).expect(200)).body as ChatSummary;

  let plans: ChatSummary;
  let starter: Message;

  it('starts a thread from a message: thread:upsert to the channel, the starter carries it, one per message', async () => {
    starter = (await send(owner, general().id, 'shall we plan?')).body as Message;
    const sb = await t.connect(bob);
    const upsert = waitForEvent(sb, 'thread:upsert');
    const updated = waitForEvent(sb, 'message:updated', {
      filter: (p) => p.message.id === starter.id,
    });
    plans = await createThread(owner, general().id, { name: 'Plans', messageId: starter.id });
    expect(plans).toMatchObject({
      type: 'space_thread',
      name: 'Plans',
      space: { spaceId: detail.space.id },
      thread: {
        parentId: general().id,
        starterMessageId: starter.id,
        ownerId: owner.id,
        archived: false,
        locked: false,
        autoArchiveMinutes: 4320,
        messageCount: 0,
      },
    });
    expect(plans.permissions.canSend).toBe(true);
    const evt = await upsert;
    expect(evt.thread).toMatchObject({ id: plans.id, unreadCount: 0, spacePermissions: 0 });
    expect(evt.thread.thread?.parentId).toBe(general().id);
    expect((await updated).message.thread).toMatchObject({ id: plans.id, name: 'Plans', messageCount: 0 });

    const page = (await t.api(bob).get(`/api/chats/${general().id}/messages`).expect(200))
      .body as MessagePage;
    expect(page.messages.find((m) => m.id === starter.id)?.thread).toMatchObject({
      id: plans.id,
      archived: false,
    });
    // Any member who sees the channel gets the thread by id, `thread` set (Inbox jumps use it).
    const byId = await summary(bob, plans.id);
    expect(byId).toMatchObject({ type: 'space_thread', thread: { parentId: general().id } });
    expect(byId.permissions.canSend).toBe(true);
    await t
      .api(bob)
      .post(`/api/chats/${general().id}/threads`)
      .send({ name: 'Again', messageId: starter.id })
      .expect(409);
    sb.disconnect();
  });

  it('starts a thread without a message; only in text channels, never from another channel’s message', async () => {
    const free = await createThread(bob, general().id, { name: 'Free talk', autoArchiveMinutes: 60 });
    expect(free.thread).toMatchObject({ starterMessageId: null, ownerId: bob.id, autoArchiveMinutes: 60 });
    await t.api(bob).post(`/api/chats/${voice().id}/threads`).send({ name: 'x' }).expect(400);
    const inThread = (await send(bob, free.id, 'in a thread')).body as Message;
    await t
      .api(bob)
      .post(`/api/chats/${general().id}/threads`)
      .send({ name: 'x', messageId: inThread.id })
      .expect(404);
    await t.api(bob).post(`/api/chats/${general().id}/threads`).send({ name: '' }).expect(400);
  });

  it('messages: delivered through the thread room, counted, listed, read like a channel', async () => {
    const so = await t.connect(owner);
    const got = waitForEvent(so, 'message:new', { filter: (p) => p.message.chatId === plans.id });
    const counted = waitForEvent(so, 'thread:upsert', {
      filter: (p) => p.thread.id === plans.id && p.thread.thread?.messageCount === 1,
    });
    const res = await send(bob, plans.id, 'first!');
    expect(res.status).toBe(201);
    expect((await got).message.text).toBe('first!');
    await counted;

    const page = (await t.api(owner).get(`/api/chats/${plans.id}/messages`).expect(200))
      .body as MessagePage;
    expect(page.messages.map((m) => m.text)).toEqual(['first!']);
    const mine = await summary(owner, plans.id);
    expect(mine.thread?.messageCount).toBe(1);
    expect(mine.unreadCount).toBe(1);
    await t
      .api(owner)
      .post(`/api/chats/${plans.id}/read`)
      .send({ seq: page.messages[0]!.seq })
      .expect(204);
    expect((await summary(owner, plans.id)).unreadCount).toBe(0);
    const parent = (await t.api(owner).get(`/api/chats/${general().id}/messages`).expect(200))
      .body as MessagePage;
    expect(parent.messages.find((m) => m.id === starter.id)?.thread?.messageCount).toBe(1);
    so.disconnect();
  });

  it('GET /api/chats never lists threads; the Space channel list carries the active ones', async () => {
    // Bob has a read row in two threads by now (he sent in them).
    const list = (await t.api(bob).get('/api/chats').expect(200)).body as ChatSummary[];
    expect(list.some((c) => c.type === 'space_thread')).toBe(false);
    const channels = (await t.api(bob).get(`/api/spaces/${detail.space.id}/channels`).expect(200))
      .body as ChatSummary[];
    expect(channels.filter((c) => c.type === 'space_thread').map((c) => c.id)).toContain(plans.id);
  });

  it('lists active threads by last activity, keyset-paged; archived ones apart', async () => {
    const all = (await t.api(bob).get(`/api/chats/${general().id}/threads`).expect(200))
      .body as ThreadsPage;
    expect(all.threads.map((c) => c.name)).toEqual(['Plans', 'Free talk']);
    expect(all.nextCursor).toBeNull();
    const first = (await t.api(bob).get(`/api/chats/${general().id}/threads?limit=1`).expect(200))
      .body as ThreadsPage;
    expect(first.threads.map((c) => c.name)).toEqual(['Plans']);
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await t
        .api(bob)
        .get(`/api/chats/${general().id}/threads`)
        .query({ limit: 1, before: first.nextCursor })
        .expect(200)
    ).body as ThreadsPage;
    expect(second.threads.map((c) => c.name)).toEqual(['Free talk']);
    expect(second.nextCursor).toBeNull();
    const archived = (
      await t.api(bob).get(`/api/chats/${general().id}/threads?archived=true`).expect(200)
    ).body as ThreadsPage;
    expect(archived.threads).toEqual([]);
  });

  it('a private channel hides its threads from members who cannot see it (REST and socket)', async () => {
    const staff = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/roles`).send({ name: 'Staff' }).expect(201)
    ).body as SpaceRole;
    const secret = (
      await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/channels`)
        .send({ type: 'space_text', name: 'staff', privateRoleIds: [staff.id] })
        .expect(201)
    ).body as ChatSummary;
    await t
      .api(owner)
      .put(`/api/spaces/${detail.space.id}/members/${bob.id}/roles/${staff.id}`)
      .expect(200);
    await spaceRegistryIdle();
    const sb = await t.connect(bob);
    const sc = await t.connect(carol);
    const toBob = waitForEvent(sb, 'thread:upsert');
    const notCarol = expectNoEvent(sc, 'thread:upsert', 400);
    const hidden = await createThread(owner, secret.id, { name: 'Hidden' });
    await toBob;
    await notCarol;

    // The summary takes the PARENT's overwrites: staff see it, Carol does not.
    expect((await summary(bob, hidden.id)).thread?.parentId).toBe(secret.id);
    await t.api(carol).get(`/api/chats/${hidden.id}`).expect(404);
    await t.api(carol).get(`/api/chats/${hidden.id}/messages`).expect(404);
    await t.api(carol).get(`/api/chats/${secret.id}/threads`).expect(404);
    expect((await send(carol, hidden.id, 'let me in')).status).toBe(404);
    const carolChannels = (
      await t.api(carol).get(`/api/spaces/${detail.space.id}/channels`).expect(200)
    ).body as ChatSummary[];
    expect(carolChannels.some((c) => c.id === hidden.id)).toBe(false);

    const bobGets = waitForEvent(sb, 'message:new', { filter: (p) => p.message.chatId === hidden.id });
    const carolQuiet = expectNoEvent(sc, 'message:new', 400);
    expect((await send(owner, hidden.id, 'staff only')).status).toBe(201);
    await bobGets;
    await carolQuiet;
    sb.disconnect();
    sc.disconnect();
  });

  it('archive by the creator; a message revives it (thread:upsert first, then the message)', async () => {
    const sb = await t.connect(bob);
    const archivedEvt = waitForEvent(sb, 'thread:upsert', {
      filter: (p) => p.thread.id === plans.id && !!p.thread.thread?.archived,
    });
    const res = await t.api(owner).patch(`/api/threads/${plans.id}`).send({ archived: true }).expect(200);
    expect((res.body as ChatSummary).thread?.archived).toBe(true);
    await archivedEvt;
    const archived = (
      await t.api(bob).get(`/api/chats/${general().id}/threads?archived=true`).expect(200)
    ).body as ThreadsPage;
    expect(archived.threads.map((c) => c.id)).toEqual([plans.id]);
    const active = (await t.api(bob).get(`/api/chats/${general().id}/threads`).expect(200))
      .body as ThreadsPage;
    expect(active.threads.some((c) => c.id === plans.id)).toBe(false);

    const order: string[] = [];
    sb.on('thread:upsert', (p) => {
      if (p.thread.id === plans.id && !p.thread.thread?.archived) order.push('upsert');
    });
    const msg = waitForEvent(sb, 'message:new', { filter: (p) => p.message.chatId === plans.id });
    expect((await send(owner, plans.id, 'back to it')).status).toBe(201);
    await msg;
    order.push('message');
    await spaceRegistryIdle();
    expect(order[0]).toBe('upsert');
    expect((await summary(bob, plans.id)).thread?.archived).toBe(false);
    sb.disconnect();
  });

  it('lock: moderators only; a locked thread takes messages from moderators only', async () => {
    await t.api(bob).patch(`/api/threads/${plans.id}`).send({ locked: true }).expect(403);
    await t.api(owner).patch(`/api/threads/${plans.id}`).send({ locked: true }).expect(200);
    const bobView = await summary(bob, plans.id);
    expect(bobView.thread?.locked).toBe(true);
    expect(bobView.permissions.canSend).toBe(false);
    expect((await send(bob, plans.id, 'can I?')).status).toBe(403);
    expect((await send(owner, plans.id, 'mods can')).status).toBe(201);
    await t.api(owner).patch(`/api/threads/${plans.id}`).send({ locked: false }).expect(200);
    expect((await send(bob, plans.id, 'thanks')).status).toBe(201);
  });

  it('rename: the creator may, another member may not', async () => {
    const own = await createThread(bob, general().id, { name: 'Bob’s' });
    const renamed = (
      await t.api(bob).patch(`/api/threads/${own.id}`).send({ name: 'Bob renamed' }).expect(200)
    ).body as ChatSummary;
    expect(renamed.name).toBe('Bob renamed');
    await t.api(carol).patch(`/api/threads/${own.id}`).send({ name: 'Carol was here' }).expect(403);
    await t.api(carol).patch(`/api/threads/${own.id}`).send({ archived: true }).expect(403);
    expect((await summary(carol, own.id)).name).toBe('Bob renamed');
  });

  it('delete: members cannot; a moderator deletes it and the channel hears thread:deleted', async () => {
    const doomed = await createThread(bob, general().id, { name: 'Doomed' });
    expect((await send(bob, doomed.id, 'bye')).status).toBe(201);
    await t.api(bob).delete(`/api/threads/${doomed.id}`).expect(403);
    const sc = await t.connect(carol);
    const gone = waitForEvent(sc, 'thread:deleted', { filter: (p) => p.threadId === doomed.id });
    await t.api(owner).delete(`/api/threads/${doomed.id}`).expect(204);
    expect(await gone).toEqual({ threadId: doomed.id, parentId: general().id });
    await t.api(bob).get(`/api/chats/${doomed.id}`).expect(404);
    await t.api(bob).get(`/api/chats/${doomed.id}/messages`).expect(404);
    sc.disconnect();
  });

  it('auto-archive: the job archives threads idle past their delay and announces them', async () => {
    const idle = await createThread(bob, general().id, { name: 'Idle', autoArchiveMinutes: 60 });
    const busy = await createThread(bob, general().id, { name: 'Busy', autoArchiveMinutes: 60 });
    const longAgo = sql`now() - interval '2 hours'`;
    await db.update(chats).set({ lastMessageAt: longAgo, updatedAt: longAgo }).where(eq(chats.id, idle.id));
    const sb = await t.connect(bob);
    const evt = waitForEvent(sb, 'thread:upsert', {
      filter: (p) => p.thread.id === idle.id && !!p.thread.thread?.archived,
    });
    expect(await archiveIdleThreads()).toBeGreaterThanOrEqual(1);
    await evt;
    expect((await summary(bob, idle.id)).thread?.archived).toBe(true);
    expect((await summary(bob, busy.id)).thread?.archived).toBe(false);
    // Nothing left to do on the next run.
    expect(await archiveIdleThreads()).toBe(0);
    sb.disconnect();
  });
});
