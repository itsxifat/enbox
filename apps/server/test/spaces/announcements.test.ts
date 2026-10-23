/**
 * Announcement channels (Publish and Follow): creating and converting them (text only),
 * following one into channels of another Space (permissions, the same channel, duplicates,
 * the follower webhook, the notice, the lists), publishing (author or MANAGE_MESSAGES, once,
 * announcement channels only, copies are final) with delivery to two followers in another
 * Space, edits and deletes following to the copies, the hourly limit, and unfollowing.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import {
  MESSAGE_FLAGS,
  PUBLISH_LIMIT_PER_HOUR,
  hasMessageFlag,
  type ChannelFollow,
  type ChatSummary,
  type Message,
  type MessagePage,
  type SpaceDetail,
  type SpaceInvite,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { channelFollows, messages, spaceAuditLog, webhooks } from '../../src/db/schema.js';
import { crosspostIdle } from '../../src/modules/announcements/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';

describe('announcement channels', () => {
  let t: TestServer;
  /** Owner of Space A (Rockets), with the announcement channel #news. */
  let owner: TestUser;
  /** A member of Space A. */
  let bob: TestUser;
  /** Owner of Space B (Fans) and a member of A: follows #news into B. */
  let carol: TestUser;
  /** A member of Space B only. */
  let dave: TestUser;
  let a: SpaceDetail;
  let b: SpaceDetail;
  let news: ChatSummary;
  let updates: ChatSummary;
  const aGeneral = () => a.channels.find((c) => c.name === 'general')!;
  const bGeneral = () => b.channels.find((c) => c.name === 'general')!;
  const bVoice = () => b.channels.find((c) => c.type === 'space_voice')!;

  async function joinSpace(space: SpaceDetail, by: TestUser, users: TestUser[]) {
    const invite = (
      await t.api(by).post(`/api/spaces/${space.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    for (const u of users) await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  async function createChannel(user: TestUser, space: SpaceDetail, body: object, status = 201) {
    const res = await t
      .api(user)
      .post(`/api/spaces/${space.space.id}/channels`)
      .send(body)
      .expect(status);
    await spaceRegistryIdle();
    return res.body as ChatSummary;
  }

  let n = 0;
  async function send(user: TestUser, chatId: string, text: string) {
    const res = await t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId: `c${++n}`, type: 'text', text })
      .expect(201);
    return res.body as Message;
  }

  const publish = (user: TestUser, messageId: string) =>
    t.api(user).post(`/api/messages/${messageId}/crosspost`);

  const follow = (user: TestUser, sourceId: string, targetChannelId: string) =>
    t.api(user).post(`/api/chats/${sourceId}/followers`).send({ targetChannelId });

  const page = async (user: TestUser, chatId: string) =>
    ((await t.api(user).get(`/api/chats/${chatId}/messages`).expect(200)).body as MessagePage)
      .messages;

  const copiesOf = (sourceId: string) =>
    db.select().from(messages).where(eq(messages.crosspostOf, sourceId));

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol, dave] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
      await t.createUser({ displayName: 'Dave' }),
    ];
    a = (await t.api(owner).post('/api/spaces').send({ name: 'Rockets' }).expect(201))
      .body as SpaceDetail;
    b = (await t.api(carol).post('/api/spaces').send({ name: 'Fans' }).expect(201))
      .body as SpaceDetail;
    await joinSpace(a, owner, [bob, carol]);
    await joinSpace(b, carol, [dave]);
  });
  afterAll(() => t.close());

  it('creates announcement channels and converts text channels (MANAGE_CHANNELS, text only)', async () => {
    news = await createChannel(owner, a, { type: 'space_text', name: 'News', isNews: true });
    expect(news).toMatchObject({ type: 'space_text', name: 'news', space: { isNews: true } });
    expect(aGeneral().space?.isNews).toBe(false);
    await createChannel(owner, a, { type: 'space_voice', name: 'Talk', isNews: true }, 400);
    await createChannel(bob, a, { type: 'space_text', name: 'mine', isNews: true }, 403);

    // Convert #updates of Space B to an announcement channel and back: chat:updated each time.
    updates = await createChannel(carol, b, { type: 'space_text', name: 'updates' });
    expect(updates.space?.isNews).toBe(false);
    const sd = await t.connect(dave);
    const converted = waitForEvent(sd, 'chat:updated', {
      filter: (p) => p.chatId === updates.id && p.changes.space?.isNews === true,
    });
    const url = `/api/spaces/${b.space.id}/channels/${updates.id}`;
    const on = (await t.api(carol).patch(url).send({ isNews: true }).expect(200))
      .body as ChatSummary;
    expect(on.space?.isNews).toBe(true);
    await converted;
    await t.api(dave).patch(url).send({ isNews: false }).expect(403);
    const off = (await t.api(carol).patch(url).send({ isNews: false }).expect(200))
      .body as ChatSummary;
    expect(off.space?.isNews).toBe(false);
    await t
      .api(carol)
      .patch(`/api/spaces/${b.space.id}/channels/${bVoice().id}`)
      .send({ isNews: true })
      .expect(400);
    // A clone stays an announcement channel.
    const clone = (
      await t
        .api(owner)
        .post(`/api/spaces/${a.space.id}/channels/${news.id}/clone`)
        .send({ name: 'news-copy' })
        .expect(201)
    ).body as ChatSummary;
    expect(clone.space?.isNews).toBe(true);
    await t.api(owner).delete(`/api/spaces/${a.space.id}/channels/${clone.id}`).expect(204);
    sd.disconnect();
  });

  let toGeneral: ChannelFollow;
  let toUpdates: ChannelFollow;

  it('follows into a text channel where I have MANAGE_WEBHOOKS: webhook, notice, audit; refusals', async () => {
    // The source must be an announcement channel I can see.
    await follow(dave, news.id, bGeneral().id).expect(404);
    await follow(carol, aGeneral().id, bGeneral().id).expect(400);
    // The target: a text channel, not the source itself, where I have MANAGE_WEBHOOKS.
    await follow(carol, news.id, news.id).expect(400);
    await follow(carol, news.id, bVoice().id).expect(400);
    await follow(bob, news.id, bGeneral().id).expect(404);
    await joinSpace(b, carol, [bob]);
    await follow(bob, news.id, bGeneral().id).expect(403);

    const sd = await t.connect(dave);
    const notice = waitForEvent(sd, 'message:new', {
      filter: (p) => p.message.chatId === bGeneral().id && p.message.type === 'system',
    });
    toGeneral = (await follow(carol, news.id, bGeneral().id).expect(201)).body as ChannelFollow;
    expect(toGeneral).toMatchObject({
      sourceChannel: {
        id: news.id,
        name: 'news',
        spaceId: a.space.id,
        spaceName: 'Rockets',
        spaceIconUrl: null,
      },
      targetChannel: { id: bGeneral().id, name: 'general', spaceId: b.space.id },
      createdBy: carol.id,
    });
    expect((await notice).message.system).toEqual({
      kind: 'channel_followed',
      actorId: carol.id,
      channelId: news.id,
      spaceName: 'Rockets',
      channelName: 'news',
    });
    const [hook] = await db.select().from(webhooks).where(eq(webhooks.id, toGeneral.webhookId!));
    expect(hook).toMatchObject({
      kind: 'follower',
      name: 'Rockets',
      channelId: bGeneral().id,
      spaceId: b.space.id,
      sourceChannelId: news.id,
      tokenHash: null,
    });
    const audits = await db
      .select()
      .from(spaceAuditLog)
      .where(
        and(eq(spaceAuditLog.spaceId, b.space.id), eq(spaceAuditLog.action, 'channel.follow')),
      );
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actorId: carol.id, targetId: bGeneral().id });

    await follow(carol, news.id, bGeneral().id).expect(409);
    toUpdates = (await follow(carol, news.id, updates.id).expect(201)).body as ChannelFollow;

    // The lists: channels followed into B (MANAGE_WEBHOOKS there), followers of #news (in it).
    const followed = (await t.api(carol).get(`/api/spaces/${b.space.id}/follows`).expect(200))
      .body as ChannelFollow[];
    expect(followed.map((f) => f.targetChannel.name).sort()).toEqual(['general', 'updates']);
    await t.api(dave).get(`/api/spaces/${b.space.id}/follows`).expect(403);
    const followers = (await t.api(owner).get(`/api/chats/${news.id}/followers`).expect(200))
      .body as ChannelFollow[];
    expect(followers.map((f) => f.id).sort()).toEqual([toGeneral.id, toUpdates.id].sort());
    await t.api(bob).get(`/api/chats/${news.id}/followers`).expect(403);
    sd.disconnect();
  });

  let published: Message;

  it('publishes (author or MANAGE_MESSAGES, once) and delivers a copy to each follower', async () => {
    const mine = await send(bob, news.id, 'Launch at **noon** @{' + owner.id + '} @everyone');
    const owners = await send(owner, news.id, 'From the owner');
    await publish(bob, owners.id).expect(403);
    await publish(carol, mine.id).expect(403);
    const general = await send(bob, aGeneral().id, 'not news');
    await publish(bob, general.id).expect(400);

    const sd = await t.connect(dave);
    const sb = await t.connect(bob);
    const copies = new Map<string, Message>();
    const both = new Promise<void>((resolve) =>
      sd.on('message:new', (p) => {
        if (p.message.authorOverride?.kind !== 'crosspost') return;
        copies.set(p.message.chatId, p.message);
        if (copies.size === 2) resolve();
      }),
    );
    const flagged = waitForEvent(sb, 'message:updated', {
      filter: (p) => p.message.id === mine.id,
    });
    published = (await publish(bob, mine.id).expect(200)).body as Message;
    expect(hasMessageFlag(published.flags, MESSAGE_FLAGS.CROSSPOSTED)).toBe(true);
    expect(hasMessageFlag((await flagged).message.flags, MESSAGE_FLAGS.CROSSPOSTED)).toBe(true);
    await publish(bob, mine.id).expect(409);
    await both;

    for (const target of [bGeneral().id, updates.id]) {
      const copy = copies.get(target)!;
      expect(copy).toMatchObject({
        chatId: target,
        senderId: null,
        type: 'text',
        text: published.text,
        mentionEveryone: false,
        mentionRoleIds: [],
        authorOverride: {
          kind: 'crosspost',
          name: 'Rockets #news',
          avatarUrl: null,
          source: {
            spaceId: a.space.id,
            spaceName: 'Rockets',
            channelId: news.id,
            channelName: 'news',
            messageId: mine.id,
          },
        },
      });
      expect(copy.flags).toBe(MESSAGE_FLAGS.IS_CROSSPOST);
    }
    expect(copies.get(bGeneral().id)!.authorOverride?.webhookId).toBe(toGeneral.webhookId);
    // The owner (MANAGE_MESSAGES) publishes others' messages; a copy is never published again.
    await publish(owner, owners.id).expect(200);
    await crosspostIdle();
    const copy = (await page(dave, bGeneral().id)).find((m) => m.text === published.text)!;
    expect(copy.authorOverride?.kind).toBe('crosspost');
    await t
      .api(carol)
      .patch(`/api/spaces/${b.space.id}/channels/${updates.id}`)
      .send({ isNews: true })
      .expect(200);
    const updatesCopy = (await copiesOf(mine.id)).find((m) => m.chatId === updates.id)!;
    await publish(carol, updatesCopy.id).expect(400);
    sd.disconnect();
    sb.disconnect();
  });

  it('edits and deletes of a published message follow to its copies', async () => {
    const sd = await t.connect(dave);
    const edited = new Set<string>();
    const bothEdited = new Promise<void>((resolve) =>
      sd.on('message:updated', (p) => {
        if (p.message.text !== 'Launch moved to 1pm') return;
        edited.add(p.message.chatId);
        if (edited.size === 2) resolve();
      }),
    );
    await t
      .api(bob)
      .patch(`/api/messages/${published.id}`)
      .send({ text: 'Launch moved to 1pm' })
      .expect(200);
    await bothEdited;
    await crosspostIdle();
    for (const c of await copiesOf(published.id)) {
      expect(c.text).toBe('Launch moved to 1pm');
      expect(c.editedAt).not.toBeNull();
    }

    const deleted = new Set<string>();
    const bothDeleted = new Promise<void>((resolve) =>
      sd.on('message:updated', (p) => {
        if (!p.message.deletedAt || p.message.authorOverride?.kind !== 'crosspost') return;
        deleted.add(p.message.chatId);
        if (deleted.size === 2) resolve();
      }),
    );
    await t.api(bob).delete(`/api/messages/${published.id}`).query({ for: 'everyone' }).expect(204);
    await bothDeleted;
    await crosspostIdle();
    for (const c of await copiesOf(published.id)) {
      expect(c.deletedAt).not.toBeNull();
      expect(c.text).toBeNull();
    }
    sd.disconnect();
  });

  it(`publishes at most ${PUBLISH_LIMIT_PER_HOUR} messages an hour per channel (429)`, async () => {
    // Two published so far in #news this hour.
    for (let i = 2; i < PUBLISH_LIMIT_PER_HOUR; i++) {
      const m = await send(owner, news.id, `update ${i}`);
      await publish(owner, m.id).expect(200);
    }
    const over = await send(owner, news.id, 'one too many');
    await publish(owner, over.id).expect(429);
    // Per channel: another announcement channel of the Space still publishes.
    const other = await createChannel(owner, a, {
      type: 'space_text',
      name: 'press',
      isNews: true,
    });
    const m = await send(owner, other.id, 'press release');
    await publish(owner, m.id).expect(200);
    await crosspostIdle();
  });

  it('unfollows (MANAGE_WEBHOOKS in the target): the webhook goes and nothing more arrives', async () => {
    await t.api(dave).delete(`/api/channel-follows/${toGeneral.id}`).expect(403);
    await t.api(carol).delete(`/api/channel-follows/${toGeneral.id}`).expect(204);
    await t.api(carol).delete(`/api/channel-follows/${toGeneral.id}`).expect(404);
    expect(await db.select().from(webhooks).where(eq(webhooks.id, toGeneral.webhookId!))).toEqual(
      [],
    );
    const left = (await t.api(carol).get(`/api/spaces/${b.space.id}/follows`).expect(200))
      .body as ChannelFollow[];
    expect(left.map((f) => f.id)).toEqual([toUpdates.id]);

    // A follow whose webhook was deleted delivers nothing; following again replaces it.
    await db.delete(webhooks).where(eq(webhooks.id, toUpdates.webhookId!));
    // (The hour's publishes are spent: start a new hour.)
    await db.delete(spaceAuditLog).where(eq(spaceAuditLog.action, 'message.publish'));
    const m = await send(owner, news.id, 'after unfollowing');
    await publish(owner, m.id).expect(200);
    await crosspostIdle();
    expect(await copiesOf(m.id)).toEqual([]);
    const again = (await follow(carol, news.id, updates.id).expect(201)).body as ChannelFollow;
    expect(again.id).not.toBe(toUpdates.id);
    expect(
      await db.select().from(channelFollows).where(eq(channelFollows.targetChannelId, updates.id)),
    ).toHaveLength(1);
    // The next publish reaches #updates through the new webhook.
    const next = await send(owner, news.id, 'welcome back');
    await publish(owner, next.id).expect(200);
    await crosspostIdle();
    const [copy] = await copiesOf(next.id);
    expect(copy).toMatchObject({ chatId: updates.id, webhookId: again.webhookId });
  });
});
