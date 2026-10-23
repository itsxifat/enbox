/**
 * @silent and the Space message limit: `silent: true` stores MESSAGE_FLAGS.SILENT (in the
 * response, history and `message:new`) and pushes nobody — DMs, groups and Space mentions —
 * while unreads and mention counts still move. Space chats (threads too) refuse text and
 * captions over SPACE_MESSAGE_MAX_LENGTH on send and edit; DMs and groups keep
 * MAX_MESSAGE_LENGTH.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  MESSAGE_FLAGS,
  SPACE_MESSAGE_MAX_LENGTH,
  hasMessageFlag,
  mentionToken,
  type ChatSummary,
  type Message,
  type PushPayload,
  type SpaceDetail,
  type SpaceInvite,
} from '@enbox/shared';
import { pushIdle, setPushSender, type PushTarget } from '../../src/modules/push/sender.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { createDirect, createGroup, saveContact } from '../services/fixtures.js';
import { historyOf, mkMedia, sendOk, sendReq, summaryOf } from './support.js';

const LIMIT_ERROR = `Messages in Spaces are limited to ${SPACE_MESSAGE_MAX_LENGTH} characters`;
const silentOf = (m: Pick<Message, 'flags'>) => hasMessageFlag(m.flags, MESSAGE_FLAGS.SILENT);

describe('@silent and the Space message limit', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let detail: SpaceDetail;
  let pushes: { endpoint: string; payload: PushPayload }[];
  let endpoints = 0;
  const general = () => detail.channels.find((c) => c.name === 'general')!;

  beforeAll(async () => {
    t = await startTestServer();
    setPushSender(async (target: PushTarget, payload: PushPayload) => {
      pushes.push({ endpoint: target.endpoint, payload });
    });
    owner = await t.createUser({ displayName: 'Owner' });
    bob = await t.createUser({ displayName: 'Bob' });
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Limits' }).expect(201))
      .body as SpaceDetail;
    const invite = (
      await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(async () => {
    setPushSender(undefined);
    await t.close();
  });
  beforeEach(() => {
    pushes = [];
  });

  async function subscribe(user: TestUser): Promise<string> {
    const endpoint = `https://fcm.googleapis.com/fcm/send/silent-${++endpoints}`;
    await t
      .api(user)
      .post('/api/push/subscriptions')
      .send({ endpoint, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
      .expect(204);
    return endpoint;
  }
  const to = (endpoint: string) => pushes.filter((p) => p.endpoint === endpoint);
  const edit = (user: TestUser, messageId: string, text: string) =>
    t.api(user).patch(`/api/messages/${messageId}`).send({ text });

  describe('@silent', () => {
    it('stores MESSAGE_FLAGS.SILENT: in the response, the history and message:new', async () => {
      const group = await createGroup(owner, [bob], { name: 'Quiet' });
      const sb = await t.connect(bob);
      const arrived = waitForEvent(sb, 'message:new', {
        filter: (p) => p.message.text === 'shh',
      });
      const m = await sendOk(t, owner, group, { text: 'shh', silent: true });
      expect(silentOf(m)).toBe(true);
      expect(silentOf((await arrived).message)).toBe(true);
      const stored = (await historyOf(t, bob, group)).find((x) => x.id === m.id)!;
      expect(silentOf(stored)).toBe(true);
      // Other flags keep their bits; a normal message carries none.
      const loud = await sendOk(t, owner, group, { text: 'read this', tts: true, silent: true });
      expect(loud.flags).toBe(MESSAGE_FLAGS.TTS | MESSAGE_FLAGS.SILENT);
      expect(silentOf(await sendOk(t, owner, group, 'hello'))).toBe(false);
    });

    it('DMs: a silent message pushes nobody but still counts as unread; the next one pushes', async () => {
      const [a, b] = [
        await t.createUser({ displayName: 'Ann' }),
        await t.createUser({ displayName: 'Ben' }),
      ];
      await saveContact(a, b);
      await saveContact(b, a);
      const chat = await createDirect(a, b);
      const ep = await subscribe(b);
      await sendOk(t, a, chat, { text: 'quiet one', silent: true });
      await pushIdle();
      expect(to(ep)).toEqual([]);
      expect((await summaryOf(t, b, chat)).unreadCount).toBe(1);
      await sendOk(t, a, chat, 'loud one');
      await pushIdle();
      expect(to(ep).map((p) => p.payload.body)).toEqual(['loud one']);
    });

    it('groups: a silent @mention pushes nobody; the mention still counts', async () => {
      const [a, b] = [await t.createUser({ displayName: 'Ann' }), await t.createUser()];
      const group = await createGroup(a, [b], { name: 'Club' });
      const ep = await subscribe(b);
      await sendOk(t, a, group, { text: `psst ${mentionToken(b.id)}`, silent: true });
      await pushIdle();
      expect(to(ep)).toEqual([]);
      const summary = await summaryOf(t, b, group);
      expect(summary).toMatchObject({ unreadCount: 1, unreadMentionCount: 1 });
    });

    it('Space channels: a silent @mention pushes nobody; a normal one does', async () => {
      const ep = await subscribe(bob);
      const mention = (text: string, silent?: boolean) =>
        sendOk(t, owner, general().id, {
          text: `${text} ${mentionToken(bob.id)}`,
          ...(silent ? { silent } : {}),
        });
      const quiet = await mention('silently', true);
      expect(silentOf(quiet)).toBe(true);
      await pushIdle();
      expect(to(ep)).toEqual([]);
      await mention('out loud');
      await pushIdle();
      expect(to(ep).map((p) => p.payload.body)).toEqual([expect.stringContaining('out loud')]);
    });
  });

  describe('the Space message limit', () => {
    const long = (n: number, c = 'a') => c.repeat(n);

    it(`send: up to ${SPACE_MESSAGE_MAX_LENGTH} characters in a Space channel, more → 400`, async () => {
      const ok = await sendOk(t, owner, general().id, long(SPACE_MESSAGE_MAX_LENGTH));
      expect(ok.text).toHaveLength(SPACE_MESSAGE_MAX_LENGTH);
      const res = await sendReq(t, owner, general().id, {
        text: long(SPACE_MESSAGE_MAX_LENGTH + 1),
      }).expect(400);
      expect(res.body.error).toMatchObject({ code: 'validation_error', message: LIMIT_ERROR });
    });

    it('captions too', async () => {
      const [m1, m2] = [await mkMedia(owner.id, 'image'), await mkMedia(owner.id, 'image')];
      const res = await sendReq(t, owner, general().id, {
        type: 'image',
        mediaId: m1.id,
        text: long(SPACE_MESSAGE_MAX_LENGTH + 1),
      }).expect(400);
      expect(res.body.error.message).toBe(LIMIT_ERROR);
      await sendReq(t, owner, general().id, {
        type: 'image',
        mediaId: m2.id,
        text: long(SPACE_MESSAGE_MAX_LENGTH),
      }).expect(201);
    });

    it('threads too', async () => {
      const thread = (
        await t
          .api(owner)
          .post(`/api/chats/${general().id}/threads`)
          .send({ name: 'Long reads' })
          .expect(201)
      ).body as ChatSummary;
      await spaceRegistryIdle();
      await sendReq(t, owner, thread.id, { text: long(SPACE_MESSAGE_MAX_LENGTH + 1) }).expect(400);
      await sendReq(t, owner, thread.id, { text: long(SPACE_MESSAGE_MAX_LENGTH) }).expect(201);
    });

    it('edit: more than the limit → 400 and the message stays; up to it → 200', async () => {
      const m = await sendOk(t, owner, general().id, 'short');
      const res = await edit(owner, m.id, long(SPACE_MESSAGE_MAX_LENGTH + 1, 'b')).expect(400);
      expect(res.body.error).toMatchObject({ code: 'validation_error', message: LIMIT_ERROR });
      const kept = (await historyOf(t, owner, general().id)).find((x) => x.id === m.id)!;
      expect(kept).toMatchObject({ text: 'short', editedAt: null });
      const edited = (await edit(owner, m.id, long(SPACE_MESSAGE_MAX_LENGTH, 'b')).expect(200))
        .body as Message;
      expect(edited.text).toHaveLength(SPACE_MESSAGE_MAX_LENGTH);
    });

    it('DMs and groups keep the old limit', async () => {
      const group = await createGroup(owner, [bob], { name: 'Essays' });
      const m = await sendOk(t, owner, group, long(SPACE_MESSAGE_MAX_LENGTH + 1000));
      expect(m.text).toHaveLength(SPACE_MESSAGE_MAX_LENGTH + 1000);
      const edited = (
        await edit(owner, m.id, long(SPACE_MESSAGE_MAX_LENGTH + 2000, 'c')).expect(200)
      ).body as Message;
      expect(edited.text).toHaveLength(SPACE_MESSAGE_MAX_LENGTH + 2000);
      const dm = await createDirect(owner, bob);
      await sendReq(t, owner, dm, { text: long(SPACE_MESSAGE_MAX_LENGTH + 1) }).expect(201);
    });
  });
});
