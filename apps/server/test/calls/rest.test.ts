import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import type { Call, CallLogEntry } from '@enbox/shared';
import { config } from '../../src/config.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { resetCallState, setCallTimings } from '../../src/modules/calls/state.js';
import { transact } from '../../src/services/effects.js';
import { upsertMembership } from '../../src/services/membership.js';
import { startTestServer, type TestServer, type TestSocket, type TestUser } from '../helpers.js';
import { block, createDirect, createGroup, recordEvents } from '../services/fixtures.js';
import { ackCall, ackError, callRow, send, until } from './helpers.js';

describe('calls: REST', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterEach(() => setCallTimings());
  afterAll(async () => {
    resetCallState();
    await t.close();
  });

  const waitStatus = (callId: string, status: Call['status']) => until(async () => (await callRow(callId)).status === status, 3000, `call ${status}`);

  describe('GET /calls (call log)', () => {
    let alice: TestUser, bob: TestUser, carol: TestUser, dave: TestUser;
    let a: TestSocket, b: TestSocket, c: TestSocket, d: TestSocket;
    let ab: string, group: string, da: string;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      alice = await t.createUser({ displayName: 'Alice' });
      bob = await t.createUser({ displayName: 'Bob' });
      carol = await t.createUser({ displayName: 'Carol' });
      dave = await t.createUser({ displayName: 'Dave' });
      ab = await createDirect(alice, bob);
      da = await createDirect(dave, alice);
      group = await createGroup(carol, [alice, bob], { name: 'Trio' });
      [a, b, c, d] = await Promise.all([alice, bob, carol, dave].map((u) => t.connect(u)));

      // 1. Alice → Bob, answered.
      let call = await ackCall(a, 'call:start', { chatId: ab, type: 'video' });
      await ackCall(b, 'call:accept', { callId: call.id });
      send(b, 'call:leave', { callId: call.id });
      await waitStatus(call.id, 'ended');
      ids.answered = call.id;

      // 2. Bob → Alice, Alice declines.
      call = await ackCall(b, 'call:start', { chatId: ab, type: 'audio' });
      send(a, 'call:decline', { callId: call.id });
      await waitStatus(call.id, 'declined');
      ids.declined = call.id;

      // 3. Alice → Bob, Alice cancels.
      call = await ackCall(a, 'call:start', { chatId: ab, type: 'audio' });
      send(a, 'call:leave', { callId: call.id });
      await waitStatus(call.id, 'cancelled');
      ids.cancelled = call.id;

      // 4. Bob → Alice, nobody answers.
      setCallTimings({ ringTimeoutMs: 200 });
      call = await ackCall(b, 'call:start', { chatId: ab, type: 'audio' });
      await waitStatus(call.id, 'missed');
      setCallTimings();
      ids.unanswered = call.id;

      // 5. Carol → group; Alice answers, Bob declines.
      call = await ackCall(c, 'call:start', { chatId: group, type: 'audio' });
      await ackCall(a, 'call:accept', { callId: call.id });
      send(b, 'call:decline', { callId: call.id });
      await until(async () => (await callRow(call.id)).status === 'ongoing', 3000, 'group ongoing');
      // 6. Dave → Alice while she is in the group call: busy → missed for her.
      const busy = await ackCall(d, 'call:start', { chatId: da, type: 'audio' });
      expect(busy.status).toBe('missed');
      ids.busy = busy.id;
      send(a, 'call:leave', { callId: call.id });
      await waitStatus(call.id, 'ended');
      ids.group = call.id;

      // 7. A live call (Bob → Alice ringing).
      ids.live = (await ackCall(b, 'call:start', { chatId: ab, type: 'video' })).id;
    });

    afterAll(async () => {
      send(b, 'call:leave', { callId: ids.live! });
      await waitStatus(ids.live!, 'cancelled');
    });

    it('lists my calls newest first with per-viewer direction/outcome and the chat', async () => {
      const res = await t.api(alice).get('/api/calls').expect(200);
      const log = res.body as CallLogEntry[];
      expect(log.map((e) => e.call.id)).toEqual([ids.live, ids.busy, ids.group, ids.unanswered, ids.cancelled, ids.declined, ids.answered]);
      const byId = Object.fromEntries(log.map((e) => [e.call.id, e]));
      expect(byId[ids.answered!]).toMatchObject({ direction: 'outgoing', outcome: 'answered', call: { status: 'ended', type: 'video' } });
      expect(byId[ids.answered!]!.call.durationSec).toEqual(expect.any(Number));
      expect(byId[ids.declined!]).toMatchObject({ direction: 'incoming', outcome: 'declined' });
      expect(byId[ids.cancelled!]).toMatchObject({ direction: 'outgoing', outcome: 'cancelled' });
      expect(byId[ids.unanswered!]).toMatchObject({ direction: 'incoming', outcome: 'missed' });
      expect(byId[ids.group!]).toMatchObject({ direction: 'incoming', outcome: 'answered', call: { isGroup: true } });
      expect(byId[ids.busy!]).toMatchObject({ direction: 'incoming', outcome: 'missed' });
      expect(byId[ids.live!]).toMatchObject({ direction: 'incoming', outcome: 'ongoing' });
      // Chat pick: direct → peer (as I see them); group → name.
      expect(byId[ids.answered!]!.chat).toMatchObject({ id: ab, type: 'direct', name: null, avatarUrl: null });
      expect(byId[ids.answered!]!.chat.peer).toMatchObject({ id: bob.id, displayName: 'Bob' });
      expect(byId[ids.busy!]!.chat.peer?.id).toBe(dave.id);
      expect(byId[ids.group!]!.chat).toEqual({ id: group, type: 'group', name: 'Trio', avatarUrl: null, peer: null });

      const bobLog = Object.fromEntries(((await t.api(bob).get('/api/calls').expect(200)).body as CallLogEntry[]).map((e) => [e.call.id, e]));
      expect(bobLog[ids.answered!]).toMatchObject({ direction: 'incoming', outcome: 'answered' });
      expect(bobLog[ids.declined!]).toMatchObject({ direction: 'outgoing', outcome: 'declined' });
      expect(bobLog[ids.cancelled!]).toMatchObject({ direction: 'incoming', outcome: 'missed' });
      expect(bobLog[ids.unanswered!]).toMatchObject({ direction: 'outgoing', outcome: 'unanswered' });
      expect(bobLog[ids.group!]).toMatchObject({ direction: 'incoming', outcome: 'declined' });
      expect(bobLog[ids.busy!]).toBeUndefined(); // not a participant
      expect(bobLog[ids.answered!]!.chat.peer?.id).toBe(alice.id);
      const carolLog = (await t.api(carol).get('/api/calls').expect(200)).body as CallLogEntry[];
      expect(carolLog.map((e) => [e.call.id, e.direction, e.outcome])).toEqual([[ids.group, 'outgoing', 'answered']]);
      const daveLog = (await t.api(dave).get('/api/calls').expect(200)).body as CallLogEntry[];
      expect(daveLog.map((e) => [e.call.id, e.direction, e.outcome])).toEqual([[ids.busy, 'outgoing', 'unanswered']]);
    });

    it('pages with limit and the before cursor', async () => {
      const first = (await t.api(alice).get('/api/calls?limit=3').expect(200)).body as CallLogEntry[];
      expect(first.map((e) => e.call.id)).toEqual([ids.live, ids.busy, ids.group]);
      const next = (await t.api(alice).get(`/api/calls?limit=3&before=${encodeURIComponent(first[2]!.call.createdAt)}`).expect(200)).body as CallLogEntry[];
      expect(next.map((e) => e.call.id)).toEqual([ids.unanswered, ids.cancelled, ids.declined]);
      const last = (await t.api(alice).get(`/api/calls?before=${encodeURIComponent(next[2]!.call.createdAt)}`).expect(200)).body as CallLogEntry[];
      expect(last.map((e) => e.call.id)).toEqual([ids.answered]);
      expect((await t.api(alice).get('/api/calls?before=').expect(200)).body).toHaveLength(7); // blank = absent
      expect((await t.api(alice).get('/api/calls?limit=0').expect(400)).body.error.code).toBe('validation_error');
      expect((await t.api(alice).get('/api/calls?before=yesterday').expect(400)).body.error.code).toBe('validation_error');
      await t.api().get('/api/calls').expect(401);
    });

    it('DELETE /calls/:callId hides one ended call from my log only; live → 409; unknown/foreign → 404', async () => {
      await t.api(alice).delete(`/api/calls/${ids.declined}`).expect(204);
      const log = (await t.api(alice).get('/api/calls').expect(200)).body as CallLogEntry[];
      expect(log.map((e) => e.call.id)).not.toContain(ids.declined);
      expect(((await t.api(bob).get('/api/calls').expect(200)).body as CallLogEntry[]).map((e) => e.call.id)).toContain(ids.declined);
      expect((await t.api(alice).delete(`/api/calls/${ids.declined}`).expect(404)).body.error.code).toBe('not_found');
      expect((await t.api(alice).delete(`/api/calls/${ids.live}`).expect(409)).body.error.code).toBe('conflict');
      await t.api(carol).delete(`/api/calls/${ids.answered}`).expect(404);
      await t.api(alice).delete(`/api/calls/${crypto.randomUUID()}`).expect(404);
      expect((await t.api(alice).delete('/api/calls/not-a-uuid').expect(400)).body.error.code).toBe('validation_error');
    });

    it('GET /calls/:callId returns my log entry (same serialization); hidden / not mine / unknown → 404', async () => {
      const log = (await t.api(alice).get('/api/calls').expect(200)).body as CallLogEntry[];
      expect(log.length).toBeGreaterThan(3);
      for (const entry of log) {
        expect((await t.api(alice).get(`/api/calls/${entry.call.id}`).expect(200)).body).toEqual(entry);
      }
      // Per viewer: direction/outcome and the chat pick are mine.
      expect((await t.api(bob).get(`/api/calls/${ids.answered}`).expect(200)).body).toMatchObject({
        direction: 'incoming',
        outcome: 'answered',
        chat: { id: ab, type: 'direct', peer: { id: alice.id } },
      });
      expect((await t.api(carol).get(`/api/calls/${ids.group}`).expect(200)).body).toMatchObject({ direction: 'outgoing', outcome: 'answered', chat: { name: 'Trio' } });
      expect((await t.api(alice).get(`/api/calls/${ids.live}`).expect(200)).body).toMatchObject({ outcome: 'ongoing', call: { status: 'ringing' } });
      // Removed from my log (the previous test hid `declined` for alice): 404 for me, still there for bob.
      expect((await t.api(alice).get(`/api/calls/${ids.declined}`).expect(404)).body.error.code).toBe('not_found');
      expect((await t.api(bob).get(`/api/calls/${ids.declined}`).expect(200)).body).toMatchObject({ direction: 'outgoing', outcome: 'declined' });
      // Not a participant (bob was not in dave's call), unknown, malformed, anonymous.
      await t.api(bob).get(`/api/calls/${ids.busy}`).expect(404);
      await t.api(dave).get(`/api/calls/${ids.group}`).expect(404);
      await t.api(alice).get(`/api/calls/${crypto.randomUUID()}`).expect(404);
      expect((await t.api(alice).get('/api/calls/not-a-uuid').expect(400)).body.error.code).toBe('validation_error');
      await t.api().get(`/api/calls/${ids.answered}`).expect(401);
      // The literal routes still win over the param route.
      expect(Array.isArray((await t.api(alice).get('/api/calls/active').expect(200)).body)).toBe(true);
      expect((await t.api(alice).get('/api/calls/ice-servers').expect(200)).body).toHaveProperty('iceServers');
    });

    it('GET /calls/:callId: a callee who blocked the caller (hidden participant) gets 404', async () => {
      const [eve, frank] = await Promise.all([t.createUser({ displayName: 'Eve' }), t.createUser({ displayName: 'Frank' })]);
      const chatId = await createDirect(frank, eve);
      await block(eve, frank);
      const f = await t.connect(frank);
      const call = await ackCall(f, 'call:start', { chatId, type: 'audio' });
      expect((await t.api(frank).get(`/api/calls/${call.id}`).expect(200)).body).toMatchObject({ direction: 'outgoing', call: { id: call.id } });
      await t.api(eve).get(`/api/calls/${call.id}`).expect(404);
      send(f, 'call:leave', { callId: call.id });
      await waitStatus(call.id, 'cancelled');
      await t.api(eve).get(`/api/calls/${call.id}`).expect(404);
      f.disconnect();
    });

    it('DELETE /calls clears my ended calls (live calls stay)', async () => {
      await t.api(bob).delete('/api/calls').expect(204);
      const log = (await t.api(bob).get('/api/calls').expect(200)).body as CallLogEntry[];
      expect(log.map((e) => e.call.id)).toEqual([ids.live]);
      expect(((await t.api(alice).get('/api/calls').expect(200)).body as CallLogEntry[]).length).toBeGreaterThan(1);
    });
  });

  describe('GET /calls/active', () => {
    it('lists live calls of my active chats (ringing me, or joinable), not ended ones nor former chats', async () => {
      const [alice, bob, carol, dave] = await Promise.all(['A', 'B', 'C', 'D'].map((n) => t.createUser({ displayName: n })));
      const ab = await createDirect(alice!, bob!);
      const group = await createGroup(carol!, [alice!, bob!, dave!]);
      const [a, , c] = await Promise.all([alice!, bob!, carol!].map((u) => t.connect(u)));
      const direct = await ackCall(a!, 'call:start', { chatId: ab, type: 'audio' });
      const grp = await ackCall(c!, 'call:start', { chatId: group, type: 'audio', userIds: [dave!.id] });

      const bobActive = (await t.api(bob!).get('/api/calls/active').expect(200)).body as Call[];
      expect(bobActive.map((x) => x.id)).toEqual([grp.id, direct.id]); // newest first; group joinable though not rung
      expect(bobActive[1]!.participants.map((p) => p.userId)).toContain(bob!.id);
      const aliceActive = (await t.api(alice!).get('/api/calls/active').expect(200)).body as Call[];
      expect(aliceActive.map((x) => x.id).sort()).toEqual([grp.id, direct.id].sort());
      expect(((await t.api(dave!).get('/api/calls/active').expect(200)).body as Call[]).map((x) => x.id)).toEqual([grp.id]);

      // Bob leaves the group: that call disappears from his list.
      await transact(async (tx, fx) => {
        await upsertMembership(tx, fx, { kind: 'deactivate', chatId: group, userId: bob!.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: bob!.id } });
      });
      expect(((await t.api(bob!).get('/api/calls/active').expect(200)).body as Call[]).map((x) => x.id)).toEqual([direct.id]);

      send(a!, 'call:leave', { callId: direct.id });
      send(c!, 'call:leave', { callId: grp.id });
      await waitStatus(direct.id, 'cancelled');
      await waitStatus(grp.id, 'cancelled');
      expect((await t.api(bob!).get('/api/calls/active').expect(200)).body).toEqual([]);
    });
  });

  describe('GET /calls/ice-servers', () => {
    const saved = { ...config.ice };
    afterEach(() => Object.assign(config.ice, saved));

    it('returns STUN servers by default', async () => {
      const u = await t.createUser();
      Object.assign(config.ice, { stunUrls: ['stun:stun.example.org:3478'], turnUrls: [], turnSecret: undefined, turnUsername: undefined, turnCredential: undefined, turnTtlSec: 600 });
      const res = await t.api(u).get('/api/calls/ice-servers').expect(200);
      expect(res.body).toEqual({ iceServers: [{ urls: ['stun:stun.example.org:3478'] }], ttlSec: 600 });
      expect(res.headers['cache-control']).toBe('no-store');
    });

    it('mints coturn REST credentials with TURN_SECRET (username = expiry:userId, HMAC-SHA1 base64)', async () => {
      const u = await t.createUser();
      Object.assign(config.ice, {
        stunUrls: ['stun:stun.example.org'],
        turnUrls: ['turn:turn.example.org:3478?transport=udp', 'turns:turn.example.org:5349'],
        turnSecret: 's3cr3t',
        turnTtlSec: 3600,
      });
      const before = Math.floor(Date.now() / 1000);
      const res = await t.api(u).get('/api/calls/ice-servers').expect(200);
      const after = Math.floor(Date.now() / 1000);
      expect(res.body.ttlSec).toBe(3600);
      const turn = res.body.iceServers[1];
      expect(turn.urls).toEqual(['turn:turn.example.org:3478?transport=udp', 'turns:turn.example.org:5349']);
      const [expiry, userId] = turn.username.split(':');
      expect(userId).toBe(u.id);
      expect(Number(expiry)).toBeGreaterThanOrEqual(before + 3600);
      expect(Number(expiry)).toBeLessThanOrEqual(after + 3600);
      expect(turn.credential).toBe(createHmac('sha1', 's3cr3t').update(turn.username).digest('base64'));
    });

    it('uses static TURN credentials when no secret is configured', async () => {
      const u = await t.createUser();
      Object.assign(config.ice, { stunUrls: [], turnUrls: ['turn:t.example.org'], turnSecret: undefined, turnUsername: 'user', turnCredential: 'pass' });
      const res = await t.api(u).get('/api/calls/ice-servers').expect(200);
      expect(res.body.iceServers).toEqual([{ urls: ['turn:t.example.org'], username: 'user', credential: 'pass' }]);
      await t.api().get('/api/calls/ice-servers').expect(401);
    });
  });

  it('rate-limits call:start per user (USER_RATE_LIMITS.callStart)', async () => {
    const u = await t.createUser();
    const s = await t.connect(u);
    const r = recordEvents(s);
    config.rateLimit = true;
    try {
      for (let i = 0; i < 10; i++) expect((await ackError(s, 'call:start', { chatId: crypto.randomUUID(), type: 'audio' })).code).toBe('not_found');
      expect((await ackError(s, 'call:start', { chatId: crypto.randomUUID(), type: 'audio' })).code).toBe('rate_limited');
    } finally {
      config.rateLimit = false;
      resetUserLimits();
    }
    expect(r.of('call:incoming')).toHaveLength(0);
  });
});
