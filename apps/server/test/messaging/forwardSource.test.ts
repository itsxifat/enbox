/**
 * Forwarding with a source and a comment (polish wave): every copy says where its original is
 * (`forwardedFrom`; a forward of a forward keeps the first original), a poll that had an end
 * ends a day after the forward, and the optional comment goes after the copies in each chat as
 * my own text message — idempotent on retry, checked like a send, refused with the forward
 * where sending isn't allowed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  AUTOMOD_BLOCKED_CODE,
  DEFAULT_POLL_DURATION_HOURS,
  FORWARD_COMMENT_MAX_LENGTH,
  mentionToken,
  type Message,
  type SpaceDetail,
  type SpaceInvite,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { messages } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { autoModIdle } from '../../src/services/automod.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createGroup, recordEvents, send as sendFx, settle } from '../services/fixtures.js';
import { activeDirect, historyOf, sendOk } from './support.js';

describe('forward: where it came from, and a comment', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
    dave = await t.createUser({ displayName: 'Dave' });
  });
  afterAll(() => t.close());

  const forward = (user: TestUser, body: Record<string, unknown>) =>
    t.api(user).post('/api/messages/forward').send(body);

  it('every copy points at its original; a forward of a forward keeps the first one', async () => {
    const src = await createGroup(bob, [alice]);
    const target = await createGroup(alice, [carol]);
    const original = await sendOk(t, bob, src, 'look at this');
    expect(original.forwardedFrom).toBeUndefined();
    const [copy] = (
      await forward(alice, {
        clientId: 'src-1',
        messageIds: [original.id],
        chatIds: [target],
      }).expect(201)
    ).body as Message[];
    expect(copy!.forwardedFrom).toEqual({
      chatId: src,
      messageId: original.id,
      spaceId: null,
      createdAt: original.createdAt,
    });
    // History serializes it too.
    const listed = (await historyOf(t, carol, target)).find((m) => m.id === copy!.id);
    expect(listed?.forwardedFrom).toEqual(copy!.forwardedFrom);

    // Carol forwards the copy on: it still points at Bob's message.
    const onward = await activeDirect(t, carol, dave);
    const [again] = (
      await forward(carol, { clientId: 'src-2', messageIds: [copy!.id], chatIds: [onward] }).expect(
        201,
      )
    ).body as Message[];
    expect(again).toMatchObject({ forwardCount: 2, forwardedFrom: copy!.forwardedFrom });
  });

  it('a message of a Space channel records its Space', async () => {
    const detail = (await t.api(alice).post('/api/spaces').send({ name: 'Sources' }).expect(201))
      .body as SpaceDetail;
    const general = detail.channels.find((c) => c.type === 'space_text')!;
    const m = await sendOk(t, alice, general.id, 'from the Space');
    const g = await createGroup(alice, [bob]);
    const [copy] = (
      await forward(alice, { clientId: 'src-3', messageIds: [m.id], chatIds: [g] }).expect(201)
    ).body as Message[];
    expect(copy!.forwardedFrom).toEqual({
      chatId: general.id,
      messageId: m.id,
      spaceId: detail.space.id,
      createdAt: m.createdAt,
    });
  });

  it('a poll that had an end ends a day after the forward; one without stays open', async () => {
    const g = await createGroup(alice, [bob]);
    const timed = await sendOk(t, alice, g, {
      type: 'poll',
      poll: { question: 'Lunch?', options: ['Pizza', 'Soup'] },
    });
    await db
      .update(messages)
      .set({ pollEndsAt: new Date(Date.now() + 60 * 60_000) })
      .where(eq(messages.id, timed.id));
    const open = await sendOk(t, alice, g, {
      type: 'poll',
      poll: { question: 'Forever?', options: ['Yes', 'No'] },
    });
    const day = DEFAULT_POLL_DURATION_HOURS * 60 * 60_000;
    const before = Date.now();
    const [a, b] = (
      await forward(alice, {
        clientId: 'poll-1',
        messageIds: [timed.id, open.id],
        chatIds: [g],
      }).expect(201)
    ).body as Message[];
    const endsAt = Date.parse(a!.poll!.endsAt!);
    expect(endsAt).toBeGreaterThanOrEqual(before + day);
    expect(endsAt).toBeLessThanOrEqual(Date.now() + day);
    expect(a!.poll!.closedAt).toBeNull();
    expect(b!.poll!.endsAt).toBeNull();
  });

  it('the comment follows the copies in each chat, once, as my own text message; a retry adds nothing', async () => {
    const src = await createGroup(bob, [alice]);
    const one = await sendOk(t, bob, src, 'one');
    const two = await sendOk(t, bob, src, 'two');
    const group = await createGroup(alice, [carol]);
    const direct = await activeDirect(t, alice, dave);
    const comment = `for you ${mentionToken(carol.id)}`;
    const body = {
      clientId: 'cmt-1',
      messageIds: [one.id, two.id],
      chatIds: [group, direct],
      comment: `  ${comment}  `,
    };
    const cs = await t.connect(carol);
    const log = recordEvents(cs);

    const res = await forward(alice, body).expect(201);
    // The response lists the copies only.
    const copies = res.body as Message[];
    expect(copies.map((m) => [m.chatId, m.text])).toEqual([
      [group, 'one'],
      [group, 'two'],
      [direct, 'one'],
      [direct, 'two'],
    ]);
    for (const chatId of [group, direct]) {
      const tail = (await historyOf(t, alice, chatId)).slice(-3);
      expect(tail.map((m) => m.text)).toEqual(['one', 'two', comment]);
      expect(tail[2]).toMatchObject({
        type: 'text',
        senderId: alice.id,
        clientId: 'cmt-1:c',
        forwardCount: 0,
      });
      expect(tail[2]!.forwardedFrom).toBeUndefined();
      expect(tail[2]!.seq).toBeGreaterThan(tail[1]!.seq);
    }
    // Mentions are derived the normal way: Carol is in the group only.
    expect((await historyOf(t, alice, group)).at(-1)!.mentions).toEqual([carol.id]);
    expect((await historyOf(t, alice, direct)).at(-1)!.mentions).toEqual([]);
    await settle();
    expect(log.of('message:new').map((p) => p.message.text)).toEqual(['one', 'two', comment]);

    // Retry: 200, the same copies, nothing new anywhere.
    log.clear();
    const lengths = async () => [
      (await historyOf(t, alice, group)).length,
      (await historyOf(t, alice, direct)).length,
    ];
    const before = await lengths();
    const retry = await forward(alice, body).expect(200);
    expect((retry.body as Message[]).map((m) => m.id)).toEqual(copies.map((m) => m.id));
    expect(await lengths()).toEqual(before);
    await settle();
    expect(log.of('message:new')).toEqual([]);
    cs.disconnect();
  });

  it('nothing is sent where sending is not allowed: no copies, no comment', async () => {
    const g = await createGroup(alice, [bob]);
    const m = await sendOk(t, alice, g, 'forward me');
    const open = await createGroup(alice, [carol]);
    const adminsOnly = await createGroup(dave, [alice], { settings: { onlyAdminsCanSend: true } });
    const before = (await historyOf(t, alice, open)).length;
    const denied = await forward(alice, {
      clientId: 'deny-1',
      messageIds: [m.id],
      chatIds: [open, adminsOnly],
      comment: 'hello',
    }).expect(403);
    expect(denied.body.error.code).toBe('forbidden');
    expect((await historyOf(t, alice, open)).length).toBe(before);
    // Blank or too long comments are refused up front.
    for (const comment of ['   ', 'x'.repeat(FORWARD_COMMENT_MAX_LENGTH + 1)])
      await forward(alice, {
        clientId: 'deny-2',
        messageIds: [m.id],
        chatIds: [open],
        comment,
      }).expect(400);
    expect((await historyOf(t, alice, open)).length).toBe(before);
  });

  it('the comments count toward the send limit', async () => {
    const u = await t.createUser();
    const src = await createGroup(u, []);
    const ids: string[] = [];
    for (let i = 0; i < 30; i++) ids.push((await sendFx(u, src, `m${i}`)).message.id);
    const targets = [await createGroup(u, []), await createGroup(u, [])];
    // 30 × 2 copies fill one window; with a comment in each chat they never could.
    const res = await forward(u, {
      clientId: 'limit-1',
      messageIds: ids,
      chatIds: targets,
      comment: 'and these',
    });
    expect({ status: res.status, code: res.body.error?.code }).toEqual({
      status: 400,
      code: 'validation_error',
    });
  });

  describe('into a Space channel', () => {
    let detail: SpaceDetail;
    const general = () => detail.channels.find((c) => c.type === 'space_text')!.id;

    beforeAll(async () => {
      detail = (await t.api(alice).post('/api/spaces').send({ name: 'Targets' }).expect(201))
        .body as SpaceDetail;
      const invite = (
        await t.api(alice).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)
      ).body as SpaceInvite;
      await t.api(bob).post(`/api/invites/${invite.code}/join`).expect(200);
      await spaceRegistryIdle();
    });

    it('AutoMod reads the comment: blocked, nothing is sent', async () => {
      await t
        .api(alice)
        .post(`/api/spaces/${detail.space.id}/automod/rules`)
        .send({
          name: 'No spoilers',
          triggerType: 'keyword',
          triggerMetadata: { keywords: ['spoiler'] },
          actions: [{ type: 'block' }],
        })
        .expect(201);
      const dm = await activeDirect(t, bob, carol);
      const m = await sendOk(t, bob, dm, 'a clean message');
      const before = (await historyOf(t, bob, general())).length;
      const res = await forward(bob, {
        clientId: 'am-1',
        messageIds: [m.id],
        chatIds: [general()],
        comment: 'big spoiler ahead',
      }).expect(403);
      expect(res.body.error.code).toBe(AUTOMOD_BLOCKED_CODE);
      await autoModIdle();
      expect((await historyOf(t, bob, general())).length).toBe(before);
    });

    it('slowmode counts the forward as one send; its retry still passes', async () => {
      await t
        .api(alice)
        .patch(`/api/spaces/${detail.space.id}/channels/${general()}`)
        .send({ slowmodeSeconds: 30 })
        .expect(200);
      const dm = await activeDirect(t, bob, dave);
      const m = await sendOk(t, bob, dm, 'slow news');
      const body = {
        clientId: 'slow-1',
        messageIds: [m.id],
        chatIds: [general()],
        comment: 'worth a read',
      };
      await forward(bob, body).expect(201);
      await forward(bob, body).expect(200);
      await forward(bob, { ...body, clientId: 'slow-2' }).expect(429);
      // Moderators are exempt.
      const own = await sendOk(t, alice, await createGroup(alice, []), 'mod news');
      const mod = { ...body, messageIds: [own.id] };
      await forward(alice, { ...mod, clientId: 'slow-3' }).expect(201);
      await forward(alice, { ...mod, clientId: 'slow-4' }).expect(201);
    });
  });
});
