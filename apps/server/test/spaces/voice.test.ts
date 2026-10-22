/**
 * Voice channels (modules/voice): join/leave/update over the socket, permission and user-limit
 * checks, one connection per account, fan-out only to who can see the channel, moderator
 * disconnect and move, cleanup on socket disconnect.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  PERM,
  type SpaceDetail,
  type SpaceInvite,
  type SpaceRole,
  type VoiceJoinResult,
  type VoiceState,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { voiceStates } from '../../src/db/schema.js';
import { spaceRegistryIdle } from '../../src/realtime/spaceRegistry.js';
import { emitAck, expectNoEvent, startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';

function jwtPayload(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8')) as Record<string, unknown>;
}

describe('voice channels', () => {
  let t: TestServer;
  let owner: TestUser;
  let bob: TestUser;
  let carol: TestUser;
  let detail: SpaceDetail;
  const voice = () => detail.channels.find((c) => c.type === 'space_voice')!;

  beforeAll(async () => {
    t = await startTestServer();
    [owner, bob, carol] = [
      await t.createUser({ displayName: 'Owner' }),
      await t.createUser({ displayName: 'Bob' }),
      await t.createUser({ displayName: 'Carol' }),
    ];
    detail = (await t.api(owner).post('/api/spaces').send({ name: 'Voice Lab' }).expect(201)).body as SpaceDetail;
    const invite = (await t.api(owner).post(`/api/spaces/${detail.space.id}/invites`).send({}).expect(201)).body as SpaceInvite;
    for (const u of [bob, carol]) await t.api(u).post(`/api/invites/${invite.code}/join`).expect(200);
    await spaceRegistryIdle();
  });
  afterAll(() => {
    config.voice.apiKey = undefined;
    config.voice.apiSecret = undefined;
    return t.close();
  });

  it('refuses to join while voice is not configured', async () => {
    const s = await t.connect(bob);
    await expect(emitAck(s, 'voice:join', { channelId: voice().id })).rejects.toThrow(/not available/);
    s.disconnect();
  });

  it('joins with a LiveKit token, tells the Space, lists the state', async () => {
    config.voice.apiKey = 'devkey';
    config.voice.apiSecret = 'devsecret-devsecret-devsecret-0123';
    const watcher = await t.connect(carol);
    const s = await t.connect(bob);
    const seen = waitForEvent(watcher, 'voice:state', { filter: (p) => p.userId === bob.id && !!p.state });
    const res = await emitAck<VoiceJoinResult>(s, 'voice:join', { channelId: voice().id });
    expect(res.url).toBe('/livekit');
    expect(res.state).toMatchObject({ userId: bob.id, channelId: voice().id, selfMute: false });
    const claims = jwtPayload(res.token);
    expect(claims.sub).toBe(bob.id);
    expect(claims.video).toMatchObject({ room: voice().id, roomJoin: true, canSubscribe: true });
    expect((claims.video as { canPublishSources: string[] }).canPublishSources).toContain('microphone');
    expect((await seen).state?.channelId).toBe(voice().id);

    const list = (await t.api(carol).get(`/api/spaces/${detail.space.id}/voice-states`).expect(200)).body as VoiceState[];
    expect(list.map((v) => v.userId)).toEqual([bob.id]);

    const flags = waitForEvent(watcher, 'voice:state', { filter: (p) => p.userId === bob.id && !!p.state?.selfMute });
    s.emit('voice:update', { selfMute: true });
    expect((await flags).state).toMatchObject({ selfMute: true });

    // Disconnecting the socket leaves.
    const left = waitForEvent(watcher, 'voice:state', { filter: (p) => p.userId === bob.id && p.state === null });
    s.disconnect();
    await left;
    expect(await db.select().from(voiceStates).where(eq(voiceStates.userId, bob.id))).toHaveLength(0);
    watcher.disconnect();
  });

  it('one connection per account: joining on another device disconnects the first', async () => {
    const a = await t.connect(bob);
    const b = await t.connect(bob);
    await emitAck(a, 'voice:join', { channelId: voice().id });
    const kicked = waitForEvent(a, 'voice:disconnected');
    await emitAck(b, 'voice:join', { channelId: voice().id });
    expect(await kicked).toMatchObject({ reason: 'moved_elsewhere' });
    // The first socket can no longer leave for the second.
    await emitAck(a, 'voice:leave', {});
    expect(await db.select().from(voiceStates).where(eq(voiceStates.userId, bob.id))).toHaveLength(1);
    await emitAck(b, 'voice:leave', {});
    a.disconnect();
    b.disconnect();
  });

  it('enforces the user limit (MOVE_MEMBERS bypasses it) and CONNECT', async () => {
    await t.api(owner).patch(`/api/spaces/${detail.space.id}/channels/${voice().id}`).send({ userLimit: 1 }).expect(200);
    const sb = await t.connect(bob);
    const sc = await t.connect(carol);
    const so = await t.connect(owner);
    await emitAck(sb, 'voice:join', { channelId: voice().id });
    await expect(emitAck(sc, 'voice:join', { channelId: voice().id })).rejects.toThrow(/full/);
    await emitAck(so, 'voice:join', { channelId: voice().id });
    await emitAck(so, 'voice:leave', {});
    await emitAck(sb, 'voice:leave', {});
    await t.api(owner).patch(`/api/spaces/${detail.space.id}/channels/${voice().id}`).send({ userLimit: null }).expect(200);

    // @everyone without CONNECT on this channel.
    const everyone = detail.space.roles.find((r) => r.isDefault)!;
    await t
      .api(owner)
      .put(`/api/spaces/${detail.space.id}/channels/${voice().id}/overwrites/role/${everyone.id}`)
      .send({ allow: 0, deny: PERM.CONNECT })
      .expect(200);
    await spaceRegistryIdle();
    await expect(emitAck(sc, 'voice:join', { channelId: voice().id })).rejects.toThrow(/permission/);
    await t.api(owner).delete(`/api/spaces/${detail.space.id}/channels/${voice().id}/overwrites/role/${everyone.id}`).expect(200);
    await spaceRegistryIdle();
    for (const s of [sb, sc, so]) s.disconnect();
  });

  it('private voice channels stay private: no join, no events, not listed', async () => {
    const priv = (await t
      .api(owner)
      .post(`/api/spaces/${detail.space.id}/channels`)
      .send({ type: 'space_voice', name: 'Staff', privateRoleIds: [] })
      .expect(201)).body as { id: string };
    await spaceRegistryIdle();
    const sc = await t.connect(carol);
    const so = await t.connect(owner);
    await expect(emitAck(sc, 'voice:join', { channelId: priv.id })).rejects.toThrow();
    const none = expectNoEvent(sc, 'voice:state', 400);
    await emitAck(so, 'voice:join', { channelId: priv.id });
    await none;
    const list = (await t.api(carol).get(`/api/spaces/${detail.space.id}/voice-states`).expect(200)).body as VoiceState[];
    expect(list).toEqual([]);
    await emitAck(so, 'voice:leave', {});
    sc.disconnect();
    so.disconnect();
  });

  it('a moderator disconnects someone (audited); members without MOVE_MEMBERS cannot', async () => {
    const sb = await t.connect(bob);
    await emitAck(sb, 'voice:join', { channelId: voice().id });
    await t.api(carol).post(`/api/spaces/${detail.space.id}/voice-states/${bob.id}/disconnect`).expect(403);
    const kicked = waitForEvent(sb, 'voice:disconnected');
    await t.api(owner).post(`/api/spaces/${detail.space.id}/voice-states/${bob.id}/disconnect`).expect(204);
    expect(await kicked).toMatchObject({ reason: 'disconnected_by_moderator' });
    const log = (await t.api(owner).get(`/api/spaces/${detail.space.id}/audit-log`).expect(200)).body as { action: string }[];
    expect(log.some((e) => e.action === 'member.voice_disconnect')).toBe(true);
    sb.disconnect();
  });

  describe('moving members between voice channels', () => {
    let lounge: { id: string };
    const move = (actor: TestUser, userId: string, channelId: string) =>
      t.api(actor).post(`/api/spaces/${detail.space.id}/voice-states/${userId}/move`).send({ channelId });

    beforeAll(async () => {
      lounge = (await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/channels`)
        .send({ type: 'space_voice', name: 'Lounge' })
        .expect(201)).body as { id: string };
      await spaceRegistryIdle();
    });

    it('moves the member (user limit bypassed): voice:moved with a token for the new room, states for both channels, audited', async () => {
      // The Lounge is full: Carol is in it and its limit is 1.
      await t.api(owner).patch(`/api/spaces/${detail.space.id}/channels/${lounge.id}`).send({ userLimit: 1 }).expect(200);
      const sc = await t.connect(carol);
      await emitAck(sc, 'voice:join', { channelId: lounge.id });
      const sb = await t.connect(bob);
      await emitAck(sb, 'voice:join', { channelId: voice().id });

      const moved = waitForEvent(sb, 'voice:moved');
      const left = waitForEvent(sc, 'voice:state', { filter: (p) => p.userId === bob.id && p.channelId === voice().id && p.state === null });
      const arrived = waitForEvent(sc, 'voice:state', { filter: (p) => p.userId === bob.id && p.state?.channelId === lounge.id });
      const noDisconnect = expectNoEvent(sb, 'voice:disconnected', 500);
      await move(owner, bob.id, lounge.id).expect(204);

      const ev = await moved;
      expect(ev.from).toBe(voice().id);
      expect(ev.result.url).toBe('/livekit');
      expect(ev.result.state).toMatchObject({ userId: bob.id, spaceId: detail.space.id, channelId: lounge.id });
      const claims = jwtPayload(ev.result.token);
      expect(claims.sub).toBe(bob.id);
      expect(claims.video).toMatchObject({ room: lounge.id, roomJoin: true, canSubscribe: true });
      await left;
      await arrived;
      await noDisconnect;
      // The connection keeps its socket (the member did not join again).
      const [row] = await db.select().from(voiceStates).where(eq(voiceStates.userId, bob.id));
      expect(row).toMatchObject({ channelId: lounge.id, socketId: sb.id });
      const list = (await t.api(carol).get(`/api/spaces/${detail.space.id}/voice-states`).expect(200)).body as VoiceState[];
      expect(list.find((v) => v.userId === bob.id)?.channelId).toBe(lounge.id);

      const log = (await t.api(owner).get(`/api/spaces/${detail.space.id}/audit-log`).expect(200)).body as {
        action: string;
        targetId: string | null;
      }[];
      expect(log.some((e) => e.action === 'member.voice_move' && e.targetId === bob.id)).toBe(true);

      // Moving someone to where they already are changes nothing.
      const none = expectNoEvent(sb, 'voice:moved', 300);
      await move(owner, bob.id, lounge.id).expect(204);
      await none;

      await emitAck(sb, 'voice:leave', {});
      await emitAck(sc, 'voice:leave', {});
      await t.api(owner).patch(`/api/spaces/${detail.space.id}/channels/${lounge.id}`).send({ userLimit: null }).expect(200);
      sb.disconnect();
      sc.disconnect();
    });

    it('members without MOVE_MEMBERS get 403; someone not in voice is 404', async () => {
      const sb = await t.connect(bob);
      await emitAck(sb, 'voice:join', { channelId: voice().id });
      const none = expectNoEvent(sb, 'voice:moved', 300);
      await move(carol, bob.id, lounge.id).expect(403);
      await none;
      expect((await db.select().from(voiceStates).where(eq(voiceStates.userId, bob.id)))[0]?.channelId).toBe(voice().id);
      await move(owner, carol.id, lounge.id).expect(404);
      await emitAck(sb, 'voice:leave', {});
      sb.disconnect();
    });

    it('rejects a target that is not a voice channel of this Space', async () => {
      const sb = await t.connect(bob);
      await emitAck(sb, 'voice:join', { channelId: voice().id });
      const text = detail.channels.find((c) => c.type === 'space_text')!;
      await move(owner, bob.id, text.id).expect(400);
      // A voice channel of another Space the mover is in.
      const other = (await t.api(owner).post('/api/spaces').send({ name: 'Elsewhere' }).expect(201)).body as SpaceDetail;
      const otherVoice = other.channels.find((c) => c.type === 'space_voice')!;
      await move(owner, bob.id, otherVoice.id).expect(400);
      // …and one of a Space the mover is not in.
      await move(carol, bob.id, otherVoice.id).expect(404);
      expect((await db.select().from(voiceStates).where(eq(voiceStates.userId, bob.id)))[0]?.channelId).toBe(voice().id);
      await emitAck(sb, 'voice:leave', {});
      sb.disconnect();
    });

    it('a mover with MOVE_MEMBERS needs CONNECT on the target (403 without)', async () => {
      const movers = (await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/roles`)
        .send({ name: 'Movers', permissions: PERM.MOVE_MEMBERS })
        .expect(201)).body as SpaceRole;
      await t.api(owner).put(`/api/spaces/${detail.space.id}/members/${carol.id}/roles/${movers.id}`).expect(200);
      const locked = (await t
        .api(owner)
        .post(`/api/spaces/${detail.space.id}/channels`)
        .send({ type: 'space_voice', name: 'Locked' })
        .expect(201)).body as { id: string };
      await t
        .api(owner)
        .put(`/api/spaces/${detail.space.id}/channels/${locked.id}/overwrites/member/${carol.id}`)
        .send({ allow: 0, deny: PERM.CONNECT })
        .expect(200);
      await spaceRegistryIdle();

      const sb = await t.connect(bob);
      await emitAck(sb, 'voice:join', { channelId: voice().id });
      await move(carol, bob.id, locked.id).expect(403);
      expect((await db.select().from(voiceStates).where(eq(voiceStates.userId, bob.id)))[0]?.channelId).toBe(voice().id);
      // With CONNECT there, the role is enough.
      const moved = waitForEvent(sb, 'voice:moved');
      await move(carol, bob.id, lounge.id).expect(204);
      expect((await moved).result.state.channelId).toBe(lounge.id);
      await emitAck(sb, 'voice:leave', {});
      sb.disconnect();
    });
  });
});
