/**
 * Stage channels (modules/voice): created like voice channels, everyone joins in the audience
 * with a token that cannot publish (the grant builder), hands raised and lowered, moderators
 * (MANAGE_CHANNELS, or MUTE_MEMBERS + MOVE_MEMBERS) inviting people up and moving them back
 * with the media grants pushed live (best effort: a failing LiveKit call never fails the
 * change, and the next token is right), stepping down and up, moves into a Stage, and the
 * sweep keeping Stage connections. LiveKit's room service is faked.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { eq } from 'drizzle-orm';
import { RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import {
  ALL_PERMISSIONS,
  PERM,
  type ChatSummary,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type VoiceJoinResult,
  type VoiceState,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { voiceStates } from '../../src/db/schema.js';
import { mediaPermission, sweepVoice } from '../../src/modules/voice/service.js';
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

function jwtPayload(token: string): { video: Record<string, unknown> } {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as {
    video: Record<string, unknown>;
  };
}

const FLAGS = { serverMute: false, serverDeaf: false };

describe('mediaPermission (the LiveKit grant)', () => {
  it('the audience subscribes (and keeps data) but publishes nothing', () => {
    expect(mediaPermission(ALL_PERMISSIONS, FLAGS, true)).toEqual({
      canSubscribe: true,
      canPublish: false,
      canPublishSources: [],
      canPublishData: true,
    });
  });

  it('speakers publish what their bits allow; server mute takes the mic, server deafen the ears', () => {
    expect(mediaPermission(ALL_PERMISSIONS, FLAGS, false)).toEqual({
      canSubscribe: true,
      canPublish: true,
      canPublishSources: [
        TrackSource.MICROPHONE,
        TrackSource.CAMERA,
        TrackSource.SCREEN_SHARE,
        TrackSource.SCREEN_SHARE_AUDIO,
      ],
      canPublishData: true,
    });
    expect(mediaPermission(PERM.CONNECT | PERM.SPEAK, FLAGS, false).canPublishSources).toEqual([
      TrackSource.MICROPHONE,
    ]);
    const muted = mediaPermission(PERM.CONNECT | PERM.SPEAK, { serverMute: true, serverDeaf: true }, false);
    expect(muted).toMatchObject({ canPublish: false, canPublishSources: [], canSubscribe: false });
  });
});

describe('Stage channels', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let dave: TestUser;
  let detail: SpaceDetail;
  let stage: ChatSummary;
  let update: MockInstance<RoomServiceClient['updateParticipant']>;
  const voice = () => detail.channels.find((c) => c.type === 'space_voice')!;
  const base = () => `/api/spaces/${detail.space.id}`;
  const request = (u: TestUser, requestToSpeak: boolean) =>
    t.api(u).patch(`${base()}/voice-states/@me`).send({ requestToSpeak });
  const seat = (actor: TestUser, target: TestUser, suppressed: boolean) =>
    t.api(actor).patch(`${base()}/voice-states/${target.id}/stage`).send({ suppressed });
  const row = async (u: TestUser) => (await db.select().from(voiceStates).where(eq(voiceStates.userId, u.id)))[0];

  /** Connected sockets of this test (left and closed afterwards). */
  let open: TestSocket[] = [];
  async function join(u: TestUser, channelId = stage.id) {
    const s = await t.connect(u);
    open.push(s);
    const res = await emitAck<VoiceJoinResult>(s, 'voice:join', { channelId });
    return { s, res };
  }

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol, dave] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
      await t.createUser({ displayName: 'Dave' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Town' }).expect(201)).body as SpaceDetail;
    const invite = (await t.api(owner).post(`${base()}/invites`).send({}).expect(201)).body as SpaceInvite;
    for (const u of [bob, carol, dave]) await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    // Dave moderates Stages through MUTE_MEMBERS + MOVE_MEMBERS (no MANAGE_CHANNELS).
    const mods = (await t
      .api(owner)
      .post(`${base()}/roles`)
      .send({ name: 'Stage mods', permissions: PERM.MUTE_MEMBERS | PERM.MOVE_MEMBERS })
      .expect(201)).body as SpaceRole;
    await t.api(owner).put(`${base()}/members/${dave.id}/roles/${mods.id}`).expect(200);
    await spaceRegistryIdle();
    config.voice.apiKey = 'devkey';
    config.voice.apiSecret = 'devsecret-devsecret-devsecret-0123';
    update = vi.spyOn(RoomServiceClient.prototype, 'updateParticipant').mockResolvedValue({} as never);
    vi.spyOn(RoomServiceClient.prototype, 'removeParticipant').mockResolvedValue(undefined as never);
  });
  beforeEach(async () => {
    // Leave on purpose (no Stage seat is kept), then close the last test's sockets.
    for (const s of open) {
      if (s.connected) await emitAck(s, 'voice:leave', {}).catch(() => undefined);
      s.disconnect();
    }
    open = [];
    update.mockClear();
  });
  afterAll(() => {
    vi.restoreAllMocks();
    config.voice.apiKey = undefined;
    config.voice.apiSecret = undefined;
    return t.close();
  });

  it('MANAGE_CHANNELS creates Stage channels laid out like voice channels, with a topic', async () => {
    await t.api(bob).post(`${base()}/channels`).send({ type: 'space_stage', name: 'Nope' }).expect(403);
    stage = (await t
      .api(owner)
      .post(`${base()}/channels`)
      .send({ type: 'space_stage', name: '  Town Hall ', topic: 'Weekly questions', userLimit: 50, bitrate: 48_000 })
      .expect(201)).body as ChatSummary;
    expect(stage.type).toBe('space_stage');
    expect(stage.name).toBe('Town Hall');
    expect(stage.space).toMatchObject({ topic: 'Weekly questions', userLimit: 50, bitrate: 48_000, slowmodeSeconds: 0 });
    const edited = (await t
      .api(owner)
      .patch(`${base()}/channels/${stage.id}`)
      .send({ topic: 'Ask me anything', userLimit: null })
      .expect(200)).body as ChatSummary;
    expect(edited.space).toMatchObject({ topic: 'Ask me anything', userLimit: null });
    await spaceRegistryIdle();
    const list = (await t.api(carol).get(`${base()}/channels`).expect(200)).body as ChatSummary[];
    expect(list.find((c) => c.id === stage.id)?.type).toBe('space_stage');
  });

  it('everyone joins in the audience, moderators too, with a token that cannot publish', async () => {
    const watcher = await t.connect(carol);
    open.push(watcher);
    const seen = waitForEvent(watcher, 'voice:state', { filter: (p) => p.userId === bob.id && !!p.state });
    const { res } = await join(bob);
    expect(res.state).toMatchObject({ channelId: stage.id, suppressed: true, requestToSpeakAt: null });
    expect(jwtPayload(res.token).video).toMatchObject({ room: stage.id, canSubscribe: true, canPublish: false });
    expect((await seen).state).toMatchObject({ suppressed: true });

    const mine = await join(owner);
    expect(mine.res.state.suppressed).toBe(true);
    expect(jwtPayload(mine.res.token).video.canPublish).toBe(false);
    const list = (await t.api(carol).get(`${base()}/voice-states`).expect(200)).body as VoiceState[];
    expect(list.filter((v) => v.channelId === stage.id).every((v) => v.suppressed)).toBe(true);

    // Voice channels are not Stages: no audience there.
    const inVoice = await join(carol, voice().id);
    expect(inVoice.res.state).toMatchObject({ suppressed: false, requestToSpeakAt: null });
    expect(jwtPayload(inVoice.res.token).video.canPublish).toBe(true);
  });

  it('hands: PATCH @me raises and lowers mine (voice:state), 400 unless I am in a Stage of that Space', async () => {
    await request(carol, true).expect(400);
    await join(carol, voice().id);
    await request(carol, true).expect(400);
    const { s } = await join(bob);
    const raised = waitForEvent(s, 'voice:state', { filter: (p) => p.userId === bob.id && !!p.state?.requestToSpeakAt });
    const up = (await request(bob, true).expect(200)).body as VoiceState;
    expect(up.requestToSpeakAt).toEqual(expect.any(String));
    expect((await raised).state?.requestToSpeakAt).toBe(up.requestToSpeakAt);
    // Raising again keeps the first time (the moderators' list is in that order).
    const none = expectNoEvent(s, 'voice:state', 300);
    expect(((await request(bob, true).expect(200)).body as VoiceState).requestToSpeakAt).toBe(up.requestToSpeakAt);
    await none;
    const down = (await request(bob, false).expect(200)).body as VoiceState;
    expect(down.requestToSpeakAt).toBeNull();
    expect((await row(bob))?.requestToSpeakAt).toBeNull();
    // Another Space: not mine to raise a hand in.
    const other = (await t.api(owner).post('/api/spaces').send({ name: 'Elsewhere' }).expect(201)).body as SpaceDetail;
    await t.api(owner).patch(`/api/spaces/${other.space.id}/voice-states/@me`).send({ requestToSpeak: true }).expect(400);
    await t.api(bob).patch(`${base()}/voice-states/@me`).send({ requestToSpeak: 'yes' }).expect(400);
  });

  it('moderators invite people up (hand cleared, grants pushed live) and move them back; others get 403', async () => {
    await join(carol);
    await join(bob);
    await request(bob, true).expect(200);
    await seat(carol, bob, false).expect(403);
    expect((await row(bob))?.suppressed).toBe(true);
    // MUTE_MEMBERS alone is not enough.
    const muters = (await t
      .api(owner)
      .post(`${base()}/roles`)
      .send({ name: 'Muters', permissions: PERM.MUTE_MEMBERS })
      .expect(201)).body as SpaceRole;
    await t.api(owner).put(`${base()}/members/${carol.id}/roles/${muters.id}`).expect(200);
    await spaceRegistryIdle();
    await seat(carol, bob, false).expect(403);
    expect(update).not.toHaveBeenCalled();

    const watcher = open[0]!;
    const invited = waitForEvent(watcher, 'voice:state', { filter: (p) => p.userId === bob.id && p.state?.suppressed === false });
    const up = (await seat(dave, bob, false).expect(200)).body as VoiceState;
    expect(up).toMatchObject({ userId: bob.id, channelId: stage.id, suppressed: false, requestToSpeakAt: null });
    expect((await invited).state).toMatchObject({ suppressed: false, requestToSpeakAt: null });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(stage.id, bob.id, {
      permission: expect.objectContaining({ canPublish: true, canSubscribe: true }) as unknown,
    });
    const granted = (update.mock.calls[0]![2] as unknown as { permission: { canPublishSources: TrackSource[] } })
      .permission;
    expect(granted.canPublishSources).toContain(TrackSource.MICROPHONE);

    // Back to the audience (the owner moderates through MANAGE_CHANNELS).
    const back = (await seat(owner, bob, true).expect(200)).body as VoiceState;
    expect(back.suppressed).toBe(true);
    expect(update).toHaveBeenLastCalledWith(stage.id, bob.id, {
      permission: expect.objectContaining({ canPublish: false, canPublishSources: [] }) as unknown,
    });
    // Nothing changes: no event, no media call.
    update.mockClear();
    await seat(owner, bob, true).expect(200);
    expect(update).not.toHaveBeenCalled();
    await t.api(owner).delete(`${base()}/members/${carol.id}/roles/${muters.id}`).expect(200);
  });

  it('anyone steps down to the audience; only moderators step up', async () => {
    await join(bob);
    await join(dave);
    await seat(owner, bob, false).expect(200);
    const down = (await seat(bob, bob, true).expect(200)).body as VoiceState;
    expect(down.suppressed).toBe(true);
    await seat(bob, bob, false).expect(403);
    const up = (await seat(dave, dave, false).expect(200)).body as VoiceState;
    expect(up.suppressed).toBe(false);
    expect(update).toHaveBeenLastCalledWith(stage.id, dave.id, {
      permission: expect.objectContaining({ canPublish: true }) as unknown,
    });
  });

  it('a failing LiveKit update never fails the change; the next token carries the grants', async () => {
    const { s } = await join(bob);
    update.mockRejectedValueOnce(new Error('participant not found'));
    const invited = waitForEvent(s, 'voice:state', { filter: (p) => p.userId === bob.id && p.state?.suppressed === false });
    const up = (await seat(owner, bob, false).expect(200)).body as VoiceState;
    expect(up.suppressed).toBe(false);
    await invited;
    expect(update).toHaveBeenCalledTimes(1);
    expect((await row(bob))?.suppressed).toBe(false);
    // Rejoining the same channel keeps the role: the fresh token can publish.
    const again = await emitAck<VoiceJoinResult>(s, 'voice:join', { channelId: stage.id });
    expect(again.state.suppressed).toBe(false);
    expect(jwtPayload(again.token).video.canPublish).toBe(true);
    // And a synchronous throw is just as harmless.
    update.mockImplementationOnce(() => {
      throw new Error('livekit down');
    });
    expect(((await seat(owner, bob, true).expect(200)).body as VoiceState).suppressed).toBe(true);
  });

  it('404 for someone not connected in this Space, 400 when they are in a voice channel', async () => {
    await seat(owner, bob, false).expect(404);
    await join(bob, voice().id);
    await seat(owner, bob, false).expect(400);
    await t.api(owner).patch(`${base()}/voice-states/${bob.id}/stage`).send({}).expect(400);
  });

  it('moving someone into a Stage seats them in the audience; back to voice, they talk again', async () => {
    const { s } = await join(bob, voice().id);
    const moved = waitForEvent(s, 'voice:moved');
    await t.api(owner).post(`${base()}/voice-states/${bob.id}/move`).send({ channelId: stage.id }).expect(204);
    const ev = await moved;
    expect(ev.result.state).toMatchObject({ channelId: stage.id, suppressed: true, requestToSpeakAt: null });
    expect(jwtPayload(ev.result.token).video).toMatchObject({ room: stage.id, canPublish: false });

    await seat(owner, bob, false).expect(200);
    const back = waitForEvent(s, 'voice:moved');
    await t.api(owner).post(`${base()}/voice-states/${bob.id}/move`).send({ channelId: voice().id }).expect(204);
    const ev2 = await back;
    expect(ev2.result.state).toMatchObject({ channelId: voice().id, suppressed: false });
    expect(jwtPayload(ev2.result.token).video.canPublish).toBe(true);
  });

  it('a speaker whose socket drops gets the seat back on return; leaving on purpose does not', async () => {
    const first = await join(bob);
    await seat(owner, bob, false).expect(200);
    first.s.disconnect();
    for (let i = 0; i < 100 && (await row(bob)); i++) await new Promise((r) => setTimeout(r, 20));
    expect(await row(bob)).toBeUndefined();
    const again = await join(bob);
    expect(again.res.state.suppressed).toBe(false);
    expect(jwtPayload(again.res.token).video.canPublish).toBe(true);
    await emitAck(again.s, 'voice:leave', {});
    const third = await join(bob);
    expect(third.res.state.suppressed).toBe(true);
  });

  it('leaving clears the Stage state; the sweep keeps Stage connections', async () => {
    const { s } = await join(bob);
    await request(bob, true).expect(200);
    await sweepVoice();
    expect(await row(bob)).toMatchObject({ channelId: stage.id, suppressed: true });
    await emitAck(s, 'voice:leave', {});
    expect(await row(bob)).toBeUndefined();
    const { res } = await join(bob);
    expect(res.state).toMatchObject({ suppressed: true, requestToSpeakAt: null });
  });
});
