/**
 * Calls: regression tests for review findings AUTHZ-5, CALLS-1, CALLS-2 / C1 / F4 (+ known
 * issue 2), CALLS-4 and CALLS-6 / R5.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { io as ioClient } from 'socket.io-client';
import { rooms } from '@enbox/shared';
import { sweepCalls } from '../../src/modules/calls/service.js';
import { boundSocketId, resetCallState, setCallTimings } from '../../src/modules/calls/state.js';
import { createSession } from '../../src/services/sessions.js';
import {
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';
import { createDirect, recordEvents, settle } from '../services/fixtures.js';
import { delayNextResult, delayNextTxResult, failNextTxQuery } from '../support/db-hooks.js';
import { ackCall, callRow, partOf, rawAck, send, until } from './helpers.js';

describe('calls: review regressions', () => {
  let t: TestServer;
  const extra: TestSocket[] = [];

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterEach(() => setCallTimings());
  afterAll(async () => {
    for (const s of extra) s.disconnect();
    resetCallState();
    await t.close();
  });

  const mkUsers = async (n: number): Promise<TestUser[]> => {
    const out: TestUser[] = [];
    for (let i = 0; i < n; i++) out.push(await t.createUser());
    return out;
  };

  /** Community owned by `owner` with `members` added by the owner. */
  async function community(owner: TestUser, members: TestUser[]) {
    const c = (await t.api(owner).post('/api/communities').send({ name: 'Comm' }).expect(201))
      .body as { id: string; announcementChatId: string };
    if (members.length)
      await t
        .api(owner)
        .post(`/api/communities/${c.id}/members`)
        .send({ userIds: members.map((m) => m.id) })
        .expect(200);
    return c;
  }

  async function ongoingPair() {
    const [a, b] = (await mkUsers(2)) as [TestUser, TestUser];
    const chatId = await createDirect(a, b);
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    const call = await ackCall(sa, 'call:start', { chatId, type: 'audio' });
    await ackCall(sb, 'call:accept', { callId: call.id });
    return { a, b, chatId, sa, sb, call };
  }

  // -------------------------------------------------------------------------
  // AUTHZ-5: call:invite needs canCall
  // -------------------------------------------------------------------------
  it('call:invite: a non-admin who joined an announcement-group call cannot ring other members (canCall)', async () => {
    const [owner, m1, m2, m3] = (await mkUsers(4)) as [TestUser, TestUser, TestUser, TestUser];
    const c = await community(owner, [m1, m2, m3]);
    const so = await t.connect(owner);
    const s2 = await t.connect(m2);
    const s3 = await t.connect(m3);
    const r3 = recordEvents(s3);
    const call = await ackCall(so, 'call:start', {
      chatId: c.announcementChatId,
      type: 'audio',
      userIds: [m1.id],
    });
    await ackCall(s2, 'call:join', { callId: call.id });
    const summary = (await t.api(m2).get(`/api/chats/${c.announcementChatId}`).expect(200))
      .body as { permissions: { canCall: boolean } };
    expect(summary.permissions.canCall).toBe(false);

    const res = await rawAck(s2, 'call:invite', { callId: call.id, userIds: [m3.id] });
    await settle(300);
    expect({
      ok: res.ok,
      code: res.ok ? null : res.error.code,
      rung: r3.of('call:incoming').map((p) => p.call.id),
    }).toEqual({ ok: false, code: 'forbidden', rung: [] });
    // An admin in the same call still may.
    await ackCall(so, 'call:invite', { callId: call.id, userIds: [m3.id] });
    await until(() => r3.of('call:incoming').length === 1, 3000, 'incoming on m3');
    [so, s2, s3].forEach((s) => s.disconnect());
  });

  // -------------------------------------------------------------------------
  // CALLS-1: call:leave honoured around the call socket's disconnect
  // -------------------------------------------------------------------------
  it('call:leave immediately followed by socket.disconnect() (logout) ends the call at once, not after the reconnect grace', async () => {
    setCallTimings({ reconnectGraceMs: 3000 });
    const { sa, sb, call } = await ongoingPair();
    const ended = waitForEvent(sa, 'call:ended', {
      timeoutMs: 1500,
      filter: (p) => p.callId === call.id,
    });
    send(sb, 'call:leave', { callId: call.id });
    sb.disconnect();
    const got = await ended.catch(() => null);
    expect(got?.status ?? null).toBe('ended');
    sa.disconnect();
  });

  it('the call socket disconnecting while its queued call:leave is in flight: the leave is still honoured', async () => {
    setCallTimings({ reconnectGraceMs: 3000 });
    const { sa, sb, call } = await ongoingPair();
    const bId = sb.id!;
    const ended = waitForEvent(sa, 'call:ended', {
      timeoutMs: 1500,
      filter: (p) => p.callId === call.id,
    });
    // The leave op is inside its transaction (lockCallCtx) when the transport closes.
    const d = delayNextTxResult(
      (text, params) => /^select "chat_id" from "calls"/.test(text) && params.includes(call.id),
    );
    send(sb, 'call:leave', { callId: call.id });
    await d.hit;
    sb.disconnect();
    await until(() => !t.io.of('/').sockets.has(bId), 3000, 'server-side disconnect');
    d.release();
    const got = await ended.catch(() => null);
    expect(got?.status ?? null).toBe('ended');
    sa.disconnect();
  });

  it('call:leave sent before the accept ack arrives is honoured after the accept (acked ok)', async () => {
    const [a, b] = (await mkUsers(2)) as [TestUser, TestUser];
    const chatId = await createDirect(a, b);
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    const call = await ackCall(sa, 'call:start', { chatId, type: 'audio' });
    const ended = waitForEvent(sa, 'call:ended', {
      timeoutMs: 3000,
      filter: (p) => p.callId === call.id,
    });
    const accept = rawAck(sb, 'call:accept', { callId: call.id });
    const leave = rawAck(sb, 'call:leave', { callId: call.id });
    expect((await accept).ok).toBe(true);
    expect((await leave).ok).toBe(true);
    expect((await ended).status).toBe('ended');
    expect((await partOf(call.id, b.id)).status).toBe('left');
    sa.disconnect();
    sb.disconnect();
  });

  it('call:leave from a socket that is not the call socket is still ignored', async () => {
    const { b, sa, sb, call } = await ongoingPair();
    const other = await t.connect(b); // b's second device (same session token, another socket)
    const res = await rawAck(other, 'call:leave', { callId: call.id });
    expect(res.ok).toBe(true);
    await settle(200);
    expect((await callRow(call.id)).status).toBe('ongoing');
    expect((await partOf(call.id, b.id)).status).toBe('joined');
    [sa, sb, other].forEach((s) => s.disconnect());
  });

  // -------------------------------------------------------------------------
  // CALLS-2 / C1 / F4 / known issue 2: deleting a community ends its announcement-group call
  // -------------------------------------------------------------------------
  it('deleting a community ends the live call of its announcement group: ring-stop, call:ended, sockets released, no ghost relay', async () => {
    const [o, m1, m2] = (await mkUsers(3)) as [TestUser, TestUser, TestUser];
    const c = await community(o, [m1, m2]);
    const so = await t.connect(o);
    const s1 = await t.connect(m1);
    const s2 = await t.connect(m2);
    const [ro, r1, r2] = [recordEvents(so), recordEvents(s1), recordEvents(s2)];

    const call = await ackCall(so, 'call:start', {
      chatId: c.announcementChatId,
      type: 'audio',
      userIds: [m1.id, m2.id],
    });
    await until(
      () => r1.of('call:incoming').length === 1 && r2.of('call:incoming').length === 1,
      3000,
      'incoming',
    );
    await ackCall(s1, 'call:accept', { callId: call.id });
    await settle(200);
    [ro, r1, r2].forEach((r) => r.clear());

    await t.api(o).delete(`/api/communities/${c.id}`).expect(204);
    await settle(300);
    send(so, 'call:signal', {
      callId: call.id,
      toUserId: m1.id,
      signal: { type: 'offer', sdp: 'v=0 ghost' },
    });
    await settle(300);

    expect({
      m2RingStopped: r2.of('call:ring-stop').map((p) => p.callId),
      ownerEnded: ro.of('call:ended').map((p) => [p.callId, p.status]),
      m1Ended: r1.of('call:ended').map((p) => p.callId),
      ghostSignalsToM1: r1.of('call:signal').length,
      ownerStillBound: boundSocketId(call.id, o.id) ?? null,
      m1StillBound: boundSocketId(call.id, m1.id) ?? null,
      callRoom: [...(t.io.of('/').adapter.rooms.get(rooms.call(call.id)) ?? [])],
    }).toEqual({
      m2RingStopped: [call.id],
      ownerEnded: [[call.id, 'ended']],
      m1Ended: [call.id],
      ghostSignalsToM1: 0,
      ownerStillBound: null,
      m1StillBound: null,
      callRoom: [],
    });
    // call:ended precedes chat:removed of the announcement group.
    const names = ro.names().filter((n) => n === 'call:ended' || n === 'chat:removed');
    expect(names).toEqual(['call:ended', 'chat:removed']);
    // Both are free for a new call right away.
    const d = await createDirect(o, m1);
    await ackCall(so, 'call:start', { chatId: d, type: 'audio' });
    [so, s1, s2].forEach((s) => s.disconnect());
  });

  it('deleting a community while its announcement-group call is still ringing: cancelled, the caller gets call:ended, the callee a ring-stop', async () => {
    const [owner, member] = (await mkUsers(2)) as [TestUser, TestUser];
    const c = await community(owner, [member]);
    const so = await t.connect(owner);
    const sm = await t.connect(member);
    const incoming = waitForEvent(sm, 'call:incoming');
    const call = await ackCall(so, 'call:start', { chatId: c.announcementChatId, type: 'audio' });
    await incoming;
    const ownerEnded = waitForEvent(so, 'call:ended', {
      timeoutMs: 1500,
      filter: (p) => p.callId === call.id,
    });
    const memberStopped = waitForEvent(sm, 'call:ring-stop', {
      timeoutMs: 1500,
      filter: (p) => p.callId === call.id,
    });
    await t.api(owner).delete(`/api/communities/${c.id}`).expect(204);
    expect(await callRow(call.id)).toBeUndefined(); // cascaded away with the chat
    expect((await ownerEnded).status).toBe('cancelled');
    expect((await memberStopped).reason).toBe('cancelled');
    so.disconnect();
    sm.disconnect();
  });

  // -------------------------------------------------------------------------
  // CALLS-4: late-device re-emit vs an answer elsewhere
  // -------------------------------------------------------------------------
  it('a device connecting while the call is answered elsewhere never gets call:incoming after its ring-stop', async () => {
    const [a, u] = (await mkUsers(2)) as [TestUser, TestUser];
    const chatId = await createDirect(a, u);
    const sa = await t.connect(a);
    const d1 = await t.connect(u);
    const r1 = recordEvents(d1);
    const call = await ackCall(sa, 'call:start', { chatId, type: 'audio' });
    await until(() => r1.of('call:incoming').length === 1, 3000, 'incoming on d1');

    // D2's late-device re-emit found the call ringing U, but that response is still in
    // flight while D1 answers. (The re-emit re-checks the call inside the call's queue.)
    const d = delayNextResult(
      (text, params) =>
        /^select "call_participants"\."call_id" from "call_participants" inner join "calls"/.test(
          text,
        ) && params.includes(u.id),
    );
    const { token } = await createSession({ userId: u.id, deviceName: 'd2' });
    const d2 = ioClient(t.url, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    }) as TestSocket;
    extra.push(d2);
    const r2 = recordEvents(d2);
    await d.hit;
    await ackCall(d1, 'call:accept', { callId: call.id });
    await until(
      () => r2.of('call:ring-stop').some((p) => p.callId === call.id),
      3000,
      'ring-stop on d2',
    );
    d.release();
    await settle(400);

    const seq = r2.log
      .filter(
        (e) =>
          (e.event === 'call:incoming' && e.payload.call.id === call.id) ||
          (e.event === 'call:ring-stop' && e.payload.callId === call.id),
      )
      .map((e) => e.event);
    expect(seq.at(-1)).toBe('call:ring-stop');
    [sa, d1, d2].forEach((s) => s.disconnect());
  });

  it('a late device still gets call:incoming for a call that keeps ringing it', async () => {
    const [a, u] = (await mkUsers(2)) as [TestUser, TestUser];
    const chatId = await createDirect(a, u);
    const sa = await t.connect(a);
    const call = await ackCall(sa, 'call:start', { chatId, type: 'video' });
    const { token } = await createSession({ userId: u.id, deviceName: 'late' });
    const late = ioClient(t.url, {
      auth: { token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    }) as TestSocket;
    extra.push(late);
    const got = await waitForEvent(late, 'call:incoming', { filter: (p) => p.call.id === call.id });
    expect(got.call.status).toBe('ringing');
    [sa, late].forEach((s) => s.disconnect());
  });

  // -------------------------------------------------------------------------
  // CALLS-6 / R5: lost disconnect bookkeeping
  // -------------------------------------------------------------------------
  it('after a failed disconnect transaction the sweep still expires the lost participant', async () => {
    setCallTimings({ reconnectGraceMs: 200 });
    const { b, sa, sb, call } = await ongoingPair();
    const inj = failNextTxQuery((text) =>
      /^update "call_participants" set "disconnected_at" = \$1 where/.test(text),
    );
    try {
      sb.disconnect();
      await until(() => inj.failed(), 3000, 'injected failure');
    } finally {
      inj.restore();
    }
    await settle(100);
    const lost = await partOf(call.id, b.id);
    expect({ status: lost.status, disconnectedAt: lost.disconnectedAt }).toEqual({
      status: 'joined',
      disconnectedAt: null,
    });

    await sweepCalls(); // the calls job's periodic run: the lost participant enters the grace
    await until(
      async () => (await partOf(call.id, b.id)).disconnectedAt !== null,
      3000,
      'grace started',
    );
    await settle(400); // > grace
    await sweepCalls();
    await until(async () => (await callRow(call.id)).status === 'ended', 3000, 'call ended');
    expect((await partOf(call.id, b.id)).status).toBe('left');
    sa.disconnect();
  });

  it('the sweep leaves participants whose call socket is bound alone', async () => {
    const { a, b, sa, sb, call } = await ongoingPair();
    await sweepCalls();
    await settle(100);
    expect((await partOf(call.id, a.id)).disconnectedAt).toBeNull();
    expect((await partOf(call.id, b.id)).disconnectedAt).toBeNull();
    expect((await callRow(call.id)).status).toBe('ongoing');
    sa.disconnect();
    sb.disconnect();
  });
});
