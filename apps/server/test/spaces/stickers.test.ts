/**
 * Space stickers: CRUD with MANAGE_EMOJI (any member reads, non-members get 404), names (2-30,
 * unique per Space ignoring case: 409), pictures (mine, PNG/APNG/WebP/GIF, at most
 * MAX_STICKER_BYTES, a poster when animated), the free SPACE_STICKER_LIMIT, `space:stickers`
 * to the Space room, audit entries and the picker groups of `GET /me/stickers`. Sending
 * `{ type: 'sticker' }`: an `image` message of the picture with `Message.sticker` (REST and
 * `message:new`) in DMs, in the Space's own channels without ATTACH_FILES, in other Spaces'
 * channels with USE_EXTERNAL_EMOJI only; replies and clientId retries as usual; 404 for
 * non-members; a deleted sticker leaves its messages readable.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  MAX_STICKER_BYTES,
  PERM,
  SPACE_STICKER_LIMIT,
  type Message,
  type MessagePage,
  type SpaceAuditEntry,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type SpaceSticker,
  type SpaceStickerGroup,
} from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { messages, spaceStickers } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';
import { insertImage } from '../accounts/util.js';
import { ANIMATED_GIF, APNG, PNG, STATIC_WEBP } from '../support/images.js';

describe('Space stickers', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let a: SpaceDetail;
  let b: SpaceDetail;
  let bobSocket: TestSocket;
  let ownerSocket: TestSocket;
  const base = (d: SpaceDetail) => `/api/spaces/${d.space.id}/stickers`;
  const general = (d: SpaceDetail) => d.channels.find((c) => c.name === 'general')!;
  const everyone = (d: SpaceDetail) => d.space.roles.find((r) => r.isDefault)!;

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

  let sends = 0;
  const send = (user: TestUser, chatId: string, body: Record<string, unknown>) =>
    t
      .api(user)
      .post(`/api/chats/${chatId}/messages`)
      .send({ clientId: `sticker-${++sends}`, ...body });

  const dmOf = async (user: TestUser, peer: TestUser) =>
    (
      (await t.api(user).post('/api/chats/direct').send({ userId: peer.id }).expect(200)).body as {
        id: string;
      }
    ).id;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    a = (await t.api(owner).post('/api/spaces').send({ name: 'Alpha' }).expect(201))
      .body as SpaceDetail;
    b = (await t.api(owner).post('/api/spaces').send({ name: 'Beta' }).expect(201))
      .body as SpaceDetail;
    await invite(a, bob);
    await invite(b, bob);
    bobSocket = await t.connect(bob);
    ownerSocket = await t.connect(owner);
  });
  afterAll(() => t.close());

  let wave: SpaceSticker;
  let spin: SpaceSticker;
  let bee: SpaceSticker;

  it('MANAGE_EMOJI adds stickers; every member reads the list, oldest first; non-members get 404', async () => {
    const image = await upload(owner, PNG, 'wave.png');
    wave = (
      await create(owner, a, {
        name: 'Wave',
        emoji: '👋',
        description: 'Hello there',
        mediaId: image.id,
      }).expect(201)
    ).body as SpaceSticker;
    expect(wave).toEqual({
      id: expect.any(String),
      spaceId: a.space.id,
      name: 'Wave',
      description: 'Hello there',
      emoji: '👋',
      url: image.url,
      animated: false,
      createdBy: owner.id,
    });
    const nod = (
      await create(owner, a, { name: 'Nod', mediaId: (await insertImage(owner.id)).id }).expect(201)
    ).body as SpaceSticker;
    expect(nod).toMatchObject({ name: 'Nod', description: null, emoji: null });
    expect((await t.api(bob).get(base(a)).expect(200)).body).toEqual([wave, nod]);

    await t.api(carol).get(base(a)).expect(404);
    await create(carol, a, { name: 'Mine', mediaId: (await insertImage(carol.id)).id }).expect(404);
    await t
      .api(carol)
      .patch(`${base(a)}/${wave.id}`)
      .send({ name: 'Mine' })
      .expect(404);
    await t
      .api(carol)
      .delete(`${base(a)}/${wave.id}`)
      .expect(404);
    await t
      .api(owner)
      .delete(`${base(a)}/${nod.id}`)
      .expect(204);
  });

  it('members without MANAGE_EMOJI get 403 until a role grants it; only my own uploads', async () => {
    const image = await upload(bob, PNG, 'cat.png');
    await create(bob, a, { name: 'Cat', mediaId: image.id }).expect(403);
    await t
      .api(bob)
      .patch(`${base(a)}/${wave.id}`)
      .send({ name: 'Wavy' })
      .expect(403);
    await t
      .api(bob)
      .delete(`${base(a)}/${wave.id}`)
      .expect(403);
    const role = (
      await t
        .api(owner)
        .post(`/api/spaces/${a.space.id}/roles`)
        .send({ name: 'Sticker crew', permissions: PERM.MANAGE_EMOJI })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${a.space.id}/members/${bob.id}/roles/${role.id}`)
      .expect(200);
    const cat = (await create(bob, a, { name: 'Cat', mediaId: image.id }).expect(201))
      .body as SpaceSticker;
    expect(cat).toMatchObject({ name: 'Cat', createdBy: bob.id });
    // Someone else's upload is not mine to use.
    await create(bob, a, { name: 'Stolen', mediaId: (await insertImage(owner.id)).id }).expect(404);
    await t
      .api(bob)
      .delete(`${base(a)}/${cat.id}`)
      .expect(204);
  });

  it('names: 2-30 characters, unique per Space ignoring case (409); edits of name, emoji and description', async () => {
    const m = await insertImage(owner.id);
    for (const name of ['a', '  b  ', 'x'.repeat(31)])
      await create(owner, a, { name, mediaId: m.id }).expect(400);
    const dup = await create(owner, a, { name: 'WAVE', mediaId: m.id }).expect(409);
    expect(dup.body.error.code).toBe('conflict');
    // The same name in another Space is fine.
    const inB = (await create(owner, b, { name: 'wave', mediaId: m.id }).expect(201))
      .body as SpaceSticker;
    const dance = (await create(owner, a, { name: 'Dance party', mediaId: m.id }).expect(201))
      .body as SpaceSticker;
    await t
      .api(owner)
      .patch(`${base(a)}/${dance.id}`)
      .send({ name: 'wave' })
      .expect(409);
    // A case change of its own name is fine, with the other fields at once.
    const edited = (
      await t
        .api(owner)
        .patch(`${base(a)}/${dance.id}`)
        .send({ name: 'DANCE PARTY', emoji: '💃', description: 'Move it' })
        .expect(200)
    ).body as SpaceSticker;
    expect(edited).toMatchObject({
      id: dance.id,
      name: 'DANCE PARTY',
      emoji: '💃',
      description: 'Move it',
    });
    // Blank or null clears the emoji and the description; the name stays.
    const cleared = (
      await t
        .api(owner)
        .patch(`${base(a)}/${dance.id}`)
        .send({ emoji: '', description: null })
        .expect(200)
    ).body as SpaceSticker;
    expect(cleared).toMatchObject({ name: 'DANCE PARTY', emoji: null, description: null });
    await t
      .api(owner)
      .patch(`${base(a)}/${dance.id}`)
      .send({ name: 'x' })
      .expect(400);
    await t
      .api(owner)
      .patch(`${base(b)}/${dance.id}`)
      .send({ name: 'Elsewhere' })
      .expect(404);
    await t
      .api(owner)
      .delete(`${base(a)}/${dance.id}`)
      .expect(204);
    await t
      .api(owner)
      .delete(`${base(a)}/${dance.id}`)
      .expect(404);
    await t
      .api(owner)
      .delete(`${base(b)}/${inB.id}`)
      .expect(204);
  });

  it('pictures: PNG, APNG, WebP or GIF up to MAX_STICKER_BYTES; animated ones need a poster', async () => {
    const jpeg = await insertImage(owner.id, { mimeType: 'image/jpeg' });
    expect(
      (await create(owner, a, { name: 'Photo', mediaId: jpeg.id }).expect(400)).body.error.message,
    ).toBe('Stickers must be PNG, APNG, WebP or GIF images');
    const big = await insertImage(owner.id, { size: MAX_STICKER_BYTES + 1 });
    expect(
      (await create(owner, a, { name: 'Big', mediaId: big.id }).expect(400)).body.error.message,
    ).toBe('Stickers can be at most 512 KB');
    const fits = await insertImage(owner.id, { mimeType: 'image/webp', size: MAX_STICKER_BYTES });
    const fitting = (await create(owner, a, { name: 'Fits', mediaId: fits.id }).expect(201))
      .body as SpaceSticker;
    const bare = await insertImage(owner.id, {
      mimeType: 'image/gif',
      animated: true,
      poster: false,
    });
    expect(
      (await create(owner, a, { name: 'Bare', mediaId: bare.id }).expect(400)).body.error.message,
    ).toBe('Animated stickers need a static poster');
    // Real uploads with their poster: the probe makes an APNG and a GIF animated.
    const apng = await upload(owner, APNG, 'spin.png', STATIC_WEBP);
    expect(apng.animated).toBe(true);
    spin = (await create(owner, a, { name: 'spin', mediaId: apng.id }).expect(201))
      .body as SpaceSticker;
    expect(spin).toMatchObject({ name: 'spin', animated: true, url: apng.url });
    const gif = await upload(owner, ANIMATED_GIF, 'party.gif', STATIC_WEBP);
    const party = (await create(owner, a, { name: 'party', mediaId: gif.id }).expect(201))
      .body as SpaceSticker;
    expect(party.animated).toBe(true);
    await t
      .api(owner)
      .delete(`${base(a)}/${fitting.id}`)
      .expect(204);
    await t
      .api(owner)
      .delete(`${base(a)}/${party.id}`)
      .expect(204);
  });

  it('the free SPACE_STICKER_LIMIT per Space (400: no slots left)', async () => {
    const m = await insertImage(owner.id);
    const have = (await t.api(owner).get(base(b)).expect(200)).body as SpaceSticker[];
    await db.insert(spaceStickers).values(
      Array.from({ length: SPACE_STICKER_LIMIT - have.length - 1 }, (_, i) => ({
        spaceId: b.space.id,
        name: `filler ${i}`,
        mediaId: m.id,
      })),
    );
    await create(owner, b, { name: 'Last one', mediaId: m.id }).expect(201);
    const full = await create(owner, b, { name: 'One more', mediaId: m.id }).expect(400);
    expect(full.body.error.message).toBe('This Space has no sticker slots left');
    await db.delete(spaceStickers).where(eq(spaceStickers.spaceId, b.space.id));
  });

  it('changes reach the Space room as space:stickers (the whole list), not outsiders; each is audited', async () => {
    const sc = await t.connect(carol);
    const evt = waitForEvent(bobSocket, 'space:stickers', {
      filter: (p) => p.spaceId === a.space.id,
    });
    const fresh = (
      await create(owner, a, { name: 'Fresh', mediaId: (await insertImage(owner.id)).id }).expect(
        201,
      )
    ).body as SpaceSticker;
    const got = await evt;
    expect(got.stickers.map((s) => s.name)).toEqual(['Wave', 'spin', 'Fresh']);
    expect(got.stickers.at(-1)).toEqual(fresh);
    await expectNoEvent(sc, 'space:stickers');

    const edited = waitForEvent(bobSocket, 'space:stickers', {
      filter: (p) => p.stickers.some((s) => s.emoji === '✨'),
    });
    await t
      .api(owner)
      .patch(`${base(a)}/${fresh.id}`)
      .send({ emoji: '✨' })
      .expect(200);
    await edited;
    const gone = waitForEvent(bobSocket, 'space:stickers', {
      filter: (p) => !p.stickers.some((s) => s.id === fresh.id),
    });
    await t
      .api(owner)
      .delete(`${base(a)}/${fresh.id}`)
      .expect(204);
    expect((await gone).stickers.map((s) => s.name)).toEqual(['Wave', 'spin']);
    // An edit that changes nothing writes and sends nothing.
    expect(
      (
        await t
          .api(owner)
          .patch(`${base(a)}/${wave.id}`)
          .send({ name: 'Wave' })
          .expect(200)
      ).body,
    ).toEqual(wave);
    await expectNoEvent(bobSocket, 'space:stickers');

    const log = (await t.api(owner).get(`/api/spaces/${a.space.id}/audit-log`).expect(200))
      .body as SpaceAuditEntry[];
    const entries = log.filter((e) => e.targetId === fresh.id);
    expect(entries.map((e) => e.action)).toEqual([
      'sticker.delete',
      'sticker.update',
      'sticker.create',
    ]);
    expect(entries.map((e) => e.changes)).toEqual([
      { name: 'Fresh' },
      { emoji: [null, '✨'] },
      { name: 'Fresh', animated: false },
    ]);
  });

  it('GET /me/stickers: one group per Space of mine that has stickers, in the order I joined', async () => {
    bee = (
      await create(owner, b, {
        name: 'Bee',
        emoji: '🐝',
        mediaId: (await insertImage(owner.id)).id,
      }).expect(201)
    ).body as SpaceSticker;
    const groups = (await t.api(bob).get('/api/me/stickers').expect(200))
      .body as SpaceStickerGroup[];
    expect(groups.map((g) => [g.spaceName, g.stickers.map((s) => s.name)])).toEqual([
      ['Alpha', ['Wave', 'spin']],
      ['Beta', ['Bee']],
    ]);
    expect(groups[0]).toMatchObject({ spaceId: a.space.id, iconUrl: null });
    expect(groups[0]!.stickers[0]).toEqual(wave);
    expect(groups[1]!.stickers).toEqual([bee]);
    expect((await t.api(carol).get('/api/me/stickers').expect(200)).body).toEqual([]);
  });

  it('a DM: an image message of the picture with Message.sticker, no text — also in message:new', async () => {
    const dm = await dmOf(bob, owner);
    const evt = waitForEvent(ownerSocket, 'message:new', {
      filter: (p) => p.message.chatId === dm,
    });
    const sent = (await send(bob, dm, { type: 'sticker', stickerId: wave.id }).expect(201))
      .body as Message;
    const ref = { id: wave.id, name: 'Wave', spaceId: a.space.id };
    expect(sent).toMatchObject({ type: 'image', text: null, sticker: ref });
    expect(sent.media).toMatchObject({ kind: 'image', url: wave.url, mimeType: 'image/png' });
    const got = (await evt).message;
    expect(got).toMatchObject({ id: sent.id, type: 'image', sticker: ref });
    expect(got.media?.url).toBe(wave.url);
    // Stickers carry no caption.
    await send(bob, dm, { type: 'sticker', stickerId: wave.id, text: 'hi' }).expect(400);
  });

  it('a channel of its own Space, even without ATTACH_FILES; replies and clientId retries as usual', async () => {
    const channel = general(a).id;
    await t
      .api(owner)
      .put(`/api/spaces/${a.space.id}/channels/${channel}/overwrites/role/${everyone(a).id}`)
      .send({ allow: 0, deny: PERM.ATTACH_FILES })
      .expect(200);
    const photo = await upload(bob, PNG, 'photo.png');
    await send(bob, channel, { type: 'image', mediaId: photo.id }).expect(403);

    const first = (await send(owner, channel, { type: 'text', text: 'look at this' }).expect(201))
      .body as Message;
    const body = {
      clientId: 'sticker-reply',
      type: 'sticker',
      stickerId: spin.id,
      replyToId: first.id,
    };
    const evt = waitForEvent(ownerSocket, 'message:new', {
      filter: (p) => p.message.chatId === channel && !!p.message.sticker,
    });
    const reply = (await t.api(bob).post(`/api/chats/${channel}/messages`).send(body).expect(201))
      .body as Message;
    expect(reply).toMatchObject({
      type: 'image',
      sticker: { id: spin.id, name: 'spin', spaceId: a.space.id },
      replyTo: { id: first.id },
      mentions: [owner.id],
    });
    expect(reply.media).toMatchObject({ animated: true, url: spin.url });
    expect(reply.media?.thumbnailUrl).toEqual(expect.any(String));
    expect((await evt).message.sticker?.id).toBe(spin.id);
    // The same clientId returns the original (200): nothing new.
    const again = (await t.api(bob).post(`/api/chats/${channel}/messages`).send(body).expect(200))
      .body as Message;
    expect(again.id).toBe(reply.id);
    await t
      .api(owner)
      .delete(`/api/spaces/${a.space.id}/channels/${channel}/overwrites/role/${everyone(a).id}`)
      .expect(200);
  });

  it('a channel of another Space: needs USE_EXTERNAL_EMOJI there (403 without); its own always work', async () => {
    const channel = general(b).id;
    // Implicit for every member.
    const sent = (await send(bob, channel, { type: 'sticker', stickerId: wave.id }).expect(201))
      .body as Message;
    expect(sent.sticker).toEqual({ id: wave.id, name: 'Wave', spaceId: a.space.id });
    await t
      .api(owner)
      .put(`/api/spaces/${b.space.id}/channels/${channel}/overwrites/role/${everyone(b).id}`)
      .send({ allow: 0, deny: PERM.USE_EXTERNAL_EMOJI })
      .expect(200);
    const denied = await send(bob, channel, { type: 'sticker', stickerId: wave.id }).expect(403);
    expect(denied.body.error.message).toBe(
      'You cannot use stickers from other Spaces in this channel',
    );
    await send(bob, channel, { type: 'sticker', stickerId: bee.id }).expect(201);
    // The owner is not bound by overwrites; DMs never are.
    await send(owner, channel, { type: 'sticker', stickerId: wave.id }).expect(201);
    await send(bob, await dmOf(bob, owner), { type: 'sticker', stickerId: wave.id }).expect(201);
  });

  it('stickers of a Space I am not in, and unknown ids, are 404 — until I join it', async () => {
    const dm = await dmOf(carol, bob);
    await send(carol, dm, { type: 'sticker', stickerId: wave.id }).expect(404);
    await send(carol, dm, {
      type: 'sticker',
      stickerId: '00000000-0000-4000-8000-000000000000',
    }).expect(404);
    await invite(a, carol);
    const sent = (await send(carol, dm, { type: 'sticker', stickerId: wave.id }).expect(201))
      .body as Message;
    expect(sent.sticker?.id).toBe(wave.id);
  });

  it('sticker messages are not editable and stay out of the chat media gallery', async () => {
    const dm = await dmOf(bob, owner);
    const sent = (await send(bob, dm, { type: 'sticker', stickerId: wave.id }).expect(201))
      .body as Message;
    await t.api(bob).patch(`/api/messages/${sent.id}`).send({ text: 'a caption' }).expect(400);
    const media = (
      await t.api(bob).get(`/api/chats/${dm}/media`).query({ kind: 'media' }).expect(200)
    ).body as Message[];
    expect(media.map((m) => m.id)).not.toContain(sent.id);
  });

  it('a deleted sticker leaves its messages readable: the picture stays, the sticker goes', async () => {
    const dm = await dmOf(bob, owner);
    const sent = (await send(bob, dm, { type: 'sticker', stickerId: spin.id }).expect(201))
      .body as Message;
    await t
      .api(owner)
      .delete(`${base(a)}/${spin.id}`)
      .expect(204);
    const page = (await t.api(bob).get(`/api/chats/${dm}/messages`).expect(200))
      .body as MessagePage;
    const after = page.messages.find((m) => m.id === sent.id)!;
    expect(after).toMatchObject({ type: 'image', deletedAt: null });
    expect(after.sticker ?? null).toBeNull();
    expect(after.media).toMatchObject({ id: sent.media!.id, url: sent.media!.url });
    const [row] = await db.select().from(messages).where(eq(messages.id, sent.id));
    expect(row).toMatchObject({ stickerId: null, mediaId: sent.media!.id });
    await send(bob, dm, { type: 'sticker', stickerId: spin.id }).expect(404);
  });
});
