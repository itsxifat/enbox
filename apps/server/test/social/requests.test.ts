/**
 * Message requests and DM privacy (W7-C): the DM gate (friends, contacts, shared Spaces with
 * DMs allowed or not, each `whoCanDm`, `messageRequests` off), requests hidden from `GET
 * /chats` with no push, no `chat:upsert` and no receipts but `chat:request`; accept, ignore,
 * replying and becoming friends; legacy chats, self chats and blocks.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type {
  ChatSummary,
  Message,
  MessagePage,
  PushPayload,
  Space,
  SpaceDetail,
  SpaceInvite,
  UserSettings,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { chats } from '../../src/db/schema.js';
import { pushIdle, setPushSender } from '../../src/modules/push/sender.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { ackError } from '../calls/helpers.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';
import { openDirect, sendOk, sendReq } from '../messaging/support.js';
import { memberRow, recordEvents, saveContact, settle } from '../services/fixtures.js';

describe('message requests', () => {
  let t: TestServer;
  let pushes: { endpoint: string; payload: PushPayload }[];
  let endpoints = 0;

  beforeAll(async () => {
    t = await startTestServer();
    // Off by default in tests (config.ts): every other suite DMs fresh users.
    config.messageRequests = true;
    setPushSender(
      async (target, payload) => void pushes.push({ endpoint: target.endpoint, payload }),
    );
  });
  afterAll(async () => {
    config.messageRequests = false;
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    pushes = [];
  });

  const user = (displayName?: string) => t.createUser(displayName ? { displayName } : {});
  const settings = (u: TestUser, patch: Partial<UserSettings>) =>
    t.api(u).patch('/api/me/settings').send(patch).expect(200);
  const chatIds = async (u: TestUser) =>
    ((await t.api(u).get('/api/chats').expect(200)).body as ChatSummary[]).map((c) => c.id);
  const requests = async (u: TestUser, state?: 'ignored') =>
    (
      await t
        .api(u)
        .get(`/api/chats/requests${state ? `?state=${state}` : ''}`)
        .expect(200)
    ).body as ChatSummary[];
  const accept = (u: TestUser, chatId: string) =>
    t.api(u).post(`/api/chats/${chatId}/request/accept`);
  const ignore = (u: TestUser, chatId: string) =>
    t.api(u).post(`/api/chats/${chatId}/request/ignore`);
  const relevant = (names: string[]) => names.filter((n) => n !== 'presence:update');

  async function subscribe(u: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/requests-${++endpoints}`;
    await t
      .api(u)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }

  async function befriend(a: TestUser, b: TestUser) {
    await t.api(a).post('/api/friends/requests').send({ userId: b.id }).expect(200);
    await t.api(b).post(`/api/friends/requests/${a.id}/accept`).expect(204);
  }

  /** `owner` makes a Space and the others join it with an invite. */
  async function shareSpace(owner: TestUser, ...members: TestUser[]): Promise<string> {
    const detail = (await t.api(owner).post('/api/spaces').send({ name: 'Shared' }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const m of members) await t.api(m).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
    return detail.space.id;
  }

  /** `from` writes to `to` for the first time; returns the chat id and the message. */
  async function firstDm(from: TestUser, to: TestUser, text = 'hi there') {
    const chat = await openDirect(t, from, to);
    const message = await sendOk(t, from, chat.id, text);
    return { chatId: chat.id, message };
  }

  describe('the gate', () => {
    it("a stranger's first message waits in Message Requests: hidden, no chat:upsert or push, chat:request instead", async () => {
      const ann = await user('Ann');
      const bob = await user('Bob');
      await subscribe(bob);
      const sBob = await t.connect(bob);
      const log = recordEvents(sBob);

      const { chatId, message } = await firstDm(ann, bob, 'hello stranger');
      await settle();
      expect(relevant(log.names())).toEqual(['chat:request']);
      const [{ chat }] = log.of('chat:request') as [{ chat: ChatSummary }];
      expect(chat).toMatchObject({
        id: chatId,
        request: 'pending',
        peer: { id: ann.id, displayName: 'Ann' },
        lastMessage: { id: message.id, text: 'hello stranger' },
      });

      expect(await chatIds(bob)).not.toContain(chatId);
      await t.api(bob).get(`/api/chats/${chatId}`).expect(404);
      expect((await requests(bob)).map((c) => [c.id, c.request, c.lastMessage?.id])).toEqual([
        [chatId, 'pending', message.id],
      ]);
      // Readable all the same (the request view shows the conversation).
      const page = (await t.api(bob).get(`/api/chats/${chatId}/messages`).expect(200))
        .body as MessagePage;
      expect(page.messages.map((m) => m.text)).toEqual(['hello stranger']);

      await pushIdle();
      expect(pushes).toEqual([]);
      const row = await memberRow(chatId, bob);
      expect(row).toMatchObject({ hidden: true, requestState: 'pending', lastDeliveredSeq: 0 });
      // The sender sees an ordinary chat, sent but not delivered.
      const mine = (await t.api(ann).get(`/api/chats/${chatId}`).expect(200)).body as ChatSummary;
      expect(mine.request).toBeUndefined();
      expect(mine.deliveredWatermark).toBeLessThan(message.seq);
      expect(await requests(ann)).toEqual([]);
    });

    it('friends, and people who saved me as a contact, are let straight in', async () => {
      const ann = await user();
      const bob = await user();
      const cy = await user();
      await befriend(ann, bob);
      const sBob = await t.connect(bob);
      const upsert = waitForEvent(sBob, 'chat:upsert');
      const friendly = await firstDm(ann, bob);
      expect((await upsert).chat).toMatchObject({ id: friendly.chatId });
      expect((await upsert).chat.request).toBeUndefined();
      expect(await chatIds(bob)).toContain(friendly.chatId);

      await saveContact(bob, cy); // Bob saved Cy: Cy is in
      const saved = await firstDm(cy, bob);
      expect(await chatIds(bob)).toContain(saved.chatId);
      expect(await requests(bob)).toEqual([]);

      // Only their saving counts: Ann saving Dee doesn't let Ann in with Dee.
      const dee = await user();
      await saveContact(ann, dee);
      const oneWay = await firstDm(ann, dee);
      expect(await chatIds(dee)).not.toContain(oneWay.chatId);
      expect((await requests(dee)).map((c) => c.id)).toEqual([oneWay.chatId]);
    });

    it("'friends' refuses everyone else with 403 dm_not_allowed, opening and writing alike", async () => {
      const ann = await user();
      const bob = await user();
      const cy = await user();
      const pal = await user();
      await befriend(pal, bob);
      // Opened before Bob tightened his settings: opening it again works, writing doesn't.
      const early = await openDirect(t, ann, bob);
      await settings(bob, { whoCanDm: 'friends' });

      const res = await t.api(cy).post('/api/chats/direct').send({ userId: bob.id }).expect(403);
      expect(res.body.error).toEqual({
        code: 'dm_not_allowed',
        message: "You can't send messages to this person",
      });
      expect((await openDirect(t, ann, bob)).id).toBe(early.id);
      const refused = await sendReq(t, ann, early.id, { text: 'anyone there?' }).expect(403);
      expect(refused.body.error.code).toBe('dm_not_allowed');
      const [chat] = await db.select().from(chats).where(eq(chats.id, early.id));
      expect(Number(chat!.lastSeq)).toBe(0); // nothing written

      const ok = await firstDm(pal, bob);
      expect(await chatIds(bob)).toContain(ok.chatId);
    });

    it("'spaces' lets in members of a Space we share where I allow DMs; 'everyone' anyone", async () => {
      const bob = await user();
      const ann = await user();
      const cy = await user();
      const stranger = await user();
      await settings(bob, { whoCanDm: 'spaces' });
      await t.api(ann).post('/api/chats/direct').send({ userId: bob.id }).expect(403);

      const spaceId = await shareSpace(bob, ann, cy);
      const fromAnn = await firstDm(ann, bob);
      expect((await requests(bob)).map((c) => c.id)).toEqual([fromAnn.chatId]);
      await t.api(stranger).post('/api/chats/direct').send({ userId: bob.id }).expect(403);

      // Space menu ▸ Privacy Settings: no DMs from this Space's members.
      const space = (
        await t
          .api(bob)
          .patch(`/api/spaces/${spaceId}/members/me`)
          .send({ allowDms: false })
          .expect(200)
      ).body as Space;
      expect(space.me.allowDms).toBe(false);
      const refused = await t
        .api(cy)
        .post('/api/chats/direct')
        .send({ userId: bob.id })
        .expect(403);
      expect(refused.body.error.code).toBe('dm_not_allowed');
      // The request already there may still be answered, but Ann can't add to it.
      await sendReq(t, ann, fromAnn.chatId, { text: 'still me' }).expect(403);

      await settings(bob, { whoCanDm: 'everyone' });
      const fromCy = await firstDm(cy, bob);
      const fromStranger = await firstDm(stranger, bob);
      expect((await requests(bob)).map((c) => c.id).sort()).toEqual(
        [fromAnn.chatId, fromCy.chatId, fromStranger.chatId].sort(),
      );
    });

    it('with messageRequests off, a DM from someone allowed is an ordinary chat at once', async () => {
      const ann = await user();
      const bob = await user();
      await settings(bob, { messageRequests: false });
      await subscribe(bob);
      const sBob = await t.connect(bob);
      const upsert = waitForEvent(sBob, 'chat:upsert');
      const { chatId } = await firstDm(ann, bob);
      expect((await upsert).chat.id).toBe(chatId);
      expect(await chatIds(bob)).toContain(chatId);
      expect(await requests(bob)).toEqual([]);
      await pushIdle();
      expect(pushes).toHaveLength(1);
      // Who may DM me still applies.
      await settings(bob, { whoCanDm: 'friends' });
      const cy = await user();
      await t.api(cy).post('/api/chats/direct').send({ userId: bob.id }).expect(403);
    });

    it("new Space memberships take 'Allow DMs from new Spaces' members'", async () => {
      const owner = await user();
      const shy = await user();
      const open = await user();
      await settings(shy, { allowSpaceDms: false });
      const spaceId = await shareSpace(owner, shy, open);
      const meOf = async (u: TestUser) =>
        ((await t.api(u).get(`/api/spaces/${spaceId}`).expect(200)).body as SpaceDetail).space.me;
      expect((await meOf(shy)).allowDms).toBe(false);
      expect((await meOf(open)).allowDms).toBe(true);
      expect((await meOf(owner)).allowDms).toBe(true);

      await settings(shy, { whoCanDm: 'spaces' });
      await t.api(open).post('/api/chats/direct').send({ userId: shy.id }).expect(403);
    });

    it('legacy chats with history either way, and my own chat, are never gated', async () => {
      const ann = await user();
      const bob = await user();
      config.messageRequests = false; // a conversation from before message requests
      const { chatId } = await firstDm(ann, bob, 'old times');
      await sendOk(t, bob, chatId, 'indeed');
      config.messageRequests = true;

      await settings(bob, { whoCanDm: 'friends' });
      await sendOk(t, ann, chatId, 'still allowed');
      // Bob deleted it for himself: a new message brings it back, not as a request.
      await t.api(bob).delete(`/api/chats/${chatId}`).expect(204);
      const sBob = await t.connect(bob);
      const upsert = waitForEvent(sBob, 'chat:upsert');
      await sendOk(t, ann, chatId, 'back again');
      expect((await upsert).chat).toMatchObject({ id: chatId });
      expect((await upsert).chat.request).toBeUndefined();
      expect(await requests(bob)).toEqual([]);

      const self = await openDirect(t, bob, bob);
      await sendOk(t, bob, self.id, 'note to self');
      expect(await chatIds(bob)).toContain(self.id);
    });

    it('blocks keep working: a blocked stranger gets the same answer and nothing reaches me', async () => {
      const ann = await user();
      const bob = await user();
      await t.api(bob).put(`/api/blocks/${ann.id}`).expect(204);
      const sBob = await t.connect(bob);
      const log = recordEvents(sBob);
      const { chatId } = await firstDm(ann, bob, 'withheld');
      await settle();
      expect(relevant(log.names())).toEqual([]);
      expect(await requests(bob)).toEqual([]);
      expect(await memberRow(chatId, bob)).toMatchObject({ hidden: true, requestState: null });

      // Unblocked, the next message is a request (the withheld one is no history).
      await t.api(bob).delete(`/api/blocks/${ann.id}`).expect(204);
      const request = waitForEvent(sBob, 'chat:request');
      const next = await sendOk(t, ann, chatId, 'second try');
      expect((await request).chat).toMatchObject({ id: chatId, lastMessage: { id: next.id } });

      // Blocked again: Bob's list drops it, and the policy answers alike either way.
      await t.api(bob).put(`/api/blocks/${ann.id}`).expect(204);
      expect(await requests(bob)).toEqual([]);
      await settings(bob, { whoCanDm: 'friends' });
      expect((await sendReq(t, ann, chatId, { text: 'x' }).expect(403)).body.error.code).toBe(
        'dm_not_allowed',
      );
    });

    it('calls need an accepted chat', async () => {
      const ann = await user();
      const bob = await user();
      const { chatId } = await firstDm(ann, bob);
      const sAnn = await t.connect(ann);
      const error = await ackError(sAnn, 'call:start', { chatId, type: 'audio' });
      expect(error).toMatchObject({
        code: 'dm_not_allowed',
        message: "You can't call this person",
      });
    });
  });

  describe('answering a request', () => {
    it('accept: into my list with chat:upsert, chat:request-removed and chat:read; delivered moves on', async () => {
      const ann = await user();
      const bob = await user();
      const { chatId } = await firstDm(ann, bob, 'one');
      const two = await sendOk(t, ann, chatId, 'two');
      const sAnn = await t.connect(ann);
      const sBob = await t.connect(bob);
      const log = recordEvents(sBob);
      const delivered = waitForEvent(sAnn, 'chat:watermarks', {
        filter: (w) => w.chatId === chatId && w.deliveredWatermark >= two.seq,
      });

      const res = await accept(bob, chatId).expect(200);
      const chat = res.body as ChatSummary;
      expect(chat).toMatchObject({ id: chatId, unreadCount: 2, membership: 'active' });
      expect(chat.request).toBeUndefined();
      await delivered;
      await settle();
      expect(relevant(log.names())).toEqual(['chat:upsert', 'chat:request-removed', 'chat:read']);
      expect(log.of('chat:request-removed')).toEqual([{ chatId }]);
      expect(await chatIds(bob)).toContain(chatId);
      expect(await requests(bob)).toEqual([]);

      // Now an ordinary chat: in the room, and pushes again.
      await subscribe(bob);
      const incoming = waitForEvent(sBob, 'message:new');
      await sendOk(t, ann, chatId, 'three');
      expect((await incoming).message.text).toBe('three');
      await pushIdle();
      expect(pushes).toHaveLength(1);

      log.clear();
      await accept(bob, chatId).expect(200); // again (another device was first): no events
      await settle();
      expect(relevant(log.names())).toEqual([]);
      await accept(ann, chatId).expect(200); // an ordinary chat of mine: nothing to do
      const cy = await user();
      await accept(cy, chatId).expect(404);
      await ignore(cy, chatId).expect(404);
      await ignore(bob, chatId).expect(404); // an ordinary chat is no request
    });

    it("ignore: into Ignored, still hidden; later messages stay quiet and the sender isn't told", async () => {
      const ann = await user();
      const bob = await user();
      await subscribe(bob);
      const { chatId } = await firstDm(ann, bob);
      const sBob = await t.connect(bob);
      const removed = waitForEvent(sBob, 'chat:request-removed');
      await ignore(bob, chatId).expect(204);
      expect(await removed).toEqual({ chatId });
      expect(await requests(bob)).toEqual([]);
      expect((await requests(bob, 'ignored')).map((c) => [c.id, c.request])).toEqual([
        [chatId, 'ignored'],
      ]);

      const log = recordEvents(sBob);
      const later = await sendReq(t, ann, chatId, { text: 'hello??' }).expect(201);
      expect((later.body as Message).text).toBe('hello??');
      await settle();
      expect(relevant(log.names())).toEqual([]);
      await pushIdle();
      expect(pushes).toEqual([]);
      expect(await chatIds(bob)).not.toContain(chatId);
      expect(await memberRow(chatId, bob)).toMatchObject({ requestState: 'ignored', hidden: true });
      await ignore(bob, chatId).expect(204); // idempotent

      // Changed my mind: accept it from Ignored.
      await accept(bob, chatId).expect(200);
      expect(await chatIds(bob)).toContain(chatId);
      expect(await requests(bob, 'ignored')).toEqual([]);
    });

    it('replying accepts the request', async () => {
      const ann = await user();
      const bob = await user();
      const { chatId, message } = await firstDm(ann, bob);
      const sBob = await t.connect(bob);
      const sAnn = await t.connect(ann);
      const log = recordEvents(sBob);
      const read = waitForEvent(sAnn, 'chat:watermarks', {
        filter: (w) => w.chatId === chatId && w.readWatermark >= message.seq,
      });
      const reply = await sendOk(t, bob, chatId, 'hi back');
      await read;
      await settle();
      // In the list first, then out of Requests; then my message as in any chat (Ann is
      // online: delivered at once).
      expect(relevant(log.names())).toEqual([
        'chat:upsert',
        'chat:request-removed',
        'message:new',
        'chat:read',
        'chat:watermarks',
      ]);
      expect(log.of('message:new')[0]!.message.id).toBe(reply.id);
      expect(await chatIds(bob)).toContain(chatId);
      expect(await requests(bob)).toEqual([]);
      expect(await memberRow(chatId, bob)).toMatchObject({ requestState: null, hidden: false });
    });

    it('becoming friends accepts the requests between us (pending or ignored)', async () => {
      const ann = await user();
      const bob = await user();
      const cy = await user();
      const pending = await firstDm(ann, bob);
      const ignored = await firstDm(cy, bob);
      await ignore(bob, ignored.chatId).expect(204);
      const sBob = await t.connect(bob);
      const log = recordEvents(sBob);

      await befriend(ann, bob);
      await befriend(bob, cy);
      await settle();
      expect(log.of('chat:request-removed')).toEqual([
        { chatId: pending.chatId },
        { chatId: ignored.chatId },
      ]);
      expect(log.of('chat:upsert').map((e) => e.chat.id)).toEqual([pending.chatId, ignored.chatId]);
      const listed = await chatIds(bob);
      expect(listed).toEqual(expect.arrayContaining([pending.chatId, ignored.chatId]));
      expect(await requests(bob)).toEqual([]);
      expect(await requests(bob, 'ignored')).toEqual([]);
    });

    it("receipts don't move while it waits: not on send, connect or read; my typing isn't relayed", async () => {
      const ann = await user();
      const bob = await user();
      const sBob1 = await t.connect(bob);
      const { chatId, message } = await firstDm(ann, bob);
      const sAnn = await t.connect(ann);
      const sBob2: TestSocket = await t.connect(bob); // a connect delivers my other chats
      expect(sBob1.connected && sBob2.connected).toBe(true);
      await t.api(bob).post(`/api/chats/${chatId}/read`).send({ seq: message.seq }).expect(404);
      expect(await memberRow(chatId, bob)).toMatchObject({ lastDeliveredSeq: 0, lastReadSeq: 0 });
      const mine = (await t.api(ann).get(`/api/chats/${chatId}`).expect(200)).body as ChatSummary;
      expect(mine).toMatchObject({ readWatermark: 0, deliveredWatermark: 0 });

      sBob2.emit('chat:typing', { chatId, state: 'typing' });
      await expectNoEvent(sAnn, 'chat:typing');
    });

    it('more messages refresh the request; opening it myself keeps it a request', async () => {
      const ann = await user();
      const bob = await user();
      const sBob = await t.connect(bob);
      const { chatId } = await firstDm(ann, bob, 'first');
      const next = waitForEvent(sBob, 'chat:request', {
        filter: (p) => p.chat.lastMessage?.text === 'second',
      });
      await sendOk(t, ann, chatId, 'second');
      expect((await next).chat).toMatchObject({ id: chatId, request: 'pending' });

      const log = recordEvents(sBob);
      const opened = (
        await t.api(bob).post('/api/chats/direct').send({ userId: ann.id }).expect(200)
      ).body as ChatSummary;
      expect(opened).toMatchObject({
        id: chatId,
        request: 'pending',
        lastMessage: { text: 'second' },
      });
      await settle();
      expect(relevant(log.names())).toEqual([]);
      expect(await chatIds(bob)).not.toContain(chatId);
    });
  });
});
