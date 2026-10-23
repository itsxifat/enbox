/**
 * Super reactions (modules/messages/reactions.ts `?burst=true`): both kinds of one emoji side
 * by side, `burstCount` / `burstUserIds` / `myBurstReactions`, reactor lists and moderator
 * removal per kind, deltas with `burst: true`, clears of both kinds, the unique-emoji cap over
 * either kind, USER_RATE_LIMITS.superReaction, and the anonymity of channels.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { asc, eq } from 'drizzle-orm';
import {
  MAX_UNIQUE_REACTIONS,
  PERM,
  USER_RATE_LIMITS,
  type SpaceAuditEntry,
  type SpaceDetail,
  type SpaceInvite,
  type UserPublic,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { messageReactions } from '../../src/db/schema.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { block, createChannel, createGroup, recordEvents, settle } from '../services/fixtures.js';
import { activeDirect, follow, historyOf, sendOk } from '../messaging/support.js';

const enc = encodeURIComponent;
/** 21 distinct single-code-point emoji. */
const EMOJI = Array.from('😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋');

describe('super reactions', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;

  const path = (messageId: string, emoji: string, who = '@me') =>
    `/api/messages/${messageId}/reactions/${enc(emoji)}/${who}`;
  const superOn = (u: TestUser, messageId: string, emoji: string) =>
    t.api(u).put(`${path(messageId, emoji)}?burst=true`);
  const superOff = (u: TestUser, messageId: string, emoji: string) =>
    t.api(u).delete(`${path(messageId, emoji)}?burst=true`);
  const normalOn = (u: TestUser, messageId: string, emoji: string) =>
    t.api(u).put(path(messageId, emoji));
  const reactors = async (u: TestUser, messageId: string, emoji: string, query = '') =>
    (
      (
        await t
          .api(u)
          .get(`/api/messages/${messageId}/reactions/${enc(emoji)}${query}`)
          .expect(200)
      ).body as UserPublic[]
    ).map((x) => x.id);
  const seen = async (u: TestUser, chatId: string, messageId: string) =>
    (await historyOf(t, u, chatId)).find((m) => m.id === messageId)!;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser({ displayName: 'Alice' });
    bob = await t.createUser({ displayName: 'Bob' });
    carol = await t.createUser({ displayName: 'Carol' });
  });
  afterAll(() => t.close());

  it('adds and removes a super reaction next to the normal one of the same emoji', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'super');
    await superOn(bob, m.id, '🔥').expect(204);
    await normalOn(bob, m.id, '🔥').expect(204);
    await normalOn(carol, m.id, '🔥').expect(204);
    await superOn(bob, m.id, '🔥').expect(204); // already mine: no-op
    await superOn(carol, m.id, '🎉').expect(204);
    let forBob = await seen(bob, g, m.id);
    expect(forBob.reactions).toEqual([
      { emoji: '🔥', count: 3, userIds: [bob.id, carol.id], burstCount: 1, burstUserIds: [bob.id] },
      { emoji: '🎉', count: 1, userIds: [], burstCount: 1, burstUserIds: [carol.id] },
    ]);
    expect(forBob).toMatchObject({
      myReactions: ['🔥'],
      myReaction: '🔥',
      myBurstReactions: ['🔥'],
    });
    expect(await seen(carol, g, m.id)).toMatchObject({
      myReactions: ['🔥'],
      myBurstReactions: ['🎉'],
    });
    const rows = await db
      .select({ userId: messageReactions.userId, burst: messageReactions.burst })
      .from(messageReactions)
      .where(eq(messageReactions.messageId, m.id))
      .orderBy(asc(messageReactions.createdAt));
    expect(rows.filter((r) => r.userId === bob.id).map((r) => r.burst)).toEqual([true, false]);

    // Removing the super one leaves the normal one (and the other way round).
    await superOff(bob, m.id, '🔥').expect(204);
    await superOff(bob, m.id, '🔥').expect(204); // nothing left to remove
    forBob = await seen(bob, g, m.id);
    expect(forBob.reactions[0]).toEqual({ emoji: '🔥', count: 2, userIds: [bob.id, carol.id] });
    expect(forBob).toMatchObject({ myReactions: ['🔥'], myBurstReactions: [] });
    await superOn(bob, m.id, '🔥').expect(204);
    await t.api(bob).delete(path(m.id, '🔥')).expect(204);
    expect((await seen(bob, g, m.id)).reactions[0]).toEqual({
      emoji: '🔥',
      count: 2,
      userIds: [carol.id],
      burstCount: 1,
      burstUserIds: [bob.id],
    });
    // An equivalent emoji joins the stored one ('❤' without VS16 joins '❤️'), per kind.
    await normalOn(carol, m.id, '❤️').expect(204);
    await superOn(bob, m.id, '❤').expect(204);
    const heart = (await seen(bob, g, m.id)).reactions.find((r) => r.emoji === '❤️');
    expect(heart).toEqual({
      emoji: '❤️',
      count: 2,
      userIds: [carol.id],
      burstCount: 1,
      burstUserIds: [bob.id],
    });
    await t
      .api(bob)
      .put(`${path(m.id, '🔥')}?burst=maybe`)
      .expect(400);
  });

  it('lists and moderates each kind on its own (audited in Spaces, see below)', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'who sent what');
    await superOn(bob, m.id, '🔥').expect(204);
    await normalOn(carol, m.id, '🔥').expect(204);
    await superOn(carol, m.id, '🔥').expect(204);
    await normalOn(bob, m.id, '🔥').expect(204);
    expect(await reactors(alice, m.id, '🔥')).toEqual([carol.id, bob.id]);
    expect(await reactors(alice, m.id, '🔥', '?burst=false')).toEqual([carol.id, bob.id]);
    expect(await reactors(alice, m.id, '🔥', '?burst=true')).toEqual([bob.id, carol.id]);
    // The cursor is the user's reaction of that kind.
    expect(await reactors(alice, m.id, '🔥', '?burst=true&limit=1')).toEqual([bob.id]);
    expect(await reactors(alice, m.id, '🔥', `?burst=true&limit=1&after=${bob.id}`)).toEqual([
      carol.id,
    ]);
    expect(await reactors(alice, m.id, '🔥', `?after=${carol.id}`)).toEqual([bob.id]);

    // Members can't remove others' reactions; the group admin removes one kind.
    await t
      .api(carol)
      .delete(`${path(m.id, '🔥', bob.id)}?burst=true`)
      .expect(403);
    const sc = await t.connect(carol);
    const gone = waitForEvent(sc, 'message:reaction-remove');
    await t
      .api(alice)
      .delete(`${path(m.id, '🔥', bob.id)}?burst=true`)
      .expect(204);
    expect(await gone).toEqual({
      chatId: g,
      messageId: m.id,
      emoji: '🔥',
      emojiId: null,
      userId: bob.id,
      burst: true,
    });
    sc.disconnect();
    expect(await reactors(alice, m.id, '🔥', '?burst=true')).toEqual([carol.id]);
    expect(await reactors(alice, m.id, '🔥')).toEqual([carol.id, bob.id]);
    // My own id works like @me, for either kind.
    await t
      .api(carol)
      .delete(`${path(m.id, '🔥', carol.id)}?burst=true`)
      .expect(204);
    expect((await seen(carol, g, m.id)).myBurstReactions).toEqual([]);
  });

  it('deltas carry burst: true for super reactions; the APK routes keep to normal ones', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'watch');
    const sa = await t.connect(alice);
    const la = recordEvents(sa);
    const added = waitForEvent(sa, 'message:reaction-add');
    await superOn(bob, m.id, '🔥').expect(204);
    expect(await added).toEqual({
      chatId: g,
      messageId: m.id,
      emoji: '🔥',
      emojiId: null,
      userId: bob.id,
      burst: true,
    });
    const normal = waitForEvent(sa, 'message:reaction-add');
    await normalOn(bob, m.id, '🎉').expect(204);
    expect(await normal).toEqual({
      chatId: g,
      messageId: m.id,
      emoji: '🎉',
      emojiId: null,
      userId: bob.id,
    });
    await settle();
    // The full message that follows each delta (for the Android app) carries the counts.
    expect(la.of('message:updated').at(-1)!.message.reactions).toEqual([
      { emoji: '🔥', count: 1, userIds: [], burstCount: 1, burstUserIds: [bob.id] },
      { emoji: '🎉', count: 1, userIds: [bob.id] },
    ]);

    // Replace (PUT /reaction) swaps my normal reactions only; the super one stays.
    la.clear();
    await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '❤️' }).expect(200);
    const after = await seen(bob, g, m.id);
    expect(after).toMatchObject({
      myReaction: '❤️',
      myReactions: ['❤️'],
      myBurstReactions: ['🔥'],
    });
    // Removing all of mine (DELETE /reaction) removes both kinds.
    const res = await t.api(bob).delete(`/api/messages/${m.id}/reaction`).expect(200);
    expect(res.body).toMatchObject({ reactions: [], myReactions: [], myBurstReactions: [] });
    await settle();
    expect(
      la.log
        .filter((e) => e.event.startsWith('message:reaction'))
        .map((e) => [e.event, e.payload.emoji, e.payload.burst ?? false]),
    ).toEqual([
      ['message:reaction-remove', '🎉', false],
      ['message:reaction-add', '❤️', false],
      ['message:reaction-remove', '🔥', true],
      ['message:reaction-remove', '❤️', false],
    ]);
    sa.disconnect();
  });

  it('clearing an emoji (or every reaction) clears both kinds', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'clear me');
    await superOn(bob, m.id, '🔥').expect(204);
    await normalOn(carol, m.id, '🔥').expect(204);
    await superOn(carol, m.id, '🎉').expect(204);
    await normalOn(bob, m.id, '🎉').expect(204);
    const sb = await t.connect(bob);
    const one = waitForEvent(sb, 'message:reactions-cleared');
    await t
      .api(alice)
      .delete(`/api/messages/${m.id}/reactions/${enc('🔥')}`)
      .expect(204);
    expect(await one).toEqual({ chatId: g, messageId: m.id, emoji: '🔥' });
    expect((await seen(bob, g, m.id)).reactions).toEqual([
      { emoji: '🎉', count: 2, userIds: [bob.id], burstCount: 1, burstUserIds: [carol.id] },
    ]);
    const all = waitForEvent(sb, 'message:reactions-cleared');
    await t.api(alice).delete(`/api/messages/${m.id}/reactions`).expect(204);
    expect(await all).toEqual({ chatId: g, messageId: m.id, emoji: null });
    expect(await seen(bob, g, m.id)).toMatchObject({
      reactions: [],
      myReactions: [],
      myBurstReactions: [],
    });
    sb.disconnect();
  });

  it('MAX_UNIQUE_REACTIONS counts distinct emoji of either kind', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'busy');
    for (const e of EMOJI.slice(0, MAX_UNIQUE_REACTIONS - 1))
      await normalOn(bob, m.id, e).expect(204);
    await superOn(bob, m.id, EMOJI[MAX_UNIQUE_REACTIONS - 1]!).expect(204);
    const over = await superOn(carol, m.id, EMOJI[MAX_UNIQUE_REACTIONS]!).expect(400);
    expect(over.body.error.code).toBe('validation_error');
    await normalOn(carol, m.id, EMOJI[MAX_UNIQUE_REACTIONS]!).expect(400);
    // The other kind of an emoji that is there already is not a new emoji.
    await superOn(carol, m.id, EMOJI[0]!).expect(204);
    await normalOn(carol, m.id, EMOJI[MAX_UNIQUE_REACTIONS - 1]!).expect(204);
    const forCarol = await seen(carol, g, m.id);
    expect(forCarol.reactions).toHaveLength(MAX_UNIQUE_REACTIONS);
    expect(forCarol).toMatchObject({
      myReactions: [EMOJI[MAX_UNIQUE_REACTIONS - 1]],
      myBurstReactions: [EMOJI[0]],
    });
  });

  it('USER_RATE_LIMITS.superReaction caps new super reactions; no-ops and normal ones are free', async () => {
    const { limit } = USER_RATE_LIMITS.superReaction;
    expect(limit).toBe(30);
    const g = await createGroup(alice, [bob]);
    const m1 = await sendOk(t, alice, g, 'one');
    const m2 = await sendOk(t, alice, g, 'two');
    const emoji = (i: number) => EMOJI[i % MAX_UNIQUE_REACTIONS]!;
    const target = (i: number) => (i < MAX_UNIQUE_REACTIONS ? m1.id : m2.id);
    resetUserLimits();
    config.rateLimit = true;
    try {
      for (let i = 0; i < limit - 1; i++) await superOn(bob, target(i), emoji(i)).expect(204);
      await superOn(bob, m1.id, emoji(0)).expect(204); // already mine: not counted
      await superOn(bob, target(limit - 1), emoji(limit - 1)).expect(204);
      const refused = await superOn(bob, m2.id, emoji(limit)).expect(429);
      expect(refused.body.error.code).toBe('rate_limited');
      await normalOn(bob, m2.id, emoji(limit)).expect(204);
      await superOff(bob, m1.id, emoji(0)).expect(204);
      // Removing one gives nothing back.
      await superOn(bob, m1.id, emoji(0)).expect(429);
    } finally {
      config.rateLimit = false;
      resetUserLimits();
    }
    expect((await seen(bob, g, m2.id)).myBurstReactions).toHaveLength(limit - MAX_UNIQUE_REACTIONS);
  });

  it('direct chats leave out super reactions of users I blocked', async () => {
    const [a, b] = [await t.createUser(), await t.createUser()];
    const d = await activeDirect(t, a, b);
    const m = await sendOk(t, b, d, 'hello');
    await superOn(b, m.id, '🔥').expect(204);
    await block(b, a);
    await superOn(a, m.id, '🔥').expect(204);
    expect((await seen(a, d, m.id)).reactions).toEqual([
      { emoji: '🔥', count: 2, userIds: [], burstCount: 2, burstUserIds: [b.id, a.id] },
    ]);
    expect((await seen(b, d, m.id)).reactions).toEqual([
      { emoji: '🔥', count: 1, userIds: [], burstCount: 1, burstUserIds: [b.id] },
    ]);
    expect(await reactors(b, m.id, '🔥', '?burst=true')).toEqual([b.id]);
  });

  it('broadcast channels stay anonymous and keep their quick list', async () => {
    const ch = await createChannel(alice);
    await follow(ch, [bob, carol]);
    const post = await sendOk(t, alice, ch, 'post');
    const sc = await t.connect(carol);
    const lc = recordEvents(sc);
    await superOn(bob, post.id, '🦄').expect(204);
    await settle();
    expect(lc.of('message:reaction-add')).toEqual([]);
    expect(lc.of('message:updated')[0]!.message.reactions).toEqual([
      { emoji: '🦄', count: 1, userIds: [], burstCount: 1 },
    ]);
    expect(await seen(bob, ch, post.id)).toMatchObject({
      reactions: [{ emoji: '🦄', count: 1, userIds: [], burstCount: 1 }],
      myReactions: [],
      myBurstReactions: ['🦄'],
    });
    await t
      .api(carol)
      .get(`/api/messages/${post.id}/reactions/${enc('🦄')}?burst=true`)
      .expect(403);
    await t
      .api(alice)
      .delete(`${path(post.id, '🦄', bob.id)}?burst=true`)
      .expect(403);
    sc.disconnect();

    const quick = await createChannel(alice, { settings: { reactions: 'quick' } });
    await follow(quick, [bob]);
    const q = await sendOk(t, alice, quick, 'quick only');
    await superOn(bob, q.id, '🦄').expect(403);
    await superOn(bob, q.id, '👍').expect(204);
  });

  describe('Space channels', () => {
    let detail: SpaceDetail;
    const spaceId = () => detail.space.id;
    const general = () => detail.channels.find((c) => c.name === 'general')!;
    const everyone = () => detail.space.roles.find((r) => r.isDefault)!;
    const denyInGeneral = async (deny: number | null) => {
      const p = `/api/spaces/${spaceId()}/channels/${general().id}/overwrites/role/${everyone().id}`;
      if (deny === null) await t.api(alice).delete(p).expect(200);
      else await t.api(alice).put(p).send({ allow: 0, deny }).expect(200);
      await spaceRegistryIdle();
    };

    beforeAll(async () => {
      detail = (await t.api(alice).post('/api/spaces').send({ name: 'Supers' }).expect(201))
        .body as SpaceDetail;
      const invite = (
        await t.api(alice).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201)
      ).body as SpaceInvite;
      for (const u of [bob, carol])
        await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
      await spaceRegistryIdle();
    });

    it('counts only in summaries, named deltas and reactor lists for members', async () => {
      const m = await sendOk(t, alice, general().id, 'space post');
      const sa = await t.connect(alice);
      const added = waitForEvent(sa, 'message:reaction-add');
      await superOn(bob, m.id, '🚀').expect(204);
      expect(await added).toMatchObject({ emoji: '🚀', userId: bob.id, burst: true });
      await normalOn(carol, m.id, '🚀').expect(204);
      sa.disconnect();
      expect(await seen(carol, general().id, m.id)).toMatchObject({
        reactions: [{ emoji: '🚀', count: 2, userIds: [], burstCount: 1 }],
        myReactions: ['🚀'],
        myBurstReactions: [],
      });
      expect(await reactors(carol, m.id, '🚀', '?burst=true')).toEqual([bob.id]);
      expect(await reactors(carol, m.id, '🚀')).toEqual([carol.id]);
    });

    it('ADD_REACTIONS for a new emoji (either kind); joining needs only VIEW_CHANNEL', async () => {
      const m = await sendOk(t, alice, general().id, 'no new ones');
      await normalOn(alice, m.id, '👍').expect(204);
      await denyInGeneral(PERM.ADD_REACTIONS);
      try {
        const refused = await superOn(bob, m.id, '🎉').expect(403);
        expect(refused.body.error.code).toBe('forbidden');
        await superOn(bob, m.id, '👍').expect(204);
      } finally {
        await denyInGeneral(null);
      }
      expect((await seen(bob, general().id, m.id)).myBurstReactions).toEqual(['👍']);
    });

    it('moderators remove a super reaction (audited with its kind)', async () => {
      const m = await sendOk(t, alice, general().id, 'moderated');
      await superOn(bob, m.id, '👀').expect(204);
      await normalOn(bob, m.id, '👀').expect(204);
      await t
        .api(alice)
        .delete(`${path(m.id, '👀', bob.id)}?burst=true`)
        .expect(204);
      expect(await seen(bob, general().id, m.id)).toMatchObject({
        reactions: [{ emoji: '👀', count: 1, userIds: [] }],
        myReactions: ['👀'],
        myBurstReactions: [],
      });
      const log = (await t.api(alice).get(`/api/spaces/${spaceId()}/audit-log`).expect(200))
        .body as SpaceAuditEntry[];
      expect(log.find((e) => e.action === 'message.reaction_remove')).toMatchObject({
        actorId: alice.id,
        targetType: 'member',
        targetId: bob.id,
        changes: { messageId: m.id, channelId: general().id, emoji: '👀', burst: true },
      });
    });
  });
});
