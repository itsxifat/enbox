/**
 * The soundboard (modules/soundboard): CRUD with MANAGE_EMOJI (members read, outsiders 404),
 * clip checks (mine, audio MP3/OGG/WAV, size, a recorded duration), names and volume, the free
 * SPACE_SOUND_LIMIT, `space:sounds` to the Space room, and playing: voice needed (any Space's),
 * SPEAK there, refused while muted, deafened (self or server) or in a Stage audience, the
 * per-user cooldown, and `voice:sound` to that channel's room only. LiveKit is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { RoomServiceClient } from 'livekit-server-sdk';
import {
  MAX_SOUND_BYTES,
  MAX_SOUND_DURATION_MS,
  PERM,
  SPACE_SOUND_LIMIT,
  type ChatSummary,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type SpaceSound,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { media, spaceSounds } from '../../src/db/schema.js';
import { resetSoundCooldowns } from '../../src/modules/soundboard/service.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  emitAck,
  expectNoEvent,
  sleep,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';

/** An audio upload of `userId` as `POST /api/media` stores it (MP3, 1.2 s unless told). */
async function insertAudio(
  userId: string,
  o: { mimeType?: string; size?: number; durationMs?: number | null; kind?: 'audio' | 'image' } = {},
) {
  const mimeType = o.mimeType ?? 'audio/mpeg';
  const [m] = await db
    .insert(media)
    .values({
      uploaderId: userId,
      kind: o.kind ?? 'audio',
      mimeType,
      size: o.size ?? 2_000,
      durationMs: o.durationMs === undefined ? 1_200 : o.durationMs,
      storageKey: `2026/10/${crypto.randomUUID()}.${mimeType.split('/')[1]}`,
    })
    .returning();
  return m!;
}

/** A tiny valid PCM WAV file (8 kHz mono, 0.1 s of silence). */
function wav(samples = 800): Buffer {
  const dataLen = samples * 2;
  const b = Buffer.alloc(44 + dataLen);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + dataLen, 4);
  b.write('WAVE', 8);
  b.write('fmt ', 12);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(8000, 24);
  b.writeUInt32LE(16000, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(dataLen, 40);
  return b;
}

