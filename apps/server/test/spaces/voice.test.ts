/**
 * Voice channels (modules/voice): join/leave/update over the socket, permission and user-limit
 * checks, one connection per account, fan-out only to who can see the channel, moderator
 * disconnect, cleanup on socket disconnect.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { PERM, type SpaceDetail, type SpaceInvite, type VoiceJoinResult, type VoiceState } from '@enbox/shared';
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
});
