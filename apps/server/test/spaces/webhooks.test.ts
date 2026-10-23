/**
 * Webhooks and rich embeds (docs/design/discord-parity.md W10-E). Management with
 * MANAGE_WEBHOOKS in the channel (403 without, 404 for outsiders; roles and overwrites
 * decide), text channels only, WEBHOOKS_PER_CHANNEL, avatars from my uploads, moving between
 * text channels, regenerating the URL (the old one stops working), audit entries, follower
 * webhooks (read-only, deleting unfollows) and the cascade of a deleted channel. Execute,
 * public: the secret checked (404), Discord's body — content, username, avatar_url and
 * embeds copied through the image fetcher (mocked: no network), tts, allowed_mentions with
 * Discord's mention syntax — `?wait`, the per-webhook rate limit with `retry_after`, and the
 * webhook editing and deleting its own messages only. `message:new` / `message:updated`
 * carry the author override and the embeds.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import {
  EMBED_LIMITS,
  MESSAGE_FLAGS,
  PERM,
  WEBHOOKS_PER_CHANNEL,
  type ChatSummary,
  type Message,
  type MessagePage,
  type SpaceAuditEntry,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type Webhook,
  type WebhookWithUrl,
} from '@enbox/shared';
import type * as LinkPreviews from '../../src/services/linkPreviews.js';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { channelFollows, messages, webhooks } from '../../src/db/schema.js';
import { resetWebhookLimits } from '../../src/modules/webhooks/limits.js';
import { toEnboxMentions } from '../../src/modules/webhooks/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { clearEmbedImageMemo } from '../../src/services/embeds.js';
import { cacheRemoteImage } from '../../src/services/linkPreviews.js';
import { insertFollowerWebhook } from '../../src/services/webhooks.js';
import {
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';
import { insertImage } from '../accounts/util.js';

// No network here: an https image "copies" to /uploads/remote/<its file name>, and any URL
// with "broken" in it can't be copied.
vi.mock('../../src/services/linkPreviews.js', async (importOriginal) => ({
  ...(await importOriginal<typeof LinkPreviews>()),
  cacheRemoteImage: vi.fn(async (src: string) =>
    src.includes('broken') ? null : `/uploads/remote/${new URL(src).pathname.split('/').pop()}`,
  ),
}));

const copy = (file: string) => `/uploads/remote/${file}`;
const cdn = (file: string) => `https://cdn.example.com/img/${file}`;

describe('Webhooks', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let alpha: SpaceDetail;
  let beta: SpaceDetail;
  let bobSocket: TestSocket;
  let hook: WebhookWithUrl;
  let crew: SpaceRole;
  const general = (d: SpaceDetail) => d.channels.find((c) => c.name === 'general')!;
  const voice = (d: SpaceDetail) => d.channels.find((c) => c.type === 'space_voice')!;
  const pathOf = (h: WebhookWithUrl) => new URL(h.url).pathname;
  const tokenOf = (h: WebhookWithUrl) => h.url.split('/').pop()!;

  async function invite(d: SpaceDetail, user: TestUser) {
    const inv = (await t.api(owner).post(`/api/spaces/${d.space.id}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(user).post(`/api/invites/${inv.code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  const create = (user: TestUser, chatId: string, body: Record<string, unknown>) =>
    t.api(user).post(`/api/chats/${chatId}/webhooks`).send(body);

  async function newHook(chatId: string, name = 'Hook'): Promise<WebhookWithUrl> {
    return (await create(owner, chatId, { name }).expect(201)).body as WebhookWithUrl;
  }

  async function channel(d: SpaceDetail, body: Record<string, unknown>): Promise<ChatSummary> {
    return (await t.api(owner).post(`/api/spaces/${d.space.id}/channels`).send(body).expect(201))
      .body as ChatSummary;
  }

  const execute = (h: WebhookWithUrl, body: unknown, query = '') =>
    t
      .api()
      .post(`${pathOf(h)}${query}`)
      .send(body as object);

  async function post(h: WebhookWithUrl, body: Record<string, unknown>): Promise<Message> {
    return (await execute(h, body, '?wait=true').expect(200)).body as Message;
  }

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    alpha = (await t.api(owner).post('/api/spaces').send({ name: 'Alpha' }).expect(201))
      .body as SpaceDetail;
    beta = (await t.api(owner).post('/api/spaces').send({ name: 'Beta' }).expect(201))
      .body as SpaceDetail;
    await invite(alpha, bob);
    bobSocket = await t.connect(bob);
  });
  afterAll(() => t.close());
  beforeEach(() => {
    clearEmbedImageMemo();
    vi.mocked(cacheRemoteImage).mockClear();
  });

  it('MANAGE_WEBHOOKS adds webhooks to text channels; the secret URL is shown once, only its hash kept', async () => {
    const res = await create(owner, general(alpha).id, { name: '  Captain Hook  ' }).expect(201);
    hook = res.body as WebhookWithUrl;
    expect(hook).toEqual({
      id: expect.any(String),
      spaceId: alpha.space.id,
      channelId: general(alpha).id,
      kind: 'incoming',
      name: 'Captain Hook',
      avatarUrl: null,
      createdBy: owner.id,
      createdAt: expect.any(String),
      url: expect.stringMatching(
        new RegExp(`^http://localhost:5173/api/webhooks/${hook.id}/[A-Za-z0-9_-]{43}$`),
      ),
    });
    const [row] = await db.select().from(webhooks).where(eq(webhooks.id, hook.id));
    expect(row!.tokenHash).toBe(createHash('sha256').update(tokenOf(hook)).digest('hex'));
    expect(JSON.stringify(row)).not.toContain(tokenOf(hook));

    const { url: _url, ...plain } = hook;
    expect(
      (
        await t
          .api(owner)
          .get(`/api/chats/${general(alpha).id}/webhooks`)
          .expect(200)
      ).body,
    ).toEqual([plain]);
    expect(
      (await t.api(owner).get(`/api/spaces/${alpha.space.id}/webhooks`).expect(200)).body,
    ).toEqual([plain]);

    for (const name of ['', '   ', 'x'.repeat(81)])
      await create(owner, general(alpha).id, { name }).expect(400);
    const notText = await create(owner, voice(alpha).id, { name: 'Voice hook' }).expect(400);
    expect(notText.body.error.message).toBe(
      'Webhooks can only be added to text and announcement channels',
    );
    // An announcement channel is a text channel.
    const news = await channel(alpha, { type: 'space_text', name: 'news', isNews: true });
    await create(owner, news.id, { name: 'News hook' }).expect(201);
  });

  it('members without MANAGE_WEBHOOKS get 403, outsiders 404; a role grants it, a channel overwrite takes it away', async () => {
    const chatId = general(alpha).id;
    await t.api(bob).get(`/api/spaces/${alpha.space.id}/webhooks`).expect(403);
    await t.api(bob).get(`/api/chats/${chatId}/webhooks`).expect(403);
    await create(bob, chatId, { name: 'Mine' }).expect(403);
    await t.api(bob).patch(`/api/webhooks/${hook.id}`).send({ name: 'Mine' }).expect(403);
    await t.api(bob).post(`/api/webhooks/${hook.id}/token`).expect(403);
    await t.api(bob).delete(`/api/webhooks/${hook.id}`).expect(403);

    await t.api(carol).get(`/api/spaces/${alpha.space.id}/webhooks`).expect(404);
    await t.api(carol).get(`/api/chats/${chatId}/webhooks`).expect(404);
    await create(carol, chatId, { name: 'Mine' }).expect(404);
    await t.api(carol).patch(`/api/webhooks/${hook.id}`).send({ name: 'Mine' }).expect(404);
    await t.api(carol).post(`/api/webhooks/${hook.id}/token`).expect(404);
    await t.api(carol).delete(`/api/webhooks/${hook.id}`).expect(404);
    await t
      .api(owner)
      .patch('/api/webhooks/00000000-0000-4000-8000-000000000000')
      .send({ name: 'Nobody' })
      .expect(404);

    crew = (
      await t
        .api(owner)
        .post(`/api/spaces/${alpha.space.id}/roles`)
        .send({ name: 'Hook crew', permissions: PERM.MANAGE_WEBHOOKS })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${alpha.space.id}/members/${bob.id}/roles/${crew.id}`)
      .expect(200);
    const bobs = (await create(bob, chatId, { name: 'Bob hook' }).expect(201))
      .body as WebhookWithUrl;
    expect(bobs.createdBy).toBe(bob.id);
    expect(
      (
        (await t.api(bob).get(`/api/spaces/${alpha.space.id}/webhooks`).expect(200))
          .body as Webhook[]
      ).map((w) => w.name),
    ).toEqual(['Captain Hook', 'News hook', 'Bob hook']);

    // Denied in #general: its webhooks drop out of the Space list and can't be managed.
    await t
      .api(owner)
      .put(`/api/spaces/${alpha.space.id}/channels/${chatId}/overwrites/role/${crew.id}`)
      .send({ allow: 0, deny: PERM.MANAGE_WEBHOOKS })
      .expect(200);
    expect(
      (
        (await t.api(bob).get(`/api/spaces/${alpha.space.id}/webhooks`).expect(200))
          .body as Webhook[]
      ).map((w) => w.name),
    ).toEqual(['News hook']);
    await t.api(bob).delete(`/api/webhooks/${bobs.id}`).expect(403);
    await t
      .api(owner)
      .delete(`/api/spaces/${alpha.space.id}/channels/${chatId}/overwrites/role/${crew.id}`)
      .expect(200);
    await t.api(bob).delete(`/api/webhooks/${bobs.id}`).expect(204);
  });

  it('avatars are my image uploads; PATCH renames, changes or removes the avatar and moves within the Space', async () => {
    const image = await insertImage(owner.id);
    const withAvatar = (
      await create(owner, general(alpha).id, { name: 'Pretty', avatarMediaId: image.id }).expect(
        201,
      )
    ).body as WebhookWithUrl;
    expect(withAvatar.avatarUrl).toBe(`/uploads/${image.storageKey}`);
    await create(owner, general(alpha).id, {
      name: 'Stolen',
      avatarMediaId: (await insertImage(bob.id)).id,
    }).expect(404);
    const gif = await insertImage(owner.id, { mimeType: 'image/gif' });
    await create(owner, general(alpha).id, { name: 'Gif', avatarMediaId: gif.id }).expect(400);

    const renamed = (
      await t
        .api(owner)
        .patch(`/api/webhooks/${withAvatar.id}`)
        .send({ name: 'Prettier' })
        .expect(200)
    ).body as Webhook;
    expect(renamed).toMatchObject({ name: 'Prettier', avatarUrl: withAvatar.avatarUrl });
    expect(renamed).not.toHaveProperty('url');
    const bare = (
      await t
        .api(owner)
        .patch(`/api/webhooks/${withAvatar.id}`)
        .send({ avatarMediaId: null })
        .expect(200)
    ).body as Webhook;
    expect(bare.avatarUrl).toBeNull();

    const other = await channel(alpha, { type: 'space_text', name: 'deploys' });
    const moved = (
      await t
        .api(owner)
        .patch(`/api/webhooks/${withAvatar.id}`)
        .send({ channelId: other.id })
        .expect(200)
    ).body as Webhook;
    expect(moved.channelId).toBe(other.id);
    const toVoice = await t
      .api(owner)
      .patch(`/api/webhooks/${withAvatar.id}`)
      .send({ channelId: voice(alpha).id })
      .expect(400);
    expect(toVoice.body.error.message).toMatch(/text and announcement channels/);
    await t
      .api(owner)
      .patch(`/api/webhooks/${withAvatar.id}`)
      .send({ channelId: general(beta).id })
      .expect(404);

    // Moving needs MANAGE_WEBHOOKS in the target too.
    const bobs = (await create(bob, general(alpha).id, { name: 'Mover' }).expect(201))
      .body as WebhookWithUrl;
    await t
      .api(owner)
      .put(`/api/spaces/${alpha.space.id}/channels/${other.id}/overwrites/role/${crew.id}`)
      .send({ allow: 0, deny: PERM.MANAGE_WEBHOOKS })
      .expect(200);
    await t.api(bob).patch(`/api/webhooks/${bobs.id}`).send({ channelId: other.id }).expect(403);
    await t.api(bob).delete(`/api/webhooks/${bobs.id}`).expect(204);

    const log = (await t.api(owner).get(`/api/spaces/${alpha.space.id}/audit-log`).expect(200))
      .body as SpaceAuditEntry[];
    const entries = log.filter((e) => e.targetId === withAvatar.id);
    expect(entries.map((e) => [e.action, e.changes])).toEqual([
      ['webhook.update', { channelId: [general(alpha).id, other.id] }],
      ['webhook.update', { avatar: 'removed' }],
      ['webhook.update', { name: ['Pretty', 'Prettier'] }],
      ['webhook.create', { name: 'Pretty', channelId: general(alpha).id }],
    ]);
  });

  it(`a channel holds at most ${WEBHOOKS_PER_CHANNEL} webhooks`, async () => {
    const room = await channel(alpha, { type: 'space_text', name: 'crowded' });
    await db.insert(webhooks).values(
      Array.from({ length: WEBHOOKS_PER_CHANNEL - 1 }, (_, i) => ({
        spaceId: alpha.space.id,
        channelId: room.id,
        name: `Filler ${i}`,
        tokenHash: createHash('sha256').update(`filler-${i}`).digest('hex'),
      })),
    );
    await create(owner, room.id, { name: 'Last one' }).expect(201);
    const full = await create(owner, room.id, { name: 'One more' }).expect(409);
    expect(full.body.error).toEqual({
      code: 'limit_reached',
      message: `A channel can have at most ${WEBHOOKS_PER_CHANNEL} webhooks`,
    });
  });

  it('execute: content, username and avatar_url for this message; ?wait answers with it, else 204; message:new carries the override and embeds', async () => {
    const chatId = general(alpha).id;
    const evt = waitForEvent(bobSocket, 'message:new', {
      filter: (p) => p.message.chatId === chatId && p.message.text === 'Build passed',
    });
    const sent = await post(hook, {
      content: 'Build passed',
      username: 'CI',
      avatar_url: cdn('ci.png'),
      embeds: [
        {
          title: 'Build #42',
          description: 'All **green**',
          url: 'https://ci.example.com/42',
          color: 0x57f287,
          timestamp: '2026-10-23T08:00:00+06:00',
          author: { name: 'CI', url: 'https://ci.example.com', icon_url: cdn('ci-icon.png') },
          footer: { text: 'main', icon_url: cdn('branch.png') },
          thumbnail: { url: cdn('thumb.png') },
          image: { url: cdn('chart.png') },
          fields: [
            { name: 'Tests', value: '1204', inline: true },
            { name: 'Time', value: '3m', inline: true },
            { name: 'Notes', value: 'none' },
          ],
        },
      ],
    });
    const embed = {
      title: 'Build #42',
      description: 'All **green**',
      url: 'https://ci.example.com/42',
      color: 0x57f287,
      timestamp: '2026-10-23T02:00:00.000Z',
      author: { name: 'CI', url: 'https://ci.example.com', iconUrl: copy('ci-icon.png') },
      footer: { text: 'main', iconUrl: copy('branch.png') },
      thumbnail: { url: copy('thumb.png') },
      image: { url: copy('chart.png') },
      fields: [
        { name: 'Tests', value: '1204', inline: true },
        { name: 'Time', value: '3m', inline: true },
        { name: 'Notes', value: 'none' },
      ],
    };
    expect(sent).toMatchObject({
      chatId,
      senderId: null,
      clientId: null,
      type: 'text',
      text: 'Build passed',
      authorOverride: {
        kind: 'webhook',
        name: 'CI',
        avatarUrl: copy('ci.png'),
        webhookId: hook.id,
      },
      embeds: [embed],
      mentions: [],
    });
    expect(sent).not.toHaveProperty('flags');
    const got = (await evt).message;
    expect(got).toMatchObject({
      id: sent.id,
      authorOverride: sent.authorOverride,
      embeds: [embed],
    });
    const [row] = await db.select().from(messages).where(eq(messages.id, sent.id));
    expect(row!.webhookId).toBe(hook.id);

    // Without overrides: the webhook's own name and avatar (none here); no wait → 204.
    const quiet = await execute(hook, { content: 'Plain' }).expect(204);
    expect(quiet.text).toBe('');
    const page = (await t.api(bob).get(`/api/chats/${chatId}/messages`).expect(200))
      .body as MessagePage;
    expect(page.messages.find((m) => m.text === 'Plain')).toMatchObject({
      senderId: null,
      authorOverride: {
        kind: 'webhook',
        name: 'Captain Hook',
        avatarUrl: null,
        webhookId: hook.id,
      },
    });
    // An avatar_url that can't be copied falls back to the webhook's avatar.
    const fallback = await post(hook, { content: 'x', avatar_url: cdn('broken.png') });
    expect(fallback.authorOverride?.avatarUrl).toBeNull();
    // tts sets MESSAGE_FLAGS.TTS.
    const spoken = await post(hook, { content: 'Read me', tts: true });
    expect(spoken.flags).toBe(MESSAGE_FLAGS.TTS);
  });

  it('embeds: images that cannot be copied are left out (each URL fetched once); limits and validation errors', async () => {
    const icon = cdn('shared-icon.png');
    const sent = await post(hook, {
      embeds: [
        {
          title: 'One',
          image: { url: cdn('broken-image.png') },
          footer: { text: 'f', icon_url: icon },
        },
        { title: 'Two', author: { name: 'a', icon_url: icon } },
        { thumbnail: { url: cdn('broken-thumb.png') } },
      ],
    });
    expect(sent.text).toBeNull();
    expect(sent.embeds).toEqual([
      { title: 'One', footer: { text: 'f', iconUrl: copy('shared-icon.png') } },
      { title: 'Two', author: { name: 'a', iconUrl: copy('shared-icon.png') } },
    ]);
    expect(
      vi
        .mocked(cacheRemoteImage)
        .mock.calls.map((c) => c[0])
        .filter((u) => u === icon),
    ).toHaveLength(1);
    const nothing = await execute(hook, { embeds: [{ image: { url: cdn('broken.png') } }] }).expect(
      400,
    );
    expect(nothing.body.error.message).toBe("embeds: None of the embeds' images could be loaded");

    const bad: [unknown, RegExp][] = [
      [{}, /Send content or at least one embed/],
      [{ content: '   ' }, /Send content or at least one embed/],
      [{ content: 'x'.repeat(2001) }, /content/],
      [{ embeds: Array.from({ length: 11 }, () => ({ title: 't' })) }, /embeds/],
      [{ embeds: [{ title: 'x'.repeat(EMBED_LIMITS.title + 1) }] }, /embeds\.0\.title/],
      [{ embeds: [{}] }, /embeds\.0: An embed needs/],
      [{ embeds: [{ title: 't', url: 'http://example.com' }] }, /https URL/],
      [{ embeds: [{ title: 't', color: 0x1000000 }] }, /color/],
      [{ embeds: [{ fields: [{ name: ' ', value: 'v' }] }] }, /embeds\.0\.fields\.0\.name/],
      [
        { embeds: [{ description: 'd'.repeat(4000) }, { description: 'd'.repeat(2001) }] },
        new RegExp(`at most ${EMBED_LIMITS.total} characters`),
      ],
      [
        { content: 'hi', allowed_mentions: { parse: ['users'], users: [bob.id] } },
        /allowed_mentions/,
      ],
    ];
    for (const [body, message] of bad) {
      const res = await execute(hook, body).expect(400);
      expect(res.body.error.message, JSON.stringify(body).slice(0, 80)).toMatch(message);
    }
    // null means "not given" (Discord libraries send it).
    await execute(hook, { content: 'nulls', username: null, embeds: null }).expect(204);
    // JSON bodies only.
    const form = await t.api().post(pathOf(hook)).type('form').send('content=hi').expect(400);
    expect(form.body.error.message).toMatch(/JSON/);
  });

  it('the secret: unknown ids, wrong or malformed tokens and follower webhooks are 404; regenerating retires the old URL', async () => {
    const token = tokenOf(hook);
    const wrong = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    await t.api().post(`/api/webhooks/${hook.id}/${wrong}`).send({ content: 'x' }).expect(404);
    await t.api().post(`/api/webhooks/${hook.id}/short`).send({ content: 'x' }).expect(404);
    await t
      .api()
      .post(`/api/webhooks/00000000-0000-4000-8000-000000000000/${token}`)
      .send({ content: 'x' })
      .expect(404);
    await t.api().post(`/api/webhooks/1234567890/${token}`).send({ content: 'x' }).expect(404);

    const old = hook;
    await execute(old, { content: 'before' }).expect(204);
    const fresh = (await t.api(owner).post(`/api/webhooks/${hook.id}/token`).expect(200))
      .body as WebhookWithUrl;
    expect(fresh.id).toBe(old.id);
    expect(fresh.url).not.toBe(old.url);
    await execute(old, { content: 'after' }).expect(404);
    await execute(fresh, { content: 'after' }).expect(204);
    hook = fresh;
    const log = (await t.api(owner).get(`/api/spaces/${alpha.space.id}/audit-log`).expect(200))
      .body as SpaceAuditEntry[];
    expect(log.find((e) => e.targetId === hook.id)).toMatchObject({
      action: 'webhook.update',
      changes: { url: 'regenerated' },
    });
  });

  it('allowed_mentions: users by default, @everyone and roles only when allowed; Discord mention syntax becomes tokens', async () => {
    expect(toEnboxMentions('hi @everyone and @here, mail x@here.com, @{everyone}')).toBe(
      'hi @{everyone} and @{here}, mail x@here.com, @{everyone}',
    );
    const ops = (
      await t
        .api(owner)
        .post(`/api/spaces/${alpha.space.id}/roles`)
        .send({ name: 'Ops' })
        .expect(201)
    ).body as SpaceRole;
    const content = `Deploy @everyone <@${bob.id}> <@!${owner.id.toUpperCase()}> <@&${ops.id}> <@${carol.id}>`;

    const plain = await post(hook, { content });
    expect(plain.text).toBe(
      `Deploy @{everyone} @{${bob.id}} @{${owner.id}} @{role:${ops.id}} @{${carol.id}}`,
    );
    // Carol isn't a member: her token stays text.
    expect(plain).toMatchObject({
      mentions: [bob.id, owner.id],
      mentionEveryone: false,
      mentionRoleIds: [],
    });

    const everyoneOnly = await post(hook, { content, allowed_mentions: { parse: ['everyone'] } });
    expect(everyoneOnly).toMatchObject({ mentions: [], mentionEveryone: true, mentionRoleIds: [] });
    const all = await post(hook, {
      content,
      allowed_mentions: { parse: ['users', 'roles', 'everyone'] },
    });
    expect(all).toMatchObject({
      mentions: [bob.id, owner.id],
      mentionEveryone: true,
      mentionRoleIds: [ops.id],
    });
    const listed = await post(hook, {
      content,
      allowed_mentions: { users: [bob.id], roles: [ops.id] },
    });
    expect(listed).toMatchObject({
      mentions: [bob.id],
      mentionEveryone: false,
      mentionRoleIds: [ops.id],
    });
    const none = await post(hook, { content, allowed_mentions: { parse: [] } });
    expect(none).toMatchObject({ mentions: [], mentionEveryone: false, mentionRoleIds: [] });
    const [row] = await db.select().from(messages).where(eq(messages.id, listed.id));
    expect(row).toMatchObject({ mentions: [bob.id], mentionRoleIds: [ops.id] });
    // A role of another Space never pings.
    const foreign = beta.space.roles.find((r) => r.isDefault)!.id;
    const elsewhere = await post(hook, {
      content: `<@&${foreign}>`,
      allowed_mentions: { parse: ['roles'] },
    });
    expect(elsewhere.mentionRoleIds).toEqual([]);
  });

  it('a webhook edits and deletes its own messages only; message:updated reaches the channel', async () => {
    const chatId = general(alpha).id;
    const other = await newHook(chatId, 'Other');
    const mine = await post(hook, { content: `Status: <@${bob.id}> pending` });
    expect(mine.mentions).toEqual([bob.id]);
    const base = `${pathOf(hook)}/messages/${mine.id}`;

    const updated = waitForEvent(bobSocket, 'message:updated', {
      filter: (p) => p.message.id === mine.id,
    });
    const edited = (
      await t
        .api()
        .patch(base)
        .send({
          content: `Status: done <@${owner.id}>`,
          embeds: [{ title: 'Done', color: 0xff0000 }],
        })
        .expect(200)
    ).body as Message;
    expect(edited).toMatchObject({
      id: mine.id,
      text: `Status: done @{${owner.id}}`,
      embeds: [{ title: 'Done', color: 0xff0000 }],
      // Edits never ping again: bob's mention is gone with its token, owner's isn't added.
      mentions: [],
      editedAt: expect.any(String),
      authorOverride: mine.authorOverride,
    });
    expect((await updated).message).toMatchObject({ id: mine.id, text: edited.text });
    // Only the embeds: the content stays.
    const embedsOnly = (await t.api().patch(base).send({ embeds: [] }).expect(200)).body as Message;
    expect(embedsOnly.text).toBe(edited.text);
    expect(embedsOnly).not.toHaveProperty('embeds');
    await t.api().patch(base).send({ content: '' }).expect(400);

    // Someone else's message, through this webhook or another: unknown.
    await t
      .api()
      .patch(`${pathOf(other)}/messages/${mine.id}`)
      .send({ content: 'x' })
      .expect(404);
    await t
      .api()
      .delete(`${pathOf(other)}/messages/${mine.id}`)
      .expect(404);
    const user = (
      await t
        .api(owner)
        .post(`/api/chats/${chatId}/messages`)
        .send({ clientId: 'user-msg', type: 'text', text: 'by a person' })
        .expect(201)
    ).body as Message;
    await t
      .api()
      .patch(`${pathOf(hook)}/messages/${user.id}`)
      .send({ content: 'x' })
      .expect(404);
    await t
      .api()
      .delete(`${pathOf(hook)}/messages/${user.id}`)
      .expect(404);

    await t.api().delete(base).expect(204);
    const page = (await t.api(bob).get(`/api/chats/${chatId}/messages`).expect(200))
      .body as MessagePage;
    const tomb = page.messages.find((m) => m.id === mine.id)!;
    expect(tomb).toMatchObject({ deletedAt: expect.any(String), text: null });
    expect(tomb).not.toHaveProperty('embeds');
    await t.api().delete(base).expect(404);
    await t.api().patch(base).send({ content: 'again' }).expect(404);

    // Replies to webhook messages work (nobody to ping).
    const target = await post(hook, { content: 'reply to me' });
    const reply = (
      await t
        .api(bob)
        .post(`/api/chats/${chatId}/messages`)
        .send({ clientId: 'reply-1', type: 'text', text: 'ok', replyToId: target.id })
        .expect(201)
    ).body as Message;
    expect(reply).toMatchObject({ replyTo: { id: target.id, senderId: null }, mentions: [] });
  });

  it('5 requests per 2 seconds per webhook: then 429 with retry_after; other webhooks keep theirs', async () => {
    const a = await newHook(general(alpha).id, 'Busy');
    const b = await newHook(general(alpha).id, 'Calm');
    resetWebhookLimits();
    config.rateLimit = true;
    try {
      for (let i = 0; i < 5; i++) await execute(a, { content: `burst ${i}` }).expect(204);
      const limited = await execute(a, { content: 'one too many' }).expect(429);
      expect(limited.body).toMatchObject({
        error: { code: 'rate_limited' },
        retry_after: expect.any(Number),
        global: false,
      });
      expect(limited.body.retry_after).toBeGreaterThan(0);
      expect(limited.body.retry_after).toBeLessThanOrEqual(2);
      expect(Number(limited.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      await execute(b, { content: 'calm' }).expect(204);
    } finally {
      config.rateLimit = false;
      resetWebhookLimits();
    }
  });

  it('follower webhooks: listed with their source, read-only here; deleting one unfollows', async () => {
    const source = await channel(beta, { type: 'space_text', name: 'announcements', isNews: true });
    const target = await channel(alpha, { type: 'space_text', name: 'followed' });
    const follower = await db.transaction((tx) =>
      insertFollowerWebhook(tx, {
        spaceId: alpha.space.id,
        channelId: target.id,
        sourceChannelId: source.id,
        name: 'Beta #announcements',
        avatarMediaId: null,
        createdBy: owner.id,
      }),
    );
    await db.insert(channelFollows).values({
      sourceChannelId: source.id,
      targetChannelId: target.id,
      webhookId: follower.id,
      createdBy: owner.id,
    });
    const listed = (
      (await t.api(owner).get(`/api/chats/${target.id}/webhooks`).expect(200)).body as Webhook[]
    )[0];
    expect(listed).toEqual({
      id: follower.id,
      spaceId: alpha.space.id,
      channelId: target.id,
      kind: 'follower',
      name: 'Beta #announcements',
      avatarUrl: null,
      createdBy: owner.id,
      createdAt: expect.any(String),
      sourceChannel: {
        id: source.id,
        name: 'announcements',
        spaceId: beta.space.id,
        spaceName: 'Beta',
      },
    });
    await t.api(owner).patch(`/api/webhooks/${follower.id}`).send({ name: 'Renamed' }).expect(400);
    await t.api(owner).post(`/api/webhooks/${follower.id}/token`).expect(400);
    // No secret: nothing outside the server posts through it.
    await t
      .api()
      .post(`/api/webhooks/${follower.id}/${'A'.repeat(43)}`)
      .send({ content: 'x' })
      .expect(404);
    await t.api(owner).delete(`/api/webhooks/${follower.id}`).expect(204);
    expect(
      await db.select().from(channelFollows).where(eq(channelFollows.targetChannelId, target.id)),
    ).toEqual([]);
  });

  it('deleting a webhook keeps its messages; deleting the channel deletes its webhooks', async () => {
    const room = await channel(alpha, { type: 'space_text', name: 'temporary' });
    const temp = await newHook(room.id, 'Temp');
    const sent = await post(temp, { content: 'still here' });
    await t.api(owner).delete(`/api/webhooks/${temp.id}`).expect(204);
    await execute(temp, { content: 'gone' }).expect(404);
    const page = (await t.api(owner).get(`/api/chats/${room.id}/messages`).expect(200))
      .body as MessagePage;
    expect(page.messages.find((m) => m.id === sent.id)).toMatchObject({
      text: 'still here',
      authorOverride: { kind: 'webhook', name: 'Temp' },
    });
    const log = (await t.api(owner).get(`/api/spaces/${alpha.space.id}/audit-log`).expect(200))
      .body as SpaceAuditEntry[];
    expect(log.find((e) => e.targetId === temp.id)).toMatchObject({
      action: 'webhook.delete',
      changes: { name: 'Temp', channelId: room.id },
    });

    const doomed = await newHook(room.id, 'Doomed');
    await t.api(owner).delete(`/api/spaces/${alpha.space.id}/channels/${room.id}`).expect(204);
    expect(await db.select().from(webhooks).where(eq(webhooks.id, doomed.id))).toEqual([]);
    await execute(doomed, { content: 'x' }).expect(404);
  });
});
