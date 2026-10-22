/**
 * Custom Space emoji: CRUD with MANAGE_EMOJI (any member reads, non-members get 404), name
 * rules and case-insensitive uniqueness (409), the free 250 cap, image checks (mine, type,
 * size, a poster when animated), `space:emojis` to the Space room, the picker groups of
 * `GET /me/emojis`, the public cacheable redirect of `GET /emojis/:id`, and other Spaces'
 * emoji in Space channels (USE_EXTERNAL_EMOJI, `:name:` without it).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_EMOJI_BYTES,
  PERM,
  SPACE_EMOJI_LIMIT,
  customEmojiToken,
  type Message,
  type SpaceDetail,
  type SpaceEmoji,
  type SpaceEmojiGroup,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { media, spaceEmojis } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { insertImage } from '../accounts/util.js';
import { ANIMATED_GIF, PNG, STATIC_WEBP } from '../support/images.js';

describe('custom Space emoji', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let a: SpaceDetail;
  let b: SpaceDetail;
  const base = (d: SpaceDetail) => `/api/spaces/${d.space.id}/emojis`;
  const general = (d: SpaceDetail) => d.channels.find((c) => c.name === 'general')!;

  async function invite(d: SpaceDetail, user: TestUser) {
    const inv = (await t.api(owner).post(`/api/spaces/${d.space.id}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    await t.api(user).post(`/api/invites/${inv.code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  async function upload(user: TestUser, file: Buffer, name: string, poster?: Buffer) {
    let req = t.api(user).post('/api/media').field('kind', 'image').attach('file', file, name);
    if (poster) req = req.attach('thumbnail', poster, 'poster.webp');
    return (await req.expect(201)).body as { id: string; url: string; animated: boolean };
  }

  const create = (user: TestUser, d: SpaceDetail, body: Record<string, unknown>) =>
    t.api(user).post(base(d)).send(body);

  async function sendText(user: TestUser, chatId: string, text: string) {
    return (
      await t
        .api(user)
        .post(`/api/chats/${chatId}/messages`)
        .send({ clientId: Math.random().toString(36).slice(2), type: 'text', text })
        .expect(201)
    ).body as Message;
  }

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    a = (await t.api(owner).post('/api/spaces').send({ name: 'Alpha' }).expect(201)).body as SpaceDetail;
    b = (await t.api(owner).post('/api/spaces').send({ name: 'Beta' }).expect(201)).body as SpaceDetail;
    await invite(a, bob);
    await invite(b, bob);
  });
  afterAll(() => t.close());

  let blob: SpaceEmoji;

  it('MANAGE_EMOJI uploads; every member reads the list; non-members get 404', async () => {
    const image = await upload(owner, PNG, 'blob.png');
    blob = (await create(owner, a, { name: 'blob', mediaId: image.id }).expect(201)).body as SpaceEmoji;
    expect(blob).toEqual({
      id: expect.any(String),
      spaceId: a.space.id,
      name: 'blob',
      url: image.url,
      animated: false,
      createdBy: owner.id,
    });
    expect((await t.api(bob).get(base(a)).expect(200)).body).toEqual([blob]);
    await t.api(carol).get(base(a)).expect(404);
    await t.api(carol).patch(`${base(a)}/${blob.id}`).send({ name: 'mine' }).expect(404);
  });

  it('members without MANAGE_EMOJI get 403 until a role grants it', async () => {
    const image = await upload(bob, PNG, 'cat.png');
    await create(bob, a, { name: 'cat', mediaId: image.id }).expect(403);
    await t.api(bob).patch(`${base(a)}/${blob.id}`).send({ name: 'blobby' }).expect(403);
    await t.api(bob).delete(`${base(a)}/${blob.id}`).expect(403);
    const role = (
      await t
        .api(owner)
        .post(`/api/spaces/${a.space.id}/roles`)
        .send({ name: 'Emoji crew', permissions: PERM.MANAGE_EMOJI })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${a.space.id}/members/${bob.id}/roles/${role.id}`)
      .expect(200);
    const cat = (await create(bob, a, { name: 'cat', mediaId: image.id }).expect(201)).body as SpaceEmoji;
    expect(cat).toMatchObject({ name: 'cat', createdBy: bob.id });
    // Someone else's upload is not mine to use.
    const other = await insertImage(owner.id);
    await create(bob, a, { name: 'stolen', mediaId: other.id }).expect(404);
    await t.api(bob).delete(`${base(a)}/${cat.id}`).expect(204);
  });

  it('names: 2-32 of [A-Za-z0-9_], unique per Space ignoring case (409)', async () => {
    const m = await insertImage(owner.id);
    for (const name of ['a', 'bad-name', 'x'.repeat(33), 'sp ace'])
      await create(owner, a, { name, mediaId: m.id }).expect(400);
    const dup = await create(owner, a, { name: 'BLOB', mediaId: m.id }).expect(409);
    expect(dup.body.error.code).toBe('conflict');
    // The same name in another Space is fine.
    const inB = (await create(owner, b, { name: 'blob', mediaId: m.id }).expect(201)).body as SpaceEmoji;
    // Renames: a case change of my own name is fine, another emoji's name is not.
    const other = (await create(owner, a, { name: 'wave', mediaId: m.id }).expect(201)).body as SpaceEmoji;
    await t.api(owner).patch(`${base(a)}/${other.id}`).send({ name: 'Blob' }).expect(409);
    const renamed = (await t.api(owner).patch(`${base(a)}/${other.id}`).send({ name: 'Wave_2' }).expect(200))
      .body as SpaceEmoji;
    expect(renamed).toMatchObject({ id: other.id, name: 'Wave_2' });
    await t.api(owner).patch(`${base(a)}/${other.id}`).send({ name: 'nope!' }).expect(400);
    await t.api(owner).patch(`${base(b)}/${other.id}`).send({ name: 'elsewhere' }).expect(404);
    await t.api(owner).delete(`${base(a)}/${other.id}`).expect(204);
    await t.api(owner).delete(`${base(a)}/${other.id}`).expect(404);
    await t.api(owner).delete(`${base(b)}/${inB.id}`).expect(204);
  });

  it('images: PNG/JPEG/WebP/GIF up to MAX_EMOJI_BYTES; animated ones need a poster', async () => {
    const avif = await insertImage(owner.id, { mimeType: 'image/avif' });
    await create(owner, a, { name: 'avif', mediaId: avif.id }).expect(400);
    const big = await insertImage(owner.id, { size: MAX_EMOJI_BYTES + 1 });
    await create(owner, a, { name: 'big', mediaId: big.id }).expect(400);
    const bare = await insertImage(owner.id, { mimeType: 'image/gif', animated: true, poster: false });
    await create(owner, a, { name: 'bare', mediaId: bare.id }).expect(400);
    // A real animated GIF upload with its poster: the probe sets `animated`.
    const gif = await upload(owner, ANIMATED_GIF, 'party.gif', STATIC_WEBP);
    expect(gif.animated).toBe(true);
    const party = (await create(owner, a, { name: 'party', mediaId: gif.id }).expect(201)).body as SpaceEmoji;
    expect(party).toMatchObject({ name: 'party', animated: true });
    expect(customEmojiToken(party)).toBe(`<a:party:${party.id}>`);
  });

  it('GET /emojis/:id redirects to the image (public, cacheable); ?static=1 to the poster; 404 unknown', async () => {
    const res = await t.api().get(`/api/emojis/${blob.id}`).expect(302);
    expect(res.headers.location).toBe(blob.url);
    expect(res.headers['cache-control']).toBe('public, max-age=86400');
    // A static emoji has no poster: the still is the image itself.
    expect((await t.api().get(`/api/emojis/${blob.id}?static=1`).expect(302)).headers.location).toBe(blob.url);
    const [party] = await db.select().from(spaceEmojis).where(eq(spaceEmojis.name, 'party'));
    const [m] = await db.select().from(media).where(eq(media.id, party!.mediaId));
    expect((await t.api(carol).get(`/api/emojis/${party!.id}`).expect(302)).headers.location).toBe(
      `/uploads/${m!.storageKey}`,
    );
    expect((await t.api().get(`/api/emojis/${party!.id}?static=1`).expect(302)).headers.location).toBe(
      `/uploads/${m!.thumbnailKey}`,
    );
    await t.api().get('/api/emojis/00000000-0000-4000-8000-000000000000').expect(404);
    await t.api().get('/api/emojis/not-an-id').expect(400);
  });

  it('changes reach the Space room as space:emojis (the whole list), not outsiders', async () => {
    const sb = await t.connect(bob);
    const sc = await t.connect(carol);
    const m = await insertImage(owner.id);
    const evt = waitForEvent(sb, 'space:emojis', { filter: (p) => p.spaceId === a.space.id });
    const fresh = (await create(owner, a, { name: 'fresh', mediaId: m.id }).expect(201)).body as SpaceEmoji;
    const got = await evt;
    expect(got.emojis.map((e) => e.name)).toEqual(['blob', 'party', 'fresh']);
    expect(got.emojis.at(-1)).toEqual(fresh);
    await expectNoEvent(sc, 'space:emojis');
    const renamed = waitForEvent(sb, 'space:emojis', { filter: (p) => p.emojis.some((e) => e.name === 'fresh_2') });
    await t.api(owner).patch(`${base(a)}/${fresh.id}`).send({ name: 'fresh_2' }).expect(200);
    await renamed;
    const gone = waitForEvent(sb, 'space:emojis', { filter: (p) => !p.emojis.some((e) => e.id === fresh.id) });
    await t.api(owner).delete(`${base(a)}/${fresh.id}`).expect(204);
    expect((await gone).emojis.map((e) => e.name)).toEqual(['blob', 'party']);
  });

  it('GET /me/emojis: one group per Space of mine that has emoji', async () => {
    const groups = (await t.api(bob).get('/api/me/emojis').expect(200)).body as SpaceEmojiGroup[];
    expect(groups.map((g) => [g.spaceName, g.emojis.map((e) => e.name)])).toEqual([['Alpha', ['blob', 'party']]]);
    expect(groups[0]).toMatchObject({ spaceId: a.space.id, iconUrl: null });
    expect((await t.api(carol).get('/api/me/emojis').expect(200)).body).toEqual([]);
  });

  it('the cap: SPACE_EMOJI_LIMIT per Space (409 limit_reached)', async () => {
    const m = await insertImage(owner.id);
    const have = (await t.api(owner).get(base(b)).expect(200)).body as SpaceEmoji[];
    await db.insert(spaceEmojis).values(
      Array.from({ length: SPACE_EMOJI_LIMIT - have.length - 1 }, (_, i) => ({
        spaceId: b.space.id,
        name: `filler_${i}`,
        mediaId: m.id,
      })),
    );
    await create(owner, b, { name: 'last_one', mediaId: m.id }).expect(201);
    const full = await create(owner, b, { name: 'one_more', mediaId: m.id }).expect(409);
    expect(full.body.error.code).toBe('limit_reached');
    await db.delete(spaceEmojis).where(eq(spaceEmojis.spaceId, b.space.id));
  });

  it('Space channels: other Spaces’ emoji need USE_EXTERNAL_EMOJI (else :name:); the Space’s own always work', async () => {
    const m = await insertImage(owner.id);
    const bee = (await create(owner, b, { name: 'bee', mediaId: m.id }).expect(201)).body as SpaceEmoji;
    const text = `hi ${customEmojiToken(blob)} and ${customEmojiToken(bee)}`;
    // Implicit for every member: allowed.
    expect((await sendText(bob, general(b).id, text)).text).toBe(text);
    // An @everyone deny in the channel takes it away.
    const everyone = b.space.roles.find((r) => r.isDefault)!;
    await t
      .api(owner)
      .put(`/api/spaces/${b.space.id}/channels/${general(b).id}/overwrites/role/${everyone.id}`)
      .send({ allow: 0, deny: PERM.USE_EXTERNAL_EMOJI })
      .expect(200);
    const sent = await sendText(bob, general(b).id, text);
    expect(sent.text).toBe(`hi :blob: and ${customEmojiToken(bee)}`);
    // Unknown ids count as external; the owner is not bound by overwrites.
    const ghost = '<:ghost:00000000-0000-4000-8000-000000000000>';
    expect((await sendText(bob, general(b).id, `${ghost}!`)).text).toBe(':ghost:!');
    expect((await sendText(owner, general(b).id, text)).text).toBe(text);
    // Edits follow the same rule.
    const edited = (
      await t.api(bob).patch(`/api/messages/${sent.id}`).send({ text: `now ${customEmojiToken(blob)}` }).expect(200)
    ).body as Message;
    expect(edited.text).toBe('now :blob:');
    // Outside Spaces (a DM) tokens are left alone.
    const dm = (await t.api(bob).post('/api/chats/direct').send({ userId: owner.id }).expect(200)).body as { id: string };
    expect((await sendText(bob, dm.id, text)).text).toBe(text);
  });
});
