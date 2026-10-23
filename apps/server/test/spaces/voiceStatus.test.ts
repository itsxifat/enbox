/**
 * Voice channel status (modules/voice/status.ts): set by someone connected to the channel with
 * SPEAK (trimmed, blank clears, at most VOICE_STATUS_MAX_LENGTH), 403 for anyone else, the
 * change reaching everyone who can see the channel as `chat:updated { space }`, cleared once
 * the last person leaves (leave, socket drop, switching channels, a moderator's move or
 * disconnect), on Stages too, and one change per user every two seconds. LiveKit is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { RoomServiceClient } from 'livekit-server-sdk';
import {
  PERM,
  VOICE_STATUS_MAX_LENGTH,
  type ChatSummary,
  type SpaceDetail,
  type SpaceInvite,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { chats } from '../../src/db/schema.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import {
  emitAck,
  expectNoEvent,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';

describe('voice channel status', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  let lounge: ChatSummary;
  let stage: ChatSummary;
  const voice = () => detail.channels.find((c) => c.type === 'space_voice')!;
  const base = () => `/api/spaces/${detail.space.id}`;
  const put = (u: TestUser, chatId: string, status: unknown) =>
    t.api(u).put(`/api/chats/${chatId}/voice-status`).send({ status });
  const stored = async (chatId: string) =>
    (await db.select({ s: chats.voiceStatus }).from(chats).where(eq(chats.id, chatId)))[0]?.s;
  /** The next `chat:updated` of `chatId` that carries its Space data. */
  const statusEvent = (s: TestSocket, chatId: string) =>
    waitForEvent(s, 'chat:updated', { filter: (p) => p.chatId === chatId && !!p.changes.space });

  /** Connected sockets of this test (left and closed before the next one). */
  let open: TestSocket[] = [];
  async function join(u: TestUser, channelId = voice().id) {
    const s = await t.connect(u);
    open.push(s);
    await emitAck(s, 'voice:join', { channelId });
    return s;
  }
  async function watch(u: TestUser) {
    const s = await t.connect(u);
    open.push(s);
    return s;
  }

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Status Lab' }).expect(201))
      .body as SpaceDetail;
    const invite = (await t.api(owner).post(`${base()}/invites`).send({}).expect(201))
      .body as SpaceInvite;
    for (const u of [bob, carol])
      await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    lounge = (
      await t
        .api(owner)
        .post(`${base()}/channels`)
        .send({ type: 'space_voice', name: 'Lounge' })
        .expect(201)
    ).body as ChatSummary;
    stage = (
      await t
        .api(owner)
        .post(`${base()}/channels`)
        .send({ type: 'space_stage', name: 'Town Hall' })
        .expect(201)
    ).body as ChatSummary;
    await spaceRegistryIdle();
    config.voice.apiKey = 'devkey';
    config.voice.apiSecret = 'devsecret-devsecret-devsecret-0123';
    vi.spyOn(RoomServiceClient.prototype, 'removeParticipant').mockResolvedValue(
      undefined as never,
    );
    vi.spyOn(RoomServiceClient.prototype, 'updateParticipant').mockResolvedValue({} as never);
  });
  beforeEach(async () => {
    for (const s of open) {
      if (s.connected) await emitAck(s, 'voice:leave', {}).catch(() => undefined);
      s.disconnect();
    }
    open = [];
    await db.update(chats).set({ voiceStatus: null }).where(eq(chats.spaceId, detail.space.id));
  });
  afterAll(() => {
    vi.restoreAllMocks();
    config.voice.apiKey = undefined;
    config.voice.apiSecret = undefined;
    return t.close();
  });

  it('someone connected sets it (trimmed): everyone who can see the channel hears, the summary carries it', async () => {
    const watcher = await watch(carol);
    await join(bob);
    const seen = statusEvent(watcher, voice().id);
    await put(bob, voice().id, '  Movie night 🍿  ').expect(204);
    const ev = await seen;
    expect(ev.changes.space).toMatchObject({
      spaceId: detail.space.id,
      voiceStatus: 'Movie night 🍿',
    });
    expect(await stored(voice().id)).toBe('Movie night 🍿');
    const list = (await t.api(carol).get(`${base()}/channels`).expect(200)).body as ChatSummary[];
    expect(list.find((c) => c.id === voice().id)?.space?.voiceStatus).toBe('Movie night 🍿');

    // The same text again changes nothing; blank text clears it.
    const none = expectNoEvent(watcher, 'chat:updated', 300);
    await put(bob, voice().id, 'Movie night 🍿').expect(204);
    await none;
    const cleared = statusEvent(watcher, voice().id);
    await put(bob, voice().id, '   ').expect(204);
    expect((await cleared).changes.space?.voiceStatus).toBeNull();
    expect(await stored(voice().id)).toBeNull();
    await put(bob, voice().id, null).expect(204);
  });

  it('403 unless I am connected to that channel; 404 for channels that are not voice channels', async () => {
    await put(bob, voice().id, 'Hi').expect(403);
    await join(bob, lounge.id);
    await put(bob, voice().id, 'Hi').expect(403);
    const text = detail.channels.find((c) => c.type === 'space_text')!;
    await put(bob, text.id, 'Hi').expect(404);
    // A Space I am not in looks like nothing at all.
    const other = (await t.api(owner).post('/api/spaces').send({ name: 'Elsewhere' }).expect(201))
      .body as SpaceDetail;
    await put(bob, other.channels.find((c) => c.type === 'space_voice')!.id, 'Hi').expect(404);
    expect(await stored(voice().id)).toBeNull();
  });

  it('rejects text over the limit and a missing status', async () => {
    await join(bob);
    await put(bob, voice().id, 'x'.repeat(VOICE_STATUS_MAX_LENGTH + 1)).expect(400);
    await t.api(bob).put(`/api/chats/${voice().id}/voice-status`).send({}).expect(400);
    await put(bob, voice().id, 'x'.repeat(VOICE_STATUS_MAX_LENGTH)).expect(204);
  });

  it('needs SPEAK in the channel', async () => {
    const everyone = detail.space.roles.find((r) => r.isDefault)!;
    await t
      .api(owner)
      .put(`${base()}/channels/${lounge.id}/overwrites/role/${everyone.id}`)
      .send({ allow: 0, deny: PERM.SPEAK })
      .expect(200);
    await spaceRegistryIdle();
    try {
      await join(bob, lounge.id);
      await put(bob, lounge.id, 'Hi').expect(403);
    } finally {
      await t
        .api(owner)
        .delete(`${base()}/channels/${lounge.id}/overwrites/role/${everyone.id}`)
        .expect(200);
      await spaceRegistryIdle();
    }
  });

  it('stays while anyone is left and is cleared when the last person leaves', async () => {
    const watcher = await watch(owner);
    const sb = await join(bob);
    const sc = await join(carol);
    await put(bob, voice().id, 'Raid at 9').expect(204);
    const none = expectNoEvent(watcher, 'chat:updated', 300);
    await emitAck(sb, 'voice:leave', {});
    await none;
    expect(await stored(voice().id)).toBe('Raid at 9');
    const cleared = statusEvent(watcher, voice().id);
    await emitAck(sc, 'voice:leave', {});
    expect((await cleared).changes.space?.voiceStatus).toBeNull();
    expect(await stored(voice().id)).toBeNull();
  });

  it('a dropped socket, switching channels, a move and a disconnect all clear it when the channel empties', async () => {
    const watcher = await watch(owner);
    // The socket drops.
    const s1 = await join(bob);
    await put(bob, voice().id, 'One').expect(204);
    let cleared = statusEvent(watcher, voice().id);
    s1.disconnect();
    expect((await cleared).changes.space?.voiceStatus).toBeNull();

    // Joining another channel leaves this one.
    const s2 = await join(bob);
    await put(bob, voice().id, 'Two').expect(204);
    cleared = statusEvent(watcher, voice().id);
    await emitAck(s2, 'voice:join', { channelId: lounge.id });
    expect((await cleared).changes.space?.voiceStatus).toBeNull();

    // A moderator moves the last person out.
    await put(bob, lounge.id, 'Three').expect(204);
    cleared = statusEvent(watcher, lounge.id);
    await t
      .api(owner)
      .post(`${base()}/voice-states/${bob.id}/move`)
      .send({ channelId: voice().id })
      .expect(204);
    expect((await cleared).changes.space?.voiceStatus).toBeNull();

    // …or disconnects them.
    await put(bob, voice().id, 'Four').expect(204);
    cleared = statusEvent(watcher, voice().id);
    await t.api(owner).post(`${base()}/voice-states/${bob.id}/disconnect`).expect(204);
    expect((await cleared).changes.space?.voiceStatus).toBeNull();
    expect(await stored(voice().id)).toBeNull();
    expect(await stored(lounge.id)).toBeNull();
  });

  it('Stage channels: speakers and moderators set it, listeners do not; cleared when it empties', async () => {
    const watcher = await watch(bob);
    const sc = await join(carol, stage.id);
    await put(carol, stage.id, 'Q&A').expect(403);
    // The owner moderates the Stage, from the audience too.
    const so = await join(owner, stage.id);
    const seen = statusEvent(watcher, stage.id);
    await put(owner, stage.id, 'Q&A').expect(204);
    expect((await seen).changes.space?.voiceStatus).toBe('Q&A');
    // Invited up, Carol may change it.
    await t
      .api(owner)
      .patch(`${base()}/voice-states/${carol.id}/stage`)
      .send({ suppressed: false })
      .expect(200);
    await put(carol, stage.id, 'Q&A, part 2').expect(204);
    await emitAck(so, 'voice:leave', {});
    expect(await stored(stage.id)).toBe('Q&A, part 2');
    const cleared = statusEvent(watcher, stage.id);
    await emitAck(sc, 'voice:leave', {});
    expect((await cleared).changes.space?.voiceStatus).toBeNull();
  });

  it('one change every two seconds per user', async () => {
    await join(bob);
    config.rateLimit = true;
    resetUserLimits();
    try {
      await put(bob, voice().id, 'First').expect(204);
      await put(bob, voice().id, 'Second').expect(429);
      expect(await stored(voice().id)).toBe('First');
    } finally {
      config.rateLimit = false;
      resetUserLimits();
    }
  });
});
