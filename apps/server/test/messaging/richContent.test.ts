/**
 * Rich content (docs/design/discord-parity.md W6-E/F): `tts: true` stores MESSAGE_FLAGS.TTS,
 * sends in a Space channel without EMBED_LINKS get SUPPRESS_EMBEDS, `PATCH
 * /messages/:id/suppress-embeds` (the author or MANAGE_MESSAGES; `message:updated` to the
 * room) and `GET /messages/:id` (a message I can see, else 404).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  MESSAGE_FLAGS,
  PERM,
  hasMessageFlag,
  type Message,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
} from '@enbox/shared';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { openDirect, sendOk } from './support.js';

const { SUPPRESS_EMBEDS, TTS } = MESSAGE_FLAGS;

describe('rich content', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let outsider: TestUser;
  let space: SpaceDetail;
  let general: string;
  let everyoneRole: string;

  const suppress = (user: TestUser, messageId: string, on: boolean) =>
    t.api(user).patch(`/api/messages/${messageId}/suppress-embeds`).send({ suppress: on });

  async function invite(user: TestUser) {
    const inv = (
      await t.api(owner).post(`/api/spaces/${space.space.id}/invites`).send({}).expect(201)
    ).body as SpaceInvite;
    await t.api(user).post(`/api/invites/${inv.code}/join`).expect(200);
    await spaceRegistryIdle();
  }

  const overwrite = (roleId: string, body: { allow: number; deny: number }) =>
    t
      .api(owner)
      .put(`/api/spaces/${space.space.id}/channels/${general}/overwrites/role/${roleId}`)
      .send(body)
      .expect(200);

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol, outsider] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
      await t.createUser({ displayName: 'Outsider' }),
    ];
    space = (await t.api(owner).post('/api/spaces').send({ name: 'Rich' }).expect(201))
      .body as SpaceDetail;
    general = space.channels.find((c) => c.name === 'general')!.id;
    everyoneRole = space.space.roles.find((r) => r.isDefault)!.id;
    await invite(bob);
    await invite(carol);
  });
  afterAll(() => t.close());

  it('/tts stores the TTS flag; other sends carry none', async () => {
    const dm = await openDirect(t, owner, bob);
    const spoken = await sendOk(t, owner, dm.id, { text: 'hello out loud', tts: true });
    expect(spoken.flags).toBe(TTS);
    const plain = await sendOk(t, owner, dm.id, 'quiet');
    expect(plain.flags).toBeUndefined();
    const inSpace = await sendOk(t, bob, general, { text: 'hear me', tts: true });
    expect(hasMessageFlag(inSpace.flags, TTS)).toBe(true);
    // The flag is stored: the history shows it too.
    const page = (await t.api(bob).get(`/api/chats/${dm.id}/messages`).expect(200)).body as {
      messages: Message[];
    };
    expect(page.messages.find((m) => m.id === spoken.id)?.flags).toBe(TTS);
    // Only text messages take it.
    await t
      .api(owner)
      .post(`/api/chats/${dm.id}/messages`)
      .send({
        clientId: 'loc-tts',
        type: 'location',
        location: { latitude: 1, longitude: 2 },
        tts: true,
      })
      .expect(400);
  });

  it('a Space channel without EMBED_LINKS suppresses embeds at send', async () => {
    const before = await sendOk(t, bob, general, 'see https://example.com');
    expect(before.flags).toBeUndefined();
    await overwrite(everyoneRole, { allow: 0, deny: PERM.EMBED_LINKS });
    const after = await sendOk(t, bob, general, 'see https://example.com');
    expect(after.flags).toBe(SUPPRESS_EMBEDS);
    const both = await sendOk(t, bob, general, { text: 'loud https://example.com', tts: true });
    expect(both.flags).toBe(SUPPRESS_EMBEDS | TTS);
    // The owner is not bound by overwrites; a role allow gives it back.
    expect((await sendOk(t, owner, general, 'https://example.com')).flags).toBeUndefined();
    const role = (
      await t
        .api(owner)
        .post(`/api/spaces/${space.space.id}/roles`)
        .send({ name: 'Linkers', permissions: 0 })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${space.space.id}/members/${carol.id}/roles/${role.id}`)
      .expect(200);
    await overwrite(role.id, { allow: PERM.EMBED_LINKS, deny: 0 });
    expect((await sendOk(t, carol, general, 'https://example.com')).flags).toBeUndefined();
    // Bob can't bring his embeds back without the permission.
    await suppress(bob, after.id, false).expect(403);
    await overwrite(everyoneRole, { allow: 0, deny: 0 });
  });

  it('the author removes and restores embeds; message:updated reaches the room', async () => {
    const dm = await openDirect(t, owner, bob);
    const m = await sendOk(t, owner, dm.id, 'https://example.com/a');
    const sock = await t.connect(bob);
    const updated = waitForEvent(sock, 'message:updated', {
      filter: (p) => p.message.id === m.id,
    });
    const res = (await suppress(owner, m.id, true).expect(200)).body as Message;
    expect(res.flags).toBe(SUPPRESS_EMBEDS);
    expect((await updated).message.flags).toBe(SUPPRESS_EMBEDS);
    // Unchanged: a no-op that still answers with the message.
    expect(((await suppress(owner, m.id, true).expect(200)).body as Message).flags).toBe(
      SUPPRESS_EMBEDS,
    );
    // Bob is not the author (and DMs have no moderators).
    await suppress(bob, m.id, false).expect(403);
    const cleared = (await suppress(owner, m.id, false).expect(200)).body as Message;
    expect(cleared.flags).toBeUndefined();
    // Others' chats are 404, a bad body 400.
    await suppress(outsider, m.id, true).expect(404);
    await t.api(owner).patch(`/api/messages/${m.id}/suppress-embeds`).send({}).expect(400);
  });

  it('Space channels: MANAGE_MESSAGES removes anyone’s embeds; other members cannot', async () => {
    const m = await sendOk(t, bob, general, 'https://example.com/b');
    await suppress(carol, m.id, true).expect(403);
    const mods = (
      await t
        .api(owner)
        .post(`/api/spaces/${space.space.id}/roles`)
        .send({ name: 'Mods', permissions: PERM.MANAGE_MESSAGES })
        .expect(201)
    ).body as SpaceRole;
    await t
      .api(owner)
      .put(`/api/spaces/${space.space.id}/members/${carol.id}/roles/${mods.id}`)
      .expect(200);
    expect(((await suppress(carol, m.id, true).expect(200)).body as Message).flags).toBe(
      SUPPRESS_EMBEDS,
    );
    // Bob may restore his own (he has EMBED_LINKS again).
    expect(((await suppress(bob, m.id, false).expect(200)).body as Message).flags).toBeUndefined();
    await suppress(outsider, m.id, true).expect(404);
    // A deleted message has no embeds left.
    await t.api(bob).delete(`/api/messages/${m.id}`).query({ for: 'everyone' }).expect(204);
    await suppress(bob, m.id, true).expect(400);
  });

  it('GET /messages/:id: a message I can see, else 404', async () => {
    const dm = await openDirect(t, owner, bob);
    const m = await sendOk(t, owner, dm.id, 'linked');
    const got = (await t.api(bob).get(`/api/messages/${m.id}`).expect(200)).body as Message;
    expect(got).toMatchObject({ id: m.id, chatId: dm.id, text: 'linked', senderId: owner.id });
    // Not in the chat: 404 (never 403).
    await t.api(outsider).get(`/api/messages/${m.id}`).expect(404);
    await t.api(carol).get(`/api/messages/${m.id}`).expect(404);
    await t.api(bob).get('/api/messages/not-a-uuid').expect(400);
    await t.api().get(`/api/messages/${m.id}`).expect(401);

    // Space channels: members who can see the channel (no read row needed); others 404.
    const post = await sendOk(t, owner, general, 'in the Space');
    expect((await t.api(carol).get(`/api/messages/${post.id}`).expect(200)).body).toMatchObject({
      id: post.id,
      chatId: general,
    });
    await t.api(outsider).get(`/api/messages/${post.id}`).expect(404);
    // A channel hidden from @everyone: its read rows no longer let anyone in.
    await overwrite(everyoneRole, { allow: 0, deny: PERM.VIEW_CHANNEL });
    await t.api(bob).get(`/api/messages/${post.id}`).expect(404);
    await t.api(owner).get(`/api/messages/${post.id}`).expect(200);
    await overwrite(everyoneRole, { allow: 0, deny: 0 });
    await t.api(bob).get(`/api/messages/${post.id}`).expect(200);
  });
});
