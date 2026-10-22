/**
 * Discord-model reactions (modules/messages/reactions.ts): several per user, per-emoji
 * summaries with `myReactions`, the 20-emoji cap, ADD_REACTIONS (and USE_EXTERNAL_EMOJI) only
 * for new emoji, moderator removal and clears (audited in Spaces), paged reactor lists, the
 * APK's replace route and the delta events (`message:reaction-add/-remove`,
 * `message:reactions-cleared`).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  MAX_UNIQUE_REACTIONS,
  PERM,
  type Message,
  type SpaceAuditEntry,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type UserPublic,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { messageReactions, spaceEmojis } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { block, createChannel, createGroup, recordEvents, settle } from '../services/fixtures.js';
import {
  activeDirect,
  addToGroup,
  follow,
  historyOf,
  leaveGroup,
  mkMedia,
  sendOk,
} from './support.js';

const enc = encodeURIComponent;
/** 21 distinct single-code-point emoji. */
const EMOJI = Array.from('😀😃😄😁😆😅🤣😂🙂🙃😉😊😇🥰😍🤩😘😗😚😙😋');

describe('reactions (Discord model)', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;

  const mine = (u: TestUser, messageId: string, emoji: string) =>
    t.api(u).put(`/api/messages/${messageId}/reactions/${enc(emoji)}/@me`);
  const unmine = (u: TestUser, messageId: string, emoji: string) =>
    t.api(u).delete(`/api/messages/${messageId}/reactions/${enc(emoji)}/@me`);
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
    dave = await t.createUser({ displayName: 'Dave' });
  });
  afterAll(() => t.close());

  it('several emoji per user, others join, remove mine; summaries in first-reaction order with myReactions', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'react to me');
    await mine(bob, m.id, '👍').expect(204);
    await mine(bob, m.id, '🎉').expect(204);
    await mine(carol, m.id, '👍').expect(204);
    await mine(bob, m.id, '👍').expect(204); // already mine: no-op
    let forBob = await seen(bob, g, m.id);
    expect(forBob.reactions).toEqual([
      { emoji: '👍', count: 2, userIds: [bob.id, carol.id] },
      { emoji: '🎉', count: 1, userIds: [bob.id] },
    ]);
    expect(forBob).toMatchObject({ myReactions: ['👍', '🎉'], myReaction: '👍' });
    expect((await seen(carol, g, m.id)).myReactions).toEqual(['👍']);
    expect((await seen(alice, g, m.id)).myReactions).toEqual([]);

    await unmine(bob, m.id, '👍').expect(204);
    await unmine(bob, m.id, '👍').expect(204); // nothing left to remove
    forBob = await seen(bob, g, m.id);
    // 👍's first reaction is now carol's, which came after bob's 🎉.
    expect(forBob.reactions).toEqual([
      { emoji: '🎉', count: 1, userIds: [bob.id] },
      { emoji: '👍', count: 1, userIds: [carol.id] },
    ]);
    expect(forBob).toMatchObject({ myReactions: ['🎉'], myReaction: '🎉' });

    // An equivalent emoji joins the stored one ('❤' without VS16 joins '❤️').
    await mine(carol, m.id, '❤️').expect(204);
    await mine(bob, m.id, '❤').expect(204);
    const heart = (await seen(bob, g, m.id)).reactions.find((r) => r.emoji === '❤️');
    expect(heart).toEqual({ emoji: '❤️', count: 2, userIds: [carol.id, bob.id] });
    await unmine(bob, m.id, '❤').expect(204);
    expect((await seen(bob, g, m.id)).myReactions).toEqual(['🎉']);
  });

  it('caps a message at MAX_UNIQUE_REACTIONS distinct emoji; joining one still works', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'popular');
    for (const e of EMOJI.slice(0, MAX_UNIQUE_REACTIONS)) await mine(bob, m.id, e).expect(204);
    const over = await mine(carol, m.id, EMOJI[MAX_UNIQUE_REACTIONS]!).expect(400);
    expect(over.body.error.code).toBe('validation_error');
    await mine(carol, m.id, EMOJI[0]!).expect(204);
    const after = await seen(carol, g, m.id);
    expect(after.reactions).toHaveLength(MAX_UNIQUE_REACTIONS);
    expect(after.reactions[0]).toMatchObject({ emoji: EMOJI[0], count: 2 });
    expect(after.myReactions).toEqual([EMOJI[0]]);
  });

  it('validates the emoji and the target; former members cannot react but still list reactors', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'x');
    await mine(bob, m.id, 'lol').expect(400);
    await mine(bob, m.id, '👍👍').expect(400);
    await mine(bob, m.id, '<:no:not-a-uuid>').expect(400);
    const sys = (await historyOf(t, bob, g)).find((x) => x.type === 'system')!;
    await mine(bob, sys.id, '👍').expect(400);
    await mine(dave, m.id, '👍').expect(404);
    await t
      .api(dave)
      .get(`/api/messages/${m.id}/reactions/${enc('👍')}`)
      .expect(404);
    await mine(carol, m.id, '👍').expect(204);
    await leaveGroup(g, carol);
    const former = await mine(carol, m.id, '🎉').expect(403);
    expect(former.body.error.code).toBe('not_member');
    expect(await reactors(carol, m.id, '👍')).toEqual([carol.id]);
  });

  it('custom emoji tokens: stored with emoji_id, the same emoji under another name joins it', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'custom');
    const id = '0f6c9a52-3b8e-4c1d-9e2f-7a6b5c4d3e21';
    const token = `<:party:${id}>`;
    await mine(bob, m.id, token).expect(204);
    await mine(carol, m.id, `<:party_renamed:${id}>`).expect(204);
    const forBob = await seen(bob, g, m.id);
    expect(forBob.reactions).toEqual([
      { emoji: token, emojiId: id, count: 2, userIds: [bob.id, carol.id] },
    ]);
    const rows = await db
      .select()
      .from(messageReactions)
      .where(eq(messageReactions.messageId, m.id));
    expect(rows.map((r) => [r.emoji, r.emojiId])).toEqual([
      [token, id],
      [token, id],
    ]);
    expect(await reactors(alice, m.id, token)).toEqual([bob.id, carol.id]);
    await unmine(carol, m.id, `<:other_name:${id}>`).expect(204);
    expect((await seen(carol, g, m.id)).myReactions).toEqual([]);
  });

  it('deltas: one small event per change to the members who can see the message (then message:updated for the Android app)', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'watch me');
    // Dave joins after the message (can't see it); carol deletes it for herself.
    await addToGroup(g, alice, [dave]);
    await t.api(carol).delete(`/api/messages/${m.id}?for=me`).expect(204);
    const [sa, sc, sd] = [await t.connect(alice), await t.connect(carol), await t.connect(dave)];
    const [la, lc, ld] = [recordEvents(sa), recordEvents(sc), recordEvents(sd)];

    const added = waitForEvent(sa, 'message:reaction-add');
    await mine(bob, m.id, '👍').expect(204);
    expect(await added).toEqual({
      chatId: g,
      messageId: m.id,
      emoji: '👍',
      emojiId: null,
      userId: bob.id,
    });
    await mine(bob, m.id, '👍').expect(204); // no-op: no event
    const removed = waitForEvent(sa, 'message:reaction-remove');
    await unmine(bob, m.id, '👍').expect(204);
    expect(await removed).toMatchObject({ messageId: m.id, emoji: '👍', userId: bob.id });
    await settle();
    // Groups and DMs follow each delta with the full message: the Android app only merges
    // message:updated (the web takes the delta first; the counts agree).
    expect(la.names().filter((n) => n.startsWith('message:'))).toEqual([
      'message:reaction-add',
      'message:updated',
      'message:reaction-remove',
      'message:updated',
    ]);
    for (const log of [lc, ld])
      expect(log.names().filter((n) => n.startsWith('message:'))).toEqual([]);
    for (const s of [sa, sc, sd]) s.disconnect();
  });

  it('direct chats: a peer who blocked me hears nothing, and their reactor list leaves out users they blocked', async () => {
    const [a, b] = [await t.createUser(), await t.createUser()];
    const d = await activeDirect(t, a, b);
    const m = await sendOk(t, b, d, 'hello');
    await block(b, a);
    const sb = await t.connect(b);
    await mine(a, m.id, '🔥').expect(204);
    await expectNoEvent(sb, 'message:reaction-add');
    expect(await reactors(a, m.id, '🔥')).toEqual([a.id]);
    expect(await reactors(b, m.id, '🔥')).toEqual([]);
    expect((await seen(b, d, m.id)).reactions).toEqual([]);
    sb.disconnect();
  });

  it("the APK's PUT /reaction replaces all of mine, DELETE /reaction removes them all (as deltas)", async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'old client');
    await mine(bob, m.id, '👍').expect(204);
    await mine(bob, m.id, '🎉').expect(204);
    await mine(carol, m.id, '👍').expect(204);
    const sa = await t.connect(alice);
    const la = recordEvents(sa);
    let res = await t
      .api(bob)
      .put(`/api/messages/${m.id}/reaction`)
      .send({ emoji: '❤️' })
      .expect(200);
    expect(res.body as Message).toMatchObject({
      myReaction: '❤️',
      myReactions: ['❤️'],
      reactions: [
        { emoji: '👍', count: 1, userIds: [carol.id] },
        { emoji: '❤️', count: 1, userIds: [bob.id] },
      ],
    });
    // Same emoji again: nothing changes, nothing is emitted.
    await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '❤️' }).expect(200);
    await settle();
    expect(
      la.log
        .filter((e) => e.event.startsWith('message:reaction'))
        .map((e) => [e.event, e.payload.emoji, e.payload.userId]),
    ).toEqual([
      ['message:reaction-remove', '👍', bob.id],
      ['message:reaction-remove', '🎉', bob.id],
      ['message:reaction-add', '❤️', bob.id],
    ]);
    // One full message after the three deltas, for the Android app.
    expect(la.of('message:updated')).toHaveLength(1);
    await mine(bob, m.id, '😂').expect(204);
    res = await t.api(bob).delete(`/api/messages/${m.id}/reaction`).expect(200);
    expect(res.body as Message).toMatchObject({
      myReaction: null,
      myReactions: [],
      reactions: [{ emoji: '👍', count: 1, userIds: [carol.id] }],
    });
    await t.api(bob).delete(`/api/messages/${m.id}/reaction`).expect(200);
    sa.disconnect();
  });

  it('group admins moderate reactions; members and direct chats cannot', async () => {
    const g = await createGroup(alice, [bob, carol]);
    const m = await sendOk(t, alice, g, 'moderate me');
    await mine(bob, m.id, '👍').expect(204);
    await mine(carol, m.id, '🎉').expect(204);
    const denied = await t
      .api(carol)
      .delete(`/api/messages/${m.id}/reactions/${enc('👍')}/${bob.id}`)
      .expect(403);
    expect(denied.body.error.code).toBe('forbidden');
    await t.api(carol).delete(`/api/messages/${m.id}/reactions`).expect(403);
    // My own id works like @me.
    await t
      .api(carol)
      .delete(`/api/messages/${m.id}/reactions/${enc('🎉')}/${carol.id}`)
      .expect(204);
    await mine(carol, m.id, '🎉').expect(204);

    const sb = await t.connect(bob);
    const gone = waitForEvent(sb, 'message:reaction-remove');
    await t
      .api(alice)
      .delete(`/api/messages/${m.id}/reactions/${enc('👍')}/${bob.id}`)
      .expect(204);
    expect(await gone).toMatchObject({ emoji: '👍', userId: bob.id });
    const cleared = waitForEvent(sb, 'message:reactions-cleared');
    await t.api(alice).delete(`/api/messages/${m.id}/reactions`).expect(204);
    expect(await cleared).toEqual({ chatId: g, messageId: m.id, emoji: null });
    expect((await seen(alice, g, m.id)).reactions).toEqual([]);
    sb.disconnect();

    const d = await activeDirect(t, alice, bob);
    const dm = await sendOk(t, bob, d, 'mine');
    await mine(bob, dm.id, '👍').expect(204);
    await t
      .api(alice)
      .delete(`/api/messages/${dm.id}/reactions/${enc('👍')}/${bob.id}`)
      .expect(403);
  });

  it('broadcast channels stay anonymous: counts via message:updated, no reactor list, no per-user removal', async () => {
    const ch = await createChannel(alice);
    await follow(ch, [bob, carol]);
    const post = await sendOk(t, alice, ch, 'post');
    const sc = await t.connect(carol);
    const lc = recordEvents(sc);
    await mine(bob, post.id, '🦄').expect(204);
    await settle();
    expect(lc.of('message:reaction-add')).toEqual([]);
    expect(lc.of('message:updated')[0]!.message.reactions).toEqual([
      { emoji: '🦄', count: 1, userIds: [] },
    ]);
    expect((await seen(bob, ch, post.id)).myReactions).toEqual(['🦄']);
    await t
      .api(carol)
      .get(`/api/messages/${post.id}/reactions/${enc('🦄')}`)
      .expect(403);
    await t
      .api(alice)
      .delete(`/api/messages/${post.id}/reactions/${enc('🦄')}/${bob.id}`)
      .expect(403);
    await t
      .api(alice)
      .delete(`/api/messages/${post.id}/reactions/${enc('🦄')}`)
      .expect(204);
    await settle();
    expect(lc.of('message:reactions-cleared')).toEqual([
      { chatId: ch, messageId: post.id, emoji: '🦄' },
    ]);
    sc.disconnect();
  });

  describe('Space channels', () => {
    let detail: SpaceDetail;
    let mods: SpaceRole;
    const spaceId = () => detail.space.id;
    const general = () => detail.channels.find((c) => c.name === 'general')!;
    const everyone = () => detail.space.roles.find((r) => r.isDefault)!;
    /** @everyone's overwrite in #general: deny these bits, or (null) none. */
    const denyInGeneral = async (deny: number | null) => {
      const path = `/api/spaces/${spaceId()}/channels/${general().id}/overwrites/role/${everyone().id}`;
      if (deny === null) await t.api(alice).delete(path).expect(200);
      else await t.api(alice).put(path).send({ allow: 0, deny }).expect(200);
      await spaceRegistryIdle();
    };

    beforeAll(async () => {
      detail = (await t.api(alice).post('/api/spaces').send({ name: 'Reacts' }).expect(201))
        .body as SpaceDetail;
      const invite = (
        await t.api(alice).post(`/api/spaces/${spaceId()}/invites`).send({}).expect(201)
      ).body as SpaceInvite;
      for (const u of [bob, carol])
        await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
      mods = (
        await t
          .api(alice)
          .post(`/api/spaces/${spaceId()}/roles`)
          .send({ name: 'Mods', permissions: PERM.MANAGE_MESSAGES })
          .expect(201)
      ).body as SpaceRole;
      await t
        .api(alice)
        .put(`/api/spaces/${spaceId()}/members/${carol.id}/roles/${mods.id}`)
        .expect(200);
      await spaceRegistryIdle();
    });

    it('without ADD_REACTIONS a new emoji is refused but joining one is allowed; reactor lists page', async () => {
      const m = await sendOk(t, alice, general().id, 'space message');
      await denyInGeneral(PERM.ADD_REACTIONS);
      try {
        await mine(alice, m.id, '👍').expect(204); // the owner has every bit
        const refused = await mine(bob, m.id, '🎉').expect(403);
        expect(refused.body.error.code).toBe('forbidden');
        const sa = await t.connect(alice);
        const joined = waitForEvent(sa, 'message:reaction-add');
        await mine(bob, m.id, '👍').expect(204); // no read row needed: access is computed
        expect(await joined).toMatchObject({ chatId: general().id, emoji: '👍', userId: bob.id });
        sa.disconnect();
        // The APK's replace route: a refused emoji leaves my reactions alone.
        await t.api(bob).put(`/api/messages/${m.id}/reaction`).send({ emoji: '🎉' }).expect(403);
        const forBob = await seen(bob, general().id, m.id);
        // Space lists are anonymous (counts only); my own choices are listed.
        expect(forBob.reactions).toEqual([{ emoji: '👍', count: 2, userIds: [] }]);
        expect(forBob.myReactions).toEqual(['👍']);
      } finally {
        await denyInGeneral(null);
      }
      expect(await reactors(carol, m.id, '👍')).toEqual([alice.id, bob.id]);
      expect(await reactors(carol, m.id, '👍', '?limit=1')).toEqual([alice.id]);
      expect(await reactors(carol, m.id, '👍', `?limit=1&after=${alice.id}`)).toEqual([bob.id]);
      expect(await reactors(carol, m.id, '👍', `?after=${bob.id}`)).toEqual([]);
      expect(await reactors(carol, m.id, '🎉')).toEqual([]);
    });

    it("another Space's custom emoji needs USE_EXTERNAL_EMOJI there; the Space's own and joining don't", async () => {
      const m = await sendOk(t, alice, general().id, 'emoji time');
      const media = await mkMedia(alice.id, 'image');
      const [own] = await db
        .insert(spaceEmojis)
        .values({ spaceId: spaceId(), name: 'home', mediaId: media.id, createdBy: alice.id })
        .returning();
      const local = `<:home:${own!.id}>`;
      const external = `<:elsewhere:${randomUUID()}>`; // unknown ids count as external
      await denyInGeneral(PERM.USE_EXTERNAL_EMOJI);
      try {
        const refused = await mine(bob, m.id, external).expect(403);
        expect(refused.body.error.code).toBe('forbidden');
        await mine(bob, m.id, local).expect(204);
      } finally {
        await denyInGeneral(null);
      }
      // The bit is implicit for every member; once the emoji is on the message, joining it
      // needs nothing more than seeing it.
      await mine(carol, m.id, external).expect(204);
      await denyInGeneral(PERM.USE_EXTERNAL_EMOJI);
      try {
        await mine(bob, m.id, external).expect(204);
      } finally {
        await denyInGeneral(null);
      }
      expect((await seen(bob, general().id, m.id)).myReactions).toEqual([local, external]);
    });

    it('timed-out members cannot react, not even to join', async () => {
      const m = await sendOk(t, alice, general().id, 'quiet please');
      await mine(alice, m.id, '👍').expect(204);
      await t
        .api(alice)
        .patch(`/api/spaces/${spaceId()}/members/${bob.id}`)
        .send({ timedOutUntil: new Date(Date.now() + 60_000).toISOString() })
        .expect(200);
      await mine(bob, m.id, '👍').expect(403);
      await t
        .api(alice)
        .patch(`/api/spaces/${spaceId()}/members/${bob.id}`)
        .send({ timedOutUntil: null })
        .expect(200);
      await mine(bob, m.id, '👍').expect(204);
    });

    it('MANAGE_MESSAGES removes and clears reactions, with deltas and audit log entries', async () => {
      const m = await sendOk(t, alice, general().id, 'moderated');
      await mine(bob, m.id, '👍').expect(204);
      await mine(alice, m.id, '👍').expect(204);
      await mine(alice, m.id, '🎉').expect(204);
      await t
        .api(bob)
        .delete(`/api/messages/${m.id}/reactions/${enc('👍')}/${alice.id}`)
        .expect(403);
      const sa = await t.connect(alice);
      const removed = waitForEvent(sa, 'message:reaction-remove');
      await t
        .api(carol)
        .delete(`/api/messages/${m.id}/reactions/${enc('👍')}/${bob.id}`)
        .expect(204);
      expect(await removed).toMatchObject({ messageId: m.id, emoji: '👍', userId: bob.id });
      const one = waitForEvent(sa, 'message:reactions-cleared');
      await t
        .api(carol)
        .delete(`/api/messages/${m.id}/reactions/${enc('👍')}`)
        .expect(204);
      expect(await one).toEqual({ chatId: general().id, messageId: m.id, emoji: '👍' });
      const all = waitForEvent(sa, 'message:reactions-cleared');
      await t.api(carol).delete(`/api/messages/${m.id}/reactions`).expect(204);
      expect(await all).toEqual({ chatId: general().id, messageId: m.id, emoji: null });
      // Nothing left: no event, no audit entry.
      await t.api(carol).delete(`/api/messages/${m.id}/reactions`).expect(204);
      sa.disconnect();
      expect(
        await db
          .select()
          .from(messageReactions)
          .where(and(eq(messageReactions.messageId, m.id))),
      ).toEqual([]);

      const log = (await t.api(alice).get(`/api/spaces/${spaceId()}/audit-log`).expect(200))
        .body as SpaceAuditEntry[];
      const entries = log
        .filter((e) => e.action.startsWith('message.'))
        .map((e) => [e.action, e.actorId, e.targetType, e.targetId, e.changes]);
      expect(entries).toEqual([
        [
          'message.reactions_clear',
          carol.id,
          'channel',
          general().id,
          { messageId: m.id, emoji: null },
        ],
        [
          'message.reactions_clear',
          carol.id,
          'channel',
          general().id,
          { messageId: m.id, emoji: '👍' },
        ],
        [
          'message.reaction_remove',
          carol.id,
          'member',
          bob.id,
          { messageId: m.id, channelId: general().id, emoji: '👍' },
        ],
      ]);
    });
  });
});