describe('soundboard', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let eve: TestUser;
  /** The Space whose sounds we manage. */
  let a: SpaceDetail;
  /** Another Space with a voice channel (owner, bob, carol). */
  let b: SpaceDetail;
  let horn: SpaceSound;
  const sounds = (d: SpaceDetail) => `/api/spaces/${d.space.id}/sounds`;
  const create = (u: TestUser, d: SpaceDetail, body: Record<string, unknown>) => t.api(u).post(sounds(d)).send(body);
  const play = (u: TestUser, d: SpaceDetail, soundId: string) => t.api(u).post(`${sounds(d)}/${soundId}/play`);
  const voiceOf = (d: SpaceDetail) => d.channels.find((c) => c.type === 'space_voice')!;

  async function invite(d: SpaceDetail, user: TestUser) {
    const inv = (await t.api(owner).post(`/api/spaces/${d.space.id}/invites`).send({}).expect(201)).body as SpaceInvite;
    await t.api(user).post(`/api/invites/${inv.code}/join`).expect(200);
  }

  let open: TestSocket[] = [];
  async function connect(u: TestUser) {
    const s = await t.connect(u);
    open.push(s);
    return s;
  }
  async function joinVoice(u: TestUser, channelId: string) {
    const s = await connect(u);
    await emitAck(s, 'voice:join', { channelId });
    return s;
  }

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol, eve] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
      await t.createUser({ displayName: 'Eve' }),
    ];
    a = (await t.api(owner).post('/api/spaces').send({ name: 'Alpha' }).expect(201)).body as SpaceDetail;
    b = (await t.api(owner).post('/api/spaces').send({ name: 'Beta' }).expect(201)).body as SpaceDetail;
    await invite(a, bob);
    await invite(b, bob);
    await invite(b, carol);
    await spaceRegistryIdle();
    config.voice.apiKey = 'devkey';
    config.voice.apiSecret = 'devsecret-devsecret-devsecret-0123';
    vi.spyOn(RoomServiceClient.prototype, 'updateParticipant').mockResolvedValue({} as never);
    vi.spyOn(RoomServiceClient.prototype, 'removeParticipant').mockResolvedValue(undefined as never);
  });
  beforeEach(async () => {
    for (const s of open) {
      if (s.connected) await emitAck(s, 'voice:leave', {}).catch(() => undefined);
      s.disconnect();
    }
    open = [];
    resetSoundCooldowns();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    config.voice.apiKey = undefined;
    config.voice.apiSecret = undefined;
    return t.close();
  });

  it('MANAGE_EMOJI adds sounds; every member lists them; outsiders get 404', async () => {
    const clip = await insertAudio(owner.id);
    horn = (await create(owner, a, { name: 'Air horn', emoji: '📯', volume: 0.5, mediaId: clip.id }).expect(201))
      .body as SpaceSound;
    expect(horn).toEqual({
      id: expect.any(String),
      spaceId: a.space.id,
      name: 'Air horn',
      emoji: '📯',
      volume: 0.5,
      url: `/uploads/${clip.storageKey}`,
      createdBy: owner.id,
    });
    expect((await t.api(bob).get(sounds(a)).expect(200)).body).toEqual([horn]);
    await t.api(eve).get(sounds(a)).expect(404);
    await create(eve, a, { name: 'Mine', mediaId: (await insertAudio(eve.id)).id }).expect(404);

    // A real WAV upload (the type is sniffed) works too; the volume defaults to 1.
    const up = (await t
      .api(owner)
      .post('/api/media')
      .field('kind', 'audio')
      .field('durationMs', '100')
      .attach('file', wav(), 'beep.wav')
      .expect(201)).body as { id: string; mimeType: string };
    expect(up.mimeType).toBe('audio/wav');
    const beep = (await create(owner, a, { name: 'Beep', mediaId: up.id }).expect(201)).body as SpaceSound;
    expect(beep).toMatchObject({ name: 'Beep', emoji: null, volume: 1 });
    await t.api(owner).delete(`${sounds(a)}/${beep.id}`).expect(204);
  });

  it('members without MANAGE_EMOJI get 403 until a role grants it', async () => {
    const clip = await insertAudio(bob.id);
    await create(bob, a, { name: 'Boing', mediaId: clip.id }).expect(403);
    await t.api(bob).patch(`${sounds(a)}/${horn.id}`).send({ name: 'Mine now' }).expect(403);
    await t.api(bob).delete(`${sounds(a)}/${horn.id}`).expect(403);
    const role = (await t
      .api(owner)
      .post(`/api/spaces/${a.space.id}/roles`)
      .send({ name: 'Sound crew', permissions: PERM.MANAGE_EMOJI })
      .expect(201)).body as SpaceRole;
    await t.api(owner).put(`/api/spaces/${a.space.id}/members/${bob.id}/roles/${role.id}`).expect(200);
    const boing = (await create(bob, a, { name: 'Boing', mediaId: clip.id }).expect(201)).body as SpaceSound;
    expect(boing.createdBy).toBe(bob.id);
    await t.api(bob).delete(`${sounds(a)}/${boing.id}`).expect(204);
    await t.api(owner).delete(`/api/spaces/${a.space.id}/members/${bob.id}/roles/${role.id}`).expect(200);
  });

  it('validates the clip (mine, audio MP3/OGG/WAV, size, duration when known), the name and the volume', async () => {
    const ok = await insertAudio(owner.id);
    for (const name of ['a', ' b ', 'x'.repeat(33)]) await create(owner, a, { name, mediaId: ok.id }).expect(400);
    for (const volume of [-0.1, 1.5, '1']) await create(owner, a, { name: 'Loud', volume, mediaId: ok.id }).expect(400);
    // Someone else's upload is not mine to use.
    await create(owner, a, { name: 'Stolen', mediaId: (await insertAudio(bob.id)).id }).expect(404);
    const bad = [
      await insertAudio(owner.id, { kind: 'image', mimeType: 'image/png' }),
      await insertAudio(owner.id, { mimeType: 'audio/mp4' }),
      await insertAudio(owner.id, { mimeType: 'audio/webm' }),
      await insertAudio(owner.id, { size: MAX_SOUND_BYTES + 1 }),
      await insertAudio(owner.id, { durationMs: MAX_SOUND_DURATION_MS + 1 }),
    ];
    for (const m of bad) await create(owner, a, { name: 'Nope', mediaId: m.id }).expect(400);
    // OGG and WAV are fine; an unknown duration is accepted (the server does not decode audio).
    for (const m of [
      await insertAudio(owner.id, { mimeType: 'audio/ogg' }),
      await insertAudio(owner.id, { mimeType: 'audio/wav', durationMs: null }),
      await insertAudio(owner.id, { durationMs: MAX_SOUND_DURATION_MS, size: MAX_SOUND_BYTES }),
    ]) {
      const s = (await create(owner, a, { name: 'Fine', mediaId: m.id }).expect(201)).body as SpaceSound;
      await t.api(owner).delete(`${sounds(a)}/${s.id}`).expect(204);
    }
  });

  it('PATCH changes only what is sent; DELETE removes; space:sounds reaches the Space room, not outsiders', async () => {
    const sb = await connect(bob);
    const se = await connect(eve);
    const renamed = waitForEvent(sb, 'space:sounds', { filter: (p) => p.spaceId === a.space.id });
    const outsider = expectNoEvent(se, 'space:sounds', 400);
    const r = (await t.api(owner).patch(`${sounds(a)}/${horn.id}`).send({ name: 'Horn' }).expect(200)).body as SpaceSound;
    // The volume is kept on a rename.
    expect(r).toMatchObject({ id: horn.id, name: 'Horn', emoji: '📯', volume: 0.5 });
    expect((await renamed).sounds).toEqual([r]);
    await outsider;
    const v = (await t.api(owner).patch(`${sounds(a)}/${horn.id}`).send({ volume: 0.25, emoji: null }).expect(200))
      .body as SpaceSound;
    expect(v).toMatchObject({ name: 'Horn', emoji: null, volume: 0.25 });
    await t.api(owner).patch(`${sounds(a)}/${horn.id}`).send({ volume: 2 }).expect(400);
    await t.api(owner).patch(`${sounds(b)}/${horn.id}`).send({ name: 'Elsewhere' }).expect(404);
    horn = (await t.api(owner).patch(`${sounds(a)}/${horn.id}`).send({ name: 'Air horn', emoji: '📯', volume: 0.5 }).expect(200))
      .body as SpaceSound;

    const temp = (await create(owner, a, { name: 'Temp', mediaId: (await insertAudio(owner.id)).id }).expect(201)).body as SpaceSound;
    const gone = waitForEvent(sb, 'space:sounds', { filter: (p) => p.spaceId === a.space.id && !p.sounds.some((s) => s.id === temp.id) });
    await t.api(owner).delete(`${sounds(a)}/${temp.id}`).expect(204);
    expect((await gone).sounds.map((s) => s.name)).toEqual(['Air horn']);
    await t.api(owner).delete(`${sounds(a)}/${temp.id}`).expect(404);
    const log = (await t.api(owner).get(`/api/spaces/${a.space.id}/audit-log`).expect(200)).body as { action: string }[];
    expect(log.map((e) => e.action)).toEqual(expect.arrayContaining(['sound.create', 'sound.update', 'sound.delete']));
  });

  it('the cap: SPACE_SOUND_LIMIT per Space (409 limit_reached)', async () => {
    const m = await insertAudio(owner.id);
    const have = ((await t.api(owner).get(sounds(b)).expect(200)).body as SpaceSound[]).length;
    await db.insert(spaceSounds).values(
      Array.from({ length: SPACE_SOUND_LIMIT - have - 1 }, (_, i) => ({ spaceId: b.space.id, name: `Filler ${i}`, mediaId: m.id })),
    );
    await create(owner, b, { name: 'Last one', mediaId: m.id }).expect(201);
    const full = await create(owner, b, { name: 'One more', mediaId: m.id }).expect(409);
    expect(full.body.error.code).toBe('limit_reached');
    await db.delete(spaceSounds).where(eq(spaceSounds.spaceId, b.space.id));
  });

  it('playing: needs voice (any Space of mine), membership of the sound’s Space and SPEAK there', async () => {
    await play(bob, a, horn.id).expect(400);
    // Eve is in voice in her own Space but not a member of Alpha.
    const own = (await t.api(eve).post('/api/spaces').send({ name: 'Eve’s' }).expect(201)).body as SpaceDetail;
    await joinVoice(eve, voiceOf(own).id);
    await play(eve, a, horn.id).expect(404);
    // A sound id of another Space under Alpha's path.
    await play(bob, b, horn.id).expect(404);

    // Bob in Beta's voice channel plays Alpha's sound: Carol (who can see the channel) hears it.
    const watcher = await connect(carol);
    const outsider = expectNoEvent(open[0]!, 'voice:sound', 500);
    const heard = waitForEvent(watcher, 'voice:sound');
    await joinVoice(bob, voiceOf(b).id);
    await play(bob, a, horn.id).expect(204);
    expect(await heard).toEqual({ spaceId: b.space.id, channelId: voiceOf(b).id, userId: bob.id, sound: horn });
    await outsider;

    // SPEAK denied in the channel: 403.
    resetSoundCooldowns();
    await t
      .api(owner)
      .put(`/api/spaces/${b.space.id}/channels/${voiceOf(b).id}/overwrites/member/${bob.id}`)
      .send({ allow: 0, deny: PERM.SPEAK })
      .expect(200);
    await spaceRegistryIdle();
    await play(bob, a, horn.id).expect(403);
    await t.api(owner).delete(`/api/spaces/${b.space.id}/channels/${voiceOf(b).id}/overwrites/member/${bob.id}`).expect(200);
    await spaceRegistryIdle();
    await play(bob, a, horn.id).expect(204);
  });

  it('refused while muted or deafened (by myself or a moderator) or in a Stage audience', async () => {
    const s = await joinVoice(bob, voiceOf(b).id);
    const flags = async (patch: Record<string, boolean>) => {
      const seen = waitForEvent(s, 'voice:state', { filter: (p) => p.userId === bob.id });
      s.emit('voice:update', patch);
      await seen;
    };
    await flags({ selfMute: true });
    expect((await play(bob, a, horn.id).expect(400)).body.error.message).toMatch(/unmute/i);
    await flags({ selfMute: true, selfDeaf: true });
    expect((await play(bob, a, horn.id).expect(400)).body.error.message).toMatch(/deafened/i);
    await flags({ selfMute: false, selfDeaf: false });
    await t.api(owner).patch(`/api/spaces/${b.space.id}/members/${bob.id}`).send({ serverMute: true }).expect(200);
    expect((await play(bob, a, horn.id).expect(400)).body.error.message).toMatch(/muted/i);
    await t.api(owner).patch(`/api/spaces/${b.space.id}/members/${bob.id}`).send({ serverMute: false, serverDeaf: true }).expect(200);
    expect((await play(bob, a, horn.id).expect(400)).body.error.message).toMatch(/deafened/i);
    await t.api(owner).patch(`/api/spaces/${b.space.id}/members/${bob.id}`).send({ serverDeaf: false }).expect(200);
    // Refusals do not use up the cooldown.
    await play(bob, a, horn.id).expect(204);

    // A Stage audience cannot play; a speaker can.
    resetSoundCooldowns();
    const stage = (await t
      .api(owner)
      .post(`/api/spaces/${b.space.id}/channels`)
      .send({ type: 'space_stage', name: 'Stage' })
      .expect(201)).body as ChatSummary;
    await spaceRegistryIdle();
    await emitAck(s, 'voice:join', { channelId: stage.id });
    expect((await play(bob, a, horn.id).expect(400)).body.error.message).toMatch(/audience/i);
    await t.api(owner).patch(`/api/spaces/${b.space.id}/voice-states/${bob.id}/stage`).send({ suppressed: false }).expect(200);
    await play(bob, a, horn.id).expect(204);
  });

  it('the cooldown: one play per user per 1.5 s (429)', async () => {
    await joinVoice(bob, voiceOf(b).id);
    await joinVoice(owner, voiceOf(b).id);
    await play(bob, a, horn.id).expect(204);
    const again = await play(bob, a, horn.id).expect(429);
    expect(again.body.error.code).toBe('rate_limited');
    // Per user: the owner is not held back by Bob.
    await play(owner, a, horn.id).expect(204);
    await sleep(1_600);
    await play(bob, a, horn.id).expect(204);
  });
});
