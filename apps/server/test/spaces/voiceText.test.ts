/**
 * Text chat in voice and Stage channels (docs/design/discord-parity.md W8-F "Text in Voice"):
 * members send, react, edit and pin there through the usual routes (no voice connection
 * needed; Stage audiences too), SEND_MESSAGES overwrites and slowmode apply, typing reaches
 * the devices that have the channel open, search finds the messages, the channel's and the
 * Space's unread and mention counts include them, and a push reads "🔊 name · Space".
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  PERM,
  mentionToken,
  type ChatSummary,
  type Message,
  type MessageSearchPage,
  type PushPayload,
  type Space,
  type SpaceDetail,
  type SpaceInvite,
} from '@enbox/shared';
import { pushIdle, setPushSender } from '../../src/modules/push/sender.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  emitAck,
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { sendOk, sendReq } from '../messaging/support.js';

const enc = encodeURIComponent;

describe('text chat in voice and Stage channels', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let stage: ChatSummary;
  const spaceId = () => detail.space.id;
  const voice = () => detail.channels.find((c) => c.type === 'space_voice')!;
  const everyone = () => detail.space.roles.find((r) => r.isDefault)!;
  const channel = async (u: TestUser, chatId: string) =>
    (await t.api(u).get(`/api/chats/${chatId}`).expect(200)).body as ChatSummary;
  const mySpace = async (u: TestUser) =>
    ((await t.api(u).get('/api/spaces').expect(200)).body as Space[]).find((s) => s.id === spaceId())!;
  const history = async (u: TestUser, chatId: string) =>
    ((await t.api(u).get(`/api/chats/${chatId}/messages`).expect(200)).body as { messages: Message[] })
      .messages;
  const search = (u: TestUser, params: Record<string, string>) =>
    t.api(u).get(`/api/spaces/${spaceId()}/messages/search?${new URLSearchParams(params)}`);
  const patchChannel = (chatId: string, body: Record<string, unknown>) =>
    t.api(owner).patch(`/api/spaces/${spaceId()}/channels/${chatId}`).send(body);

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Lounge Lab' }).expect(201))
      .body as SpaceDetail;
    stage = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_stage', name: 'Town Hall', topic: 'Weekly' })
        .expect(201)
    ).body as ChatSummary;
    const invite = (await t.api(owner).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    for (const u of [bob, carol]) await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(() => t.close());

  it('members can send in voice and Stage channels without connecting; others receive it', async () => {
    for (const id of [voice().id, stage.id]) {
      const c = await channel(bob, id);
      expect(c.permissions.canSend).toBe(true);
      expect(c.spacePermissions! & PERM.SEND_MESSAGES).toBe(PERM.SEND_MESSAGES);
    }
    const sc = await t.connect(carol);
    const got = waitForEvent(sc, 'message:new', { filter: (p) => p.message.chatId === voice().id });
    const m = await sendOk(t, bob, voice().id, 'anyone up for a game?');
    expect((await got).message.id).toBe(m.id);
    sc.disconnect();
    // A Stage's audience chats too (Discord's default): nobody here is on the Stage.
    const s = await sendOk(t, carol, stage.id, 'great talk');
    expect((await history(bob, stage.id)).map((x) => x.id)).toContain(s.id);
  });

  it('reactions, edits and pins work there; MANAGE_MESSAGES pins', async () => {
    const m = await sendOk(t, bob, voice().id, 'pin me');
    await t.api(carol).put(`/api/messages/${m.id}/reactions/${enc('🎉')}/@me`).expect(204);
    const edited = await t.api(bob).patch(`/api/messages/${m.id}`).send({ text: 'pin me please' });
    expect(edited.status).toBe(200);
    expect((edited.body as Message).text).toBe('pin me please');
    // @everyone has no MANAGE_MESSAGES; the owner does.
    expect((await channel(bob, voice().id)).permissions.canPin).toBe(false);
    await t.api(bob).post(`/api/chats/${voice().id}/pins`).send({ messageId: m.id }).expect(403);
    expect((await channel(owner, voice().id)).permissions.canPin).toBe(true);
    const pins = (await t.api(owner).post(`/api/chats/${voice().id}/pins`).send({ messageId: m.id }))
      .body as Message[];
    expect(pins.map((p) => p.id)).toEqual([m.id]);
    const seen = (await history(carol, voice().id)).find((x) => x.id === m.id)!;
    expect(seen.reactions).toEqual([{ emoji: '🎉', count: 1, userIds: [] }]);
    // Stage messages update in place too.
    const s = await sendOk(t, carol, stage.id, 'question');
    const sb = await t.connect(bob);
    const updated = waitForEvent(sb, 'message:updated', { filter: (p) => p.message.id === s.id });
    await t.api(carol).patch(`/api/messages/${s.id}`).send({ text: 'a better question' }).expect(200);
    expect((await updated).message.text).toBe('a better question');
    sb.disconnect();
  });

  it('a SEND_MESSAGES deny stops sending, reacting stays; the voice bits are untouched', async () => {
    const path = `/api/spaces/${spaceId()}/channels/${voice().id}/overwrites/role/${everyone().id}`;
    await t.api(owner).put(path).send({ allow: 0, deny: PERM.SEND_MESSAGES }).expect(200);
    await spaceRegistryIdle();
    try {
      const c = await channel(bob, voice().id);
      expect(c.permissions.canSend).toBe(false);
      expect(c.spacePermissions! & PERM.CONNECT).toBe(PERM.CONNECT);
      expect((await sendReq(t, bob, voice().id, { text: 'hello?' })).status).toBe(403);
      const m = await sendOk(t, owner, voice().id, 'staff only for now');
      await t.api(bob).put(`/api/messages/${m.id}/reactions/${enc('👍')}/@me`).expect(204);
    } finally {
      await t.api(owner).delete(path).expect(200);
      await spaceRegistryIdle();
    }
  });

  it('typing in a voice chat reaches the devices that have the channel open', async () => {
    const sb = await t.connect(bob);
    const sc = await t.connect(carol);
    await emitAck(sb, 'space:focus', { chatId: voice().id });
    const toBob = waitForEvent(sb, 'chat:typing', { filter: (p) => p.chatId === voice().id });
    const notCarol = expectNoEvent(sc, 'chat:typing', 400);
    const so = await t.connect(owner);
    so.emit('chat:typing', { chatId: voice().id, state: 'typing' });
    expect((await toBob).userId).toBe(owner.id);
    await notCarol;
    // And in a Stage's chat.
    await emitAck(sb, 'space:focus', { chatId: stage.id });
    const onStage = waitForEvent(sb, 'chat:typing', { filter: (p) => p.chatId === stage.id });
    sc.emit('chat:typing', { chatId: stage.id, state: 'typing' });
    expect((await onStage).userId).toBe(carol.id);
    [sb, sc, so].forEach((s) => s.disconnect());
  });

  it('slowmode can be set on voice and Stage channels (create and edit); moderators bypass it', async () => {
    const created = (
      await t
        .api(owner)
        .post(`/api/spaces/${spaceId()}/channels`)
        .send({ type: 'space_voice', name: 'Slow Lane', slowmodeSeconds: 30 })
        .expect(201)
    ).body as ChatSummary;
    expect(created.space?.slowmodeSeconds).toBe(30);
    await spaceRegistryIdle();
    expect((await sendReq(t, bob, created.id, { text: 'first' })).status).toBe(201);
    expect((await sendReq(t, bob, created.id, { text: 'second' })).status).toBe(429);
    expect((await sendReq(t, owner, created.id, { text: 'owner bypasses' })).status).toBe(201);

    const edited = (await patchChannel(stage.id, { slowmodeSeconds: 10 }).expect(200))
      .body as ChatSummary;
    expect(edited.space?.slowmodeSeconds).toBe(10);
    try {
      expect((await sendReq(t, carol, stage.id, { text: 'one' })).status).toBe(201);
      expect((await sendReq(t, carol, stage.id, { text: 'two' })).status).toBe(429);
    } finally {
      await patchChannel(stage.id, { slowmodeSeconds: 0 }).expect(200);
    }
  });

  it('search finds voice and Stage messages, Space-wide and with in:', async () => {
    const v = await sendOk(t, bob, voice().id, 'wombat in voice');
    const s = await sendOk(t, carol, stage.id, 'wombat on stage');
    const all = (await search(carol, { q: 'wombat' }).expect(200)).body as MessageSearchPage;
    expect(all.items.map((i) => i.message.id).sort()).toEqual([v.id, s.id].sort());
    const byId = new Map(all.items.map((i) => [i.message.id, i.chat]));
    expect(byId.get(v.id)).toMatchObject({ id: voice().id, type: 'space_voice', name: 'General' });
    expect(byId.get(s.id)).toMatchObject({ id: stage.id, type: 'space_stage', name: 'Town Hall' });
    const inVoice = (await search(carol, { q: 'wombat', channelId: voice().id }).expect(200))
      .body as MessageSearchPage;
    expect(inVoice.items.map((i) => i.message.id)).toEqual([v.id]);
  });

  it('unread and mention counts include voice and Stage chats, per channel and per Space', async () => {
    // Bob reads everything first.
    await t.api(bob).post(`/api/spaces/${spaceId()}/read`).expect(204);
    expect(await mySpace(bob)).toMatchObject({ unread: false, unreadMentionCount: 0 });

    await sendOk(t, carol, voice().id, `${mentionToken(bob.id)} join us`);
    const v = await channel(bob, voice().id);
    expect([v.unreadCount, v.unreadMentionCount]).toEqual([1, 1]);
    expect(await mySpace(bob)).toMatchObject({ unread: true, unreadMentionCount: 1 });

    await t.api(bob).post(`/api/chats/${voice().id}/read`).send({ seq: v.lastSeq }).expect(204);
    expect(await mySpace(bob)).toMatchObject({ unread: false, unreadMentionCount: 0 });

    await sendOk(t, carol, stage.id, 'stage chatter');
    expect((await channel(bob, stage.id)).unreadCount).toBe(1);
    expect(await mySpace(bob)).toMatchObject({ unread: true, unreadMentionCount: 0 });
  });

  it('a push for a voice chat reads "🔊 name · Space" and opens the chat at the message', async () => {
    const sent: PushPayload[] = [];
    setPushSender(async (_target, payload) => {
      sent.push(payload);
    });
    try {
      await t
        .api(bob)
        .post('/api/push/subscriptions')
        .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/voice-text', keys: { p256dh: 'BKey', auth: 'secret' } })
        .expect(204);
      const m = await sendOk(t, carol, voice().id, `${mentionToken(bob.id)} over here`);
      await pushIdle();
      const push = sent.find((p) => p.chatId === voice().id);
      expect(push).toMatchObject({
        type: 'message',
        title: '🔊 General · Lounge Lab',
        url: `/spaces/${spaceId()}/${voice().id}?m=${m.seq}&mid=${m.id}`,
      });
      expect(push?.title).not.toContain('#');
    } finally {
      setPushSender(undefined);
    }
  });
});
