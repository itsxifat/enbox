/**
 * Polls with an end (docs/design/discord-parity.md W5-D): a duration and an emoji per answer
 * on send, End Poll Now (the sender, a broadcast channel's admins, MANAGE_MESSAGES in a Space
 * channel), 410 for votes once a poll ended, and the closer job: each expired poll closes once
 * with one `poll_result` message naming the winners (ties, no votes); deleted polls close
 * silently; a direct-chat peer who blocked the sender hears of neither.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  PERM,
  type Message,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type SystemEvent,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { messages } from '../../src/db/schema.js';
import { closeExpiredPolls } from '../../src/modules/messages/polls.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { block, createChannel, createGroup, recordEvents, settle } from '../services/fixtures.js';
import { activeDirect, follow, historyOf, sendOk, sendReq } from './support.js';

type PollResult = Extract<SystemEvent, { kind: 'poll_result' }>;

const HOUR_MS = 60 * 60_000;
const TACO = '<:taco:00000000-0000-4000-8000-000000000001>';

describe('polls with an end', () => {
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

  /** A 24-hour poll "Lunch?" with three answers (override any field; undefined drops it). */
  const poll = (user: TestUser, chatId: string, p: Record<string, unknown> = {}) =>
    sendOk(t, user, chatId, {
      type: 'poll',
      poll: { question: 'Lunch?', options: ['Pizza', 'Sushi', 'Tacos'], durationHours: 24, ...p },
    });
  const vote = (user: TestUser, m: Message, answers: number[]) =>
    t
      .api(user)
      .put(`/api/messages/${m.id}/vote`)
      .send({ optionIds: answers.map((i) => m.poll!.options[i]!.id) });
  const end = (user: TestUser, m: Message) => t.api(user).post(`/api/messages/${m.id}/poll/end`);
  /** Let a poll's time run out `ago` ms ago (the closer job is called by hand). */
  const expire = (m: Message, ago = 1000) =>
    db
      .update(messages)
      .set({ pollEndsAt: new Date(Date.now() - ago) })
      .where(eq(messages.id, m.id));
  const results = async (user: TestUser, chatId: string) =>
    (await historyOf(t, user, chatId))
      .filter((m) => m.system?.kind === 'poll_result')
      .map((m) => m.system as PollResult);

  it('a duration sets the end and each answer may wear an emoji; no duration never ends; bad input 400', async () => {
    const g = await createGroup(alice, [bob]);
    const before = Date.now();
    const p = await poll(alice, g, { emojis: ['🍕', null, TACO] });
    expect(p.poll!.options.map((o) => o.emoji)).toEqual(['🍕', null, TACO]);
    const endsAt = Date.parse(p.poll!.endsAt!);
    expect(endsAt).toBeGreaterThanOrEqual(before + 24 * HOUR_MS);
    expect(endsAt).toBeLessThanOrEqual(Date.now() + 24 * HOUR_MS);
    expect(p.poll!.closedAt).toBeNull();
    // Stored: the other member's history shows the same.
    const seen = (await historyOf(t, bob, g)).find((m) => m.id === p.id)!.poll!;
    expect(seen).toMatchObject({ endsAt: p.poll!.endsAt, closedAt: null });
    expect(seen.options.map((o) => o.emoji)).toEqual(['🍕', null, TACO]);

    // Older clients send no duration (nor emoji): the poll never ends. Blank emoji are none.
    const endless = await poll(alice, g, { durationHours: undefined, emojis: ['  ', ''] });
    expect(endless.poll).toMatchObject({ endsAt: null, closedAt: null });
    expect(endless.poll!.options.map((o) => o.emoji)).toEqual([null, null, null]);

    // Only the listed durations; one emoji per answer, and no more emoji than answers.
    const bad = (p: Record<string, unknown>) =>
      sendReq(t, alice, g, { type: 'poll', poll: { question: 'Q', options: ['a', 'b'], ...p } });
    await bad({ durationHours: 5 }).expect(400);
    await bad({ emojis: ['pizza', null] }).expect(400);
    await bad({ emojis: ['🍕🍣', null] }).expect(400);
    await bad({ emojis: ['🍕', '🍣', '🌮'] }).expect(400);
  });

  it('End Poll Now: only the sender; the poll closes once, its result is posted, votes get 410', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const p = await poll(alice, g, { emojis: ['🍕', '🍣', null] });
    await vote(bob, p, [0]).expect(200);
    await vote(carol, p, [1]).expect(200);
    const sb = await t.connect(bob);
    const log = recordEvents(sb);

    expect((await end(bob, p).expect(403)).body.error.code).toBe('forbidden');
    await end(dave, p).expect(404);
    const closed = (await end(alice, p).expect(200)).body as Message;
    expect(closed.poll!.closedAt).not.toBeNull();
    expect(closed.poll).toMatchObject({ totalVoters: 2, myOptionIds: [] });
    await settle();
    const updated = log.of('message:updated').filter((e) => e.message.id === p.id);
    expect(updated).toHaveLength(1);
    expect(updated[0]!.message.poll!.closedAt).toBe(closed.poll!.closedAt);
    const posted = log.of('message:new');
    expect(posted).toHaveLength(1);
    expect(posted[0]!.message).toMatchObject({
      chatId: g,
      type: 'system',
      senderId: null,
      system: {
        kind: 'poll_result',
        pollMessageId: p.id,
        authorId: alice.id,
        question: 'Lunch?',
        totalVoters: 2,
        // A tie: both answers win, in answer order.
        winners: [
          { optionId: p.poll!.options[0]!.id, text: 'Pizza', emoji: '🍕', votes: 1 },
          { optionId: p.poll!.options[1]!.id, text: 'Sushi', emoji: '🍣', votes: 1 },
        ],
      },
    });

    // Ending again is a no-op; voting (or removing a vote) is over.
    log.clear();
    await end(alice, p).expect(200);
    expect((await vote(bob, p, [2]).expect(410)).body.error.code).toBe('expired');
    await vote(bob, p, []).expect(410);
    await settle();
    expect(log.log).toEqual([]);
    expect(await results(carol, g)).toHaveLength(1);
    // Only polls end.
    await end(alice, await sendOk(t, alice, g, 'not a poll')).expect(400);
    sb.disconnect();
  });

  it('broadcast channels: any admin who can post ends a poll; the result names no author', async () => {
    const ch = await createChannel(alice, { admins: [carol] });
    await follow(ch, [bob]);
    const p = await poll(alice, ch);
    await vote(bob, p, [2]).expect(200);
    await end(bob, p).expect(403);
    await end(carol, p).expect(200);
    expect(await results(bob, ch)).toMatchObject([
      {
        pollMessageId: p.id,
        authorId: null,
        totalVoters: 1,
        winners: [{ text: 'Tacos', votes: 1 }],
      },
    ]);
  });

  it('Space channels: MANAGE_MESSAGES ends anyone’s poll; another Space’s emoji need USE_EXTERNAL_EMOJI', async () => {
    const space = (await t.api(alice).post('/api/spaces').send({ name: 'Polls' }).expect(201))
      .body as SpaceDetail;
    const spaceId = space.space.id;
    const general = space.channels.find((c) => c.name === 'general')!.id;
    const invite = (await t.api(alice).post(`/api/spaces/${spaceId}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    for (const u of [bob, carol])
      await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();

    const p = await poll(bob, general);
    await end(carol, p).expect(403);
    const mods = (
      await t
        .api(alice)
        .post(`/api/spaces/${spaceId}/roles`)
        .send({ name: 'Mods', permissions: PERM.MANAGE_MESSAGES })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(alice)
      .put(`/api/spaces/${spaceId}/members/${carol.id}/roles/${mods.id}`)
      .expect(200);
    const closed = (await end(carol, p).expect(200)).body as Message;
    expect(closed.poll!.closedAt).not.toBeNull();
    // The result is posted in the same channel.
    expect(await results(bob, general)).toEqual([
      {
        kind: 'poll_result',
        pollMessageId: p.id,
        authorId: bob.id,
        question: 'Lunch?',
        totalVoters: 0,
        winners: [],
      },
    ]);

    // Where USE_EXTERNAL_EMOJI is denied, another Space's emoji leaves its answer without one.
    const everyone = space.space.roles.find((r) => r.isDefault)!.id;
    await t
      .api(alice)
      .put(`/api/spaces/${spaceId}/channels/${general}/overwrites/role/${everyone}`)
      .send({ allow: 0, deny: PERM.USE_EXTERNAL_EMOJI })
      .expect(200);
    const gated = await poll(bob, general, { emojis: [TACO, '🍣', null] });
    expect(gated.poll!.options.map((o) => o.emoji)).toEqual([null, '🍣', null]);
  });

  it('the closer ends each expired poll once with one result (a winner, no votes); deleted polls close silently', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const won = await poll(alice, g, { emojis: ['🍕', null, null] });
    const empty = await poll(bob, g, { question: 'Movie?', options: ['A', 'B'] });
    const deleted = await poll(alice, g, { question: 'Gone?', options: ['x', 'y'] });
    const later = await poll(alice, g, { question: 'Later?', options: ['x', 'y'] });
    const endless = await poll(alice, g, {
      question: 'Forever?',
      options: ['x', 'y'],
      durationHours: undefined,
    });
    await vote(bob, won, [0]).expect(200);
    await vote(carol, won, [0]).expect(200);
    await vote(alice, won, [1]).expect(200);
    await t.api(alice).delete(`/api/messages/${deleted.id}?for=everyone`).expect(204);
    // Ended in this order (the closer takes the oldest first).
    await expire(won, 3000);
    await expire(empty, 2000);
    await expire(deleted, 1000);
    // Time is up before the closer runs: no more votes already.
    await vote(bob, won, [1]).expect(410);

    const sc = await t.connect(carol);
    const log = recordEvents(sc);
    // Batches of two: three expired polls take two transactions.
    expect(await closeExpiredPolls(2)).toBe(3);
    await settle();
    expect(log.of('message:updated').map((e) => e.message.id)).toEqual([won.id, empty.id]);
    expect(log.of('message:new').map((e) => e.message.type)).toEqual(['system', 'system']);
    expect(await results(carol, g)).toEqual([
      {
        kind: 'poll_result',
        pollMessageId: won.id,
        authorId: alice.id,
        question: 'Lunch?',
        totalVoters: 3,
        winners: [{ optionId: won.poll!.options[0]!.id, text: 'Pizza', emoji: '🍕', votes: 2 }],
      },
      {
        kind: 'poll_result',
        pollMessageId: empty.id,
        authorId: bob.id,
        question: 'Movie?',
        totalVoters: 0,
        winners: [],
      },
    ]);

    // Closed once: the next run finds nothing and posts nothing.
    log.clear();
    expect(await closeExpiredPolls()).toBe(0);
    await settle();
    expect(log.log).toEqual([]);
    const history = await historyOf(t, carol, g);
    const byId = (id: string) => history.find((m) => m.id === id)!;
    expect(byId(won.id).poll!.closedAt).not.toBeNull();
    expect(byId(empty.id).poll!.closedAt).not.toBeNull();
    const [gone] = await db
      .select({ closedAt: messages.pollClosedAt })
      .from(messages)
      .where(eq(messages.id, deleted.id));
    expect(gone!.closedAt).not.toBeNull();
    expect(byId(deleted.id).poll).toBeNull();
    // Polls still running (or without an end) keep taking votes.
    expect(byId(later.id).poll).toMatchObject({ closedAt: null });
    expect(byId(endless.id).poll).toMatchObject({ endsAt: null, closedAt: null });
    await vote(bob, later, [0]).expect(200);
    await vote(bob, endless, [0]).expect(200);
    sc.disconnect();
  });

  it('direct chats: a peer who blocked the sender gets neither the closed poll nor its result', async () => {
    const d = await activeDirect(t, alice, dave);
    const p = await poll(alice, d);
    await block(dave, alice);
    const sd = await t.connect(dave);
    const log = recordEvents(sd);
    await end(alice, p).expect(200);
    await settle();
    expect(log.log).toEqual([]);
    expect(await results(dave, d)).toEqual([]);
    expect(await results(alice, d)).toMatchObject([{ pollMessageId: p.id, authorId: alice.id }]);
    sd.disconnect();
  });
});
