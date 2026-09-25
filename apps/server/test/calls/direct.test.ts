import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { io as ioClient } from 'socket.io-client';
import type { ServerToClientEvents } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { chatMembers, messageHidden, messages, sessions, users } from '../../src/db/schema.js';
import { resetCallState, setCallTimings } from '../../src/modules/calls/state.js';
import { domainEvents, type DomainEventMap } from '../../src/services/events.js';
import {
  expectNoEvent,
  sleep,
  startTestServer,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';
import {
  block,
  createDirect,
  recordEvents,
  saveContact,
  setSettings,
  settle,
} from '../services/fixtures.js';
import { ackCall, ackError, callRow, device, partOf, send, statusOf, until } from './helpers.js';

describe('calls: 1:1 signaling', () => {
  let t: TestServer;
  const extraSockets: TestSocket[] = [];
  const domain: { event: keyof DomainEventMap; payload: any }[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any

  beforeAll(async () => {
    t = await startTestServer();
    for (const event of ['call.ringing', 'call.ring-stopped', 'call.ended'] as const) {
      domainEvents.on(event, (payload) => void domain.push({ event, payload }));
    }
  });
  afterEach(() => setCallTimings());
  afterAll(async () => {
    for (const s of extraSockets) s.disconnect();
    resetCallState();
    await t.close();
  });

  async function pair() {
    const alice = await t.createUser({ displayName: 'Alice' });
    const bob = await t.createUser({ displayName: 'Bob' });
    const chatId = await createDirect(alice, bob);
    return { alice, bob, chatId };
  }

  /** Connect with a recorder attached BEFORE the connection (catches events right after `ready`). */
  async function connectRecording(user: TestUser) {
    const socket = ioClient(t.url, {
      auth: { token: user.token },
      transports: ['websocket'],
      forceNew: true,
      reconnection: false,
    }) as TestSocket;
    extraSockets.push(socket);
    const rec = recordEvents(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('ready', () => resolve());
      socket.once('connect_error', reject);
    });
    return { socket, rec };
  }

  const domainOf = (callId: string) => domain.filter((d) => d.payload.callId === callId);

  it('rings every callee device, answers on one, relays signals only between call sockets and ends with a duration', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const { socket: a2 } = await device(t, alice);
    const b1 = await t.connect(bob);
    const { socket: b2 } = await device(t, bob);
    const [ra1, ra2, rb1, rb2] = [a1, a2, b1, b2].map(recordEvents);

    const call = await ackCall(a1, 'call:start', { chatId, type: 'video' });
    expect(call).toMatchObject({
      chatId,
      type: 'video',
      isGroup: false,
      initiatorId: alice.id,
      status: 'ringing',
      answeredAt: null,
      endedAt: null,
      durationSec: null,
    });
    expect(call.participants).toEqual([
      expect.objectContaining({
        userId: alice.id,
        status: 'joined',
        audioMuted: false,
        videoOff: false,
        screenSharing: false,
      }),
      expect.objectContaining({ userId: bob.id, status: 'invited', joinedAt: null, leftAt: null }),
    ]);

    // Every device of Bob: the (hidden) chat becomes visible, then the call message, then the ring.
    for (const r of [rb1, rb2]) {
      await until(() => r.of('call:incoming').length === 1, 3000, 'call:incoming');
      const names = r.names();
      expect(names.indexOf('chat:upsert')).toBeGreaterThanOrEqual(0);
      expect(names.indexOf('chat:upsert')).toBeLessThan(names.indexOf('message:new'));
      expect(names.indexOf('message:new')).toBeLessThan(names.indexOf('call:incoming'));
      const inc = r.of('call:incoming')[0]!;
      expect(inc.call).toEqual(call);
      expect(inc.silent).toBe(false);
      expect(inc.caller).toMatchObject({ id: alice.id, displayName: 'Alice' });
      expect(inc.chat).toMatchObject({
        id: chatId,
        type: 'direct',
        name: null,
        avatarUrl: null,
        memberCount: 2,
      });
      expect(inc.chat.peer?.id).toBe(alice.id);
      expect(r.of('message:new')[0]!.message).toMatchObject({
        type: 'call',
        senderId: alice.id,
        call: {
          callId: call.id,
          callType: 'video',
          isGroup: false,
          initiatorId: alice.id,
          status: 'ringing',
          durationSec: null,
        },
      });
    }
    // Alice's other device learns about the outgoing call; nobody else rings.
    await until(() => ra2.of('call:updated').length === 1, 3000, 'call:updated on a2');
    expect(ra2.of('call:incoming')).toHaveLength(0);
    expect(ra1.of('call:incoming')).toHaveLength(0);
    const ringing = domainOf(call.id).find((d) => d.event === 'call.ringing')!;
    expect(ringing.payload).toMatchObject({
      chatId,
      callerId: alice.id,
      callType: 'video',
      isGroup: false,
      userIds: [bob.id],
      silentUserIds: [],
    });

    // A device of Bob rings → Alice sees "Ringing".
    send(b1, 'call:ringing', { callId: call.id });
    await until(
      () => ra1.of('call:updated').some((p) => statusOf(p.call, bob.id) === 'ringing'),
      3000,
      'ringing',
    );
    expect((await partOf(call.id, bob.id)).status).toBe('ringing');

    // Bob answers on his second device.
    for (const r of [ra1, ra2, rb1, rb2]) r.clear();
    const accepted = await ackCall(b2, 'call:accept', { callId: call.id, audioMuted: true });
    expect(accepted.status).toBe('ongoing');
    expect(accepted.answeredAt).not.toBeNull();
    expect(accepted.participants.find((p) => p.userId === bob.id)).toMatchObject({
      status: 'joined',
      audioMuted: true,
      videoOff: false,
    });
    await until(() => rb1.of('call:ring-stop').length === 1, 3000, 'ring-stop');
    expect(rb1.of('call:ring-stop')[0]).toEqual({ callId: call.id, reason: 'answered_elsewhere' });
    await until(() => ra1.of('message:updated').length === 1, 3000, 'message:updated');
    expect(ra1.names().filter((n) => n.startsWith('call:') || n === 'message:updated')).toEqual([
      'call:participant-joined',
      'call:updated',
      'message:updated',
    ]);
    expect(ra1.of('call:participant-joined')[0]).toEqual({ callId: call.id, userId: bob.id });
    expect(ra1.of('call:updated')[0]!.call.status).toBe('ongoing');
    expect(ra1.of('message:updated')[0]!.message.call).toMatchObject({
      status: 'ongoing',
      durationSec: null,
    });
    await settle();
    // participant-joined goes to call sockets only (and never to the newcomer itself).
    expect(ra2.of('call:participant-joined')).toHaveLength(0);
    expect(rb1.of('call:participant-joined')).toHaveLength(0);
    expect(rb2.of('call:participant-joined')).toHaveLength(0);
    expect(ra2.of('call:updated').at(-1)!.call.status).toBe('ongoing');
    const stopped = domainOf(call.id).find((d) => d.event === 'call.ring-stopped')!;
    expect(stopped.payload).toMatchObject({
      userId: bob.id,
      reason: 'answered_elsewhere',
      finalStatus: 'joined',
    });
    expect((await partOf(call.id, bob.id)).sessionId).not.toBe(bob.sessionId); // the second device's session

    // Signals: relayed to the target's call socket only, and only from call sockets.
    for (const r of [ra1, ra2, rb1, rb2]) r.clear();
    send(b2, 'call:signal', {
      callId: call.id,
      toUserId: alice.id,
      signal: { type: 'offer', sdp: 'v=0 offer' },
    });
    await until(() => ra1.of('call:signal').length === 1, 3000, 'offer');
    expect(ra1.of('call:signal')[0]).toEqual({
      callId: call.id,
      fromUserId: bob.id,
      signal: { type: 'offer', sdp: 'v=0 offer' },
    });
    send(a1, 'call:signal', {
      callId: call.id,
      toUserId: bob.id,
      signal: { type: 'answer', sdp: 'v=0 answer' },
    });
    send(a1, 'call:signal', {
      callId: call.id,
      toUserId: bob.id,
      signal: {
        type: 'candidate',
        candidate: {
          candidate: 'candidate:1 1 udp 1 1.2.3.4 5 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      },
    });
    await until(() => rb2.of('call:signal').length === 2, 3000, 'answer + candidate');
    expect(rb2.of('call:signal').map((s) => s.signal.type)).toEqual(['answer', 'candidate']);
    send(b1, 'call:signal', {
      callId: call.id,
      toUserId: alice.id,
      signal: { type: 'offer', sdp: 'intruder' },
    });
    send(a2, 'call:signal', {
      callId: call.id,
      toUserId: bob.id,
      signal: { type: 'offer', sdp: 'intruder' },
    });
    send(a1, 'call:signal', {
      callId: call.id,
      toUserId: alice.id,
      signal: { type: 'offer', sdp: 'self' },
    });
    await settle(250);
    expect(ra1.of('call:signal')).toHaveLength(1);
    expect(rb2.of('call:signal')).toHaveLength(2);
    expect(ra2.of('call:signal')).toHaveLength(0);
    expect(rb1.of('call:signal')).toHaveLength(0);

    // Media state: persisted and broadcast to the call room; only from the call socket.
    send(b2, 'call:media', {
      callId: call.id,
      audioMuted: false,
      videoOff: true,
      screenSharing: true,
    });
    await until(() => ra1.of('call:media').length === 1, 3000, 'call:media');
    expect(ra1.of('call:media')[0]).toEqual({
      callId: call.id,
      audioMuted: false,
      videoOff: true,
      screenSharing: true,
      userId: bob.id,
    });
    await until(() => rb2.of('call:media').length === 1, 3000, 'call:media echo');
    expect(await partOf(call.id, bob.id)).toMatchObject({
      audioMuted: false,
      videoOff: true,
      screenSharing: true,
    });
    send(b1, 'call:media', {
      callId: call.id,
      audioMuted: true,
      videoOff: true,
      screenSharing: false,
    });
    await settle(200);
    expect(ra1.of('call:media')).toHaveLength(1);
    expect(ra2.of('call:media')).toHaveLength(0);

    // Alice hangs up: 1:1 ends for everyone, with a duration on the call and its message.
    await sleep(50);
    for (const r of [ra1, ra2, rb1, rb2]) r.clear();
    send(a1, 'call:leave', { callId: call.id });
    await until(
      () => [ra2, rb1, rb2].every((r) => r.of('call:ended').length === 1),
      3000,
      'call:ended',
    );
    const ended = rb2.of('call:ended')[0]!;
    expect(ended).toMatchObject({ callId: call.id, status: 'ended' });
    expect(ended.call.durationSec).toEqual(expect.any(Number));
    expect(ended.call.endedAt).not.toBeNull();
    expect(ended.call.participants.map((p) => p.status)).toEqual(['left', 'left']);
    expect(rb2.of('call:participant-left')).toEqual([{ callId: call.id, userId: alice.id }]);
    expect(rb2.names().indexOf('call:participant-left')).toBeLessThan(
      rb2.names().indexOf('call:ended'),
    );
    await until(() => rb1.of('message:updated').length === 1, 3000, 'final message:updated');
    expect(rb1.of('message:updated')[0]!.message.call).toEqual({
      callId: call.id,
      callType: 'video',
      isGroup: false,
      initiatorId: alice.id,
      status: 'ended',
      durationSec: ended.call.durationSec,
    });
    expect(domainOf(call.id).find((d) => d.event === 'call.ended')!.payload).toMatchObject({
      status: 'ended',
      participantIds: expect.arrayContaining([alice.id, bob.id]),
    });
    const row = await callRow(call.id);
    expect(row.status).toBe('ended');
    expect(row.endedAt).not.toBeNull();

    // The call rooms were left: nothing is relayed any more.
    send(b2, 'call:signal', {
      callId: call.id,
      toUserId: alice.id,
      signal: { type: 'offer', sdp: 'late' },
    });
    await expectNoEvent(a1, 'call:signal', 200);
    // And the call can't be answered again.
    expect((await ackError(b1, 'call:accept', { callId: call.id })).code).toBe('expired');
  });

  it('declining on one device stops every device and ends a 1:1 call as declined', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const { socket: b2 } = await device(t, bob);
    const [ra1, rb1, rb2] = [a1, b1, b2].map(recordEvents);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    expect(call.participants[0]).toMatchObject({
      userId: alice.id,
      audioMuted: false,
      videoOff: true,
    }); // audio: video off by default
    await until(
      () => rb1.of('call:incoming').length === 1 && rb2.of('call:incoming').length === 1,
      3000,
      'incoming',
    );

    send(b2, 'call:decline', { callId: call.id });
    await until(() => ra1.of('call:ended').length === 1, 3000, 'call:ended');
    expect(ra1.of('call:ended')[0]).toMatchObject({ callId: call.id, status: 'declined' });
    expect(statusOf(ra1.of('call:ended')[0]!.call, bob.id)).toBe('declined');
    for (const r of [rb1, rb2]) {
      await until(() => r.of('call:ended').length === 1, 3000, 'call:ended bob');
      expect(r.of('call:ring-stop')).toEqual([{ callId: call.id, reason: 'declined_elsewhere' }]);
      expect(r.names().indexOf('call:ring-stop')).toBeLessThan(r.names().indexOf('call:ended'));
    }
    await until(() => ra1.of('message:updated').length === 1, 3000, 'message:updated');
    expect(ra1.of('message:updated')[0]!.message.call).toMatchObject({
      status: 'declined',
      durationSec: null,
    });
    expect((await callRow(call.id)).status).toBe('declined');
    // A second decline (other device) is a no-op.
    send(b1, 'call:decline', { callId: call.id });
    await expectNoEvent(a1, 'call:updated', 200);
  });

  it('the caller hanging up while ringing cancels the call and stops the ring', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const rb1 = recordEvents(b1);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await until(() => rb1.of('call:incoming').length === 1, 3000, 'incoming');
    send(a1, 'call:leave', { callId: call.id });
    await until(() => rb1.of('call:ended').length === 1, 3000, 'call:ended');
    expect(rb1.of('call:ring-stop')).toEqual([{ callId: call.id, reason: 'cancelled' }]);
    expect(rb1.of('call:ended')[0]).toMatchObject({ status: 'cancelled' });
    expect(statusOf(rb1.of('call:ended')[0]!.call, bob.id)).toBe('missed');
    expect(domainOf(call.id).find((d) => d.event === 'call.ring-stopped')!.payload).toMatchObject({
      userId: bob.id,
      reason: 'cancelled',
      finalStatus: 'missed',
    });
    const msg = await db
      .select()
      .from(messages)
      .where(eq(messages.id, (await callRow(call.id)).messageId!));
    expect(msg[0]!.metadata.call).toMatchObject({ status: 'cancelled' });
  });

  it('ring timeout: the callee becomes missed and the call ends missed (with ring-stop + domain events)', async () => {
    setCallTimings({ ringTimeoutMs: 300 });
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const [ra1, rb1] = [a1, b1].map(recordEvents);
    const started = Date.now();
    const call = await ackCall(a1, 'call:start', { chatId, type: 'video' });
    await until(() => ra1.of('call:ended').length === 1, 3000, 'call:ended');
    expect(Date.now() - started).toBeGreaterThanOrEqual(280);
    expect(ra1.of('call:ended')[0]).toMatchObject({ status: 'missed' });
    await until(() => rb1.of('call:ended').length === 1, 3000, 'bob call:ended');
    expect(rb1.of('call:ring-stop')).toEqual([{ callId: call.id, reason: 'timeout' }]);
    expect((await partOf(call.id, bob.id)).status).toBe('missed');
    expect((await partOf(call.id, alice.id)).status).toBe('left');
    const events = domainOf(call.id).map((d) => d.event);
    expect(events).toEqual(['call.ringing', 'call.ring-stopped', 'call.ended']);
    expect(domainOf(call.id)[1]!.payload).toMatchObject({
      reason: 'timeout',
      finalStatus: 'missed',
    });
    expect(domainOf(call.id)[2]!.payload).toMatchObject({ status: 'missed' });
  });

  it('busy callees are not rung; a joined user cannot start or answer another call', async () => {
    const alice = await t.createUser();
    const bob = await t.createUser();
    const carol = await t.createUser();
    const ab = await createDirect(alice, bob);
    const cb = await createDirect(carol, bob);
    const ca = await createDirect(carol, alice);
    await db.update(chatMembers).set({ hidden: false }).where(eq(chatMembers.chatId, ca)); // both see it
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const c1 = await t.connect(carol);
    const rb1 = recordEvents(b1);

    const first = await ackCall(c1, 'call:start', { chatId: cb, type: 'audio' });
    await until(() => rb1.of('call:incoming').length === 1, 3000, 'incoming');
    await ackCall(b1, 'call:accept', { callId: first.id });
    rb1.clear();

    // Alice calls busy Bob: the invitee is `busy`, never rung, and the call ends missed at once.
    const second = await ackCall(a1, 'call:start', { chatId: ab, type: 'audio' });
    expect(second.status).toBe('missed');
    expect(statusOf(second, bob.id)).toBe('busy');
    await settle(250);
    expect(rb1.of('call:incoming')).toHaveLength(0);
    expect(rb1.of('call:ring-stop')).toHaveLength(0);
    expect(rb1.of('call:ended').map((e) => e.callId)).toEqual([second.id]); // it lands in Bob's log
    expect(domainOf(second.id).map((d) => d.event)).toEqual(['call.ended']);

    // Bob (in a call) can't start another one; Carol can't either.
    const busy = await ackError(b1, 'call:start', { chatId: ab, type: 'audio' });
    expect(busy.code).toBe('conflict');
    expect(busy.details).toBeUndefined();
    expect((await ackError(c1, 'call:start', { chatId: ca, type: 'audio' })).code).toBe('conflict');

    // Carol (joined elsewhere) is busy for Alice's call too.
    const third = await ackCall(a1, 'call:start', { chatId: ca, type: 'audio' });
    expect(statusOf(third, carol.id)).toBe('busy');
    send(c1, 'call:leave', { callId: first.id });
    await until(async () => (await callRow(first.id)).status === 'ended', 3000, 'first ended');
  });

  it('cross-calls: a second call:start in the chat → conflict with details.callId, then accept it', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    const err = await ackError(b1, 'call:start', { chatId, type: 'video' });
    expect(err).toMatchObject({ code: 'conflict', details: { callId: call.id } });
    // The caller themself gets the same conflict (the live call is theirs).
    expect(await ackError(a1, 'call:start', { chatId, type: 'audio' })).toMatchObject({
      code: 'conflict',
      details: { callId: call.id },
    });
    const accepted = await ackCall(b1, 'call:accept', { callId: call.id });
    expect(accepted.status).toBe('ongoing');
    // Accepting twice (same socket) is idempotent; from another device it conflicts.
    expect((await ackCall(b1, 'call:accept', { callId: call.id })).status).toBe('ongoing');
    const { socket: b2 } = await device(t, bob);
    expect((await ackError(b2, 'call:join', { callId: call.id })).code).toBe('conflict');
    send(b1, 'call:leave', { callId: call.id });
    await until(async () => (await callRow(call.id)).status === 'ended', 3000, 'ended');
  });

  it('call:rejoin within the grace (other session) re-binds the call socket; peers get participant-joined', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const ra1 = recordEvents(a1);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await ackCall(b1, 'call:accept', { callId: call.id });
    const { user: bob2, socket: b2 } = await device(t, bob);
    const rb2 = recordEvents(b2);

    // While b1 is connected another device can't take the call over.
    expect((await ackError(b2, 'call:rejoin', { callId: call.id })).code).toBe('conflict');

    // The call socket disconnects: nothing is emitted, disconnected_at is set.
    ra1.clear();
    b1.disconnect();
    await until(
      async () => (await partOf(call.id, bob.id)).disconnectedAt !== null,
      3000,
      'disconnected_at',
    );
    await settle(200);
    expect(ra1.names().filter((n) => n.startsWith('call:'))).toEqual([]);

    const rejoined = await ackCall(b2, 'call:rejoin', { callId: call.id, videoOff: false });
    expect(rejoined.status).toBe('ongoing');
    expect(rejoined.participants.find((p) => p.userId === bob.id)).toMatchObject({
      status: 'joined',
      videoOff: false,
    });
    await until(() => ra1.of('call:participant-joined').length === 1, 3000, 'participant-joined');
    expect(ra1.of('call:participant-joined')[0]).toEqual({ callId: call.id, userId: bob.id });
    const row = await partOf(call.id, bob.id);
    expect(row.disconnectedAt).toBeNull();
    expect(row.sessionId).toBe(bob2.sessionId);

    // Signals now reach the new call socket.
    send(a1, 'call:signal', {
      callId: call.id,
      toUserId: bob.id,
      signal: { type: 'offer', sdp: 'renegotiate' },
    });
    await until(() => rb2.of('call:signal').length === 1, 3000, 'signal to new socket');
    send(b2, 'call:leave', { callId: call.id });
    await until(() => ra1.of('call:ended').length === 1, 3000, 'ended');
  });

  it('call:rejoin from the same session is refused (409) while the call socket is still connected — a second tab cannot steal the call', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const ra1 = recordEvents(a1);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await ackCall(b1, 'call:accept', { callId: call.id });
    const b1bis = await t.connect(bob); // same token → same session (second tab)
    const [rb1, rb1bis] = [b1, b1bis].map(recordEvents);
    ra1.clear();

    const err = await ackError(b1bis, 'call:rejoin', { callId: call.id, videoOff: false });
    expect(err.code).toBe('conflict');
    // Nothing changed: no newcomer, the call socket and its media state stay with the first tab.
    await settle(150);
    expect(ra1.of('call:participant-joined')).toHaveLength(0);
    expect(ra1.of('call:updated')).toHaveLength(0);
    expect(await partOf(call.id, bob.id)).toMatchObject({
      status: 'joined',
      sessionId: bob.sessionId,
      disconnectedAt: null,
      videoOff: true,
    });
    send(a1, 'call:signal', {
      callId: call.id,
      toUserId: bob.id,
      signal: { type: 'offer', sdp: 'x' },
    });
    await until(() => rb1.of('call:signal').length === 1, 3000, 'signal to the call socket');
    expect(rb1bis.of('call:signal')).toHaveLength(0);
    // The call socket itself may re-send call:rejoin (idempotent, nothing emitted).
    expect((await ackCall(b1, 'call:rejoin', { callId: call.id })).status).toBe('ongoing');
    await settle(100);
    expect(ra1.of('call:participant-joined')).toHaveLength(0);

    send(b1, 'call:leave', { callId: call.id });
    await until(async () => (await callRow(call.id)).status === 'ended', 3000, 'ended');
  });

  it('call:rejoin from the same session is allowed once the call socket is gone (within the grace)', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const ra1 = recordEvents(a1);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await ackCall(b1, 'call:accept', { callId: call.id });
    const b1bis = await t.connect(bob); // same session: e.g. the reloaded page
    const rb1bis = recordEvents(b1bis);
    expect((await ackError(b1bis, 'call:rejoin', { callId: call.id })).code).toBe('conflict');

    ra1.clear();
    b1.disconnect();
    await until(
      async () => (await partOf(call.id, bob.id)).disconnectedAt !== null,
      3000,
      'disconnected_at',
    );
    const rejoined = await ackCall(b1bis, 'call:rejoin', { callId: call.id, videoOff: false });
    expect(rejoined.participants.find((p) => p.userId === bob.id)).toMatchObject({
      status: 'joined',
      videoOff: false,
    });
    await until(() => ra1.of('call:participant-joined').length === 1, 3000, 'participant-joined');
    expect(ra1.of('call:participant-joined')[0]).toEqual({ callId: call.id, userId: bob.id });
    expect(await partOf(call.id, bob.id)).toMatchObject({
      disconnectedAt: null,
      sessionId: bob.sessionId,
    });
    send(a1, 'call:signal', {
      callId: call.id,
      toUserId: bob.id,
      signal: { type: 'offer', sdp: 'x' },
    });
    await until(() => rb1bis.of('call:signal').length === 1, 3000, 'signal to the new call socket');
    // The new call socket holds it now: a third tab of the same session is refused in turn.
    const b1ter = await t.connect(bob);
    expect((await ackError(b1ter, 'call:rejoin', { callId: call.id })).code).toBe('conflict');
    await settle(150);
    expect((await callRow(call.id)).status).toBe('ongoing');
    send(b1bis, 'call:leave', { callId: call.id });
    await until(async () => (await callRow(call.id)).status === 'ended', 3000, 'ended');
  });

  it('reconnect grace expiry → participant left → 1:1 ends; a late rejoin is refused', async () => {
    setCallTimings({ reconnectGraceMs: 300 });
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const { socket: b1 } = await device(t, bob);
    const ra1 = recordEvents(a1);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await ackCall(b1, 'call:accept', { callId: call.id });
    ra1.clear();
    const lostAt = Date.now();
    b1.disconnect();
    await until(() => ra1.of('call:ended').length === 1, 3000, 'call:ended');
    expect(Date.now() - lostAt).toBeGreaterThanOrEqual(280);
    expect(ra1.of('call:participant-left')).toEqual([{ callId: call.id, userId: bob.id }]);
    expect(ra1.of('call:ended')[0]).toMatchObject({ status: 'ended' });
    const b3 = await t.connect(bob);
    expect((await ackError(b3, 'call:rejoin', { callId: call.id })).code).toBe('expired');
  });

  it('a revoked session holding the call socket leaves at once (no grace)', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const { user: bob2, socket: b2 } = await device(t, bob);
    const ra1 = recordEvents(a1);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await ackCall(b2, 'call:accept', { callId: call.id });
    // Revocation: the session row is deleted (FK nulls session_id), then its sockets are dropped.
    await db.delete(sessions).where(eq(sessions.id, bob2.sessionId));
    b2.disconnect();
    await until(() => ra1.of('call:ended').length === 1, 2000, 'call:ended');
    expect(ra1.of('call:participant-left')).toEqual([{ callId: call.id, userId: bob.id }]);
  });

  it('late devices get call:incoming after ready while still ringing (not once answered, never when hidden)', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'video' });
    const late = await connectRecording(bob);
    await until(() => late.rec.of('call:incoming').length === 1, 3000, 'late call:incoming');
    const names = late.rec.names();
    expect(names.indexOf('ready')).toBeLessThan(names.indexOf('call:incoming'));
    expect(late.rec.of('call:incoming')[0]).toMatchObject({
      call: { id: call.id, status: 'ringing' },
      silent: false,
      caller: { id: alice.id },
    });
    await ackCall(late.socket, 'call:accept', { callId: call.id });
    const later = await connectRecording(bob);
    await settle(250);
    expect(later.rec.of('call:incoming')).toHaveLength(0);
    send(late.socket, 'call:leave', { callId: call.id });
    await until(async () => (await callRow(call.id)).status === 'ended', 3000, 'ended');
  });

  it('blocked callee: hidden participant, never rung or notified; the call ends missed at the timeout', async () => {
    setCallTimings({ ringTimeoutMs: 400 });
    const { alice, bob, chatId } = await pair();
    await block(bob, alice);
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const late = await connectRecording(bob);
    const [ra1, rb1] = [a1, b1].map(recordEvents);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    // The caller sees a normal outgoing call.
    expect(statusOf(call, bob.id)).toBe('invited');
    const active = await t.api(alice).get('/api/calls/active').expect(200);
    expect(active.body.map((c: { id: string }) => c.id)).toEqual([call.id]);
    expect((await t.api(bob).get('/api/calls/active').expect(200)).body).toEqual([]);
    // Bob can't see or act on it.
    expect((await ackError(b1, 'call:accept', { callId: call.id })).code).toBe('not_found');
    expect((await ackError(b1, 'call:rejoin', { callId: call.id })).code).toBe('not_found');
    send(b1, 'call:decline', { callId: call.id });
    send(b1, 'call:ringing', { callId: call.id });

    await until(() => ra1.of('call:ended').length === 1, 3000, 'missed');
    expect(ra1.of('call:ended')[0]).toMatchObject({ status: 'missed' });
    expect(statusOf(ra1.of('call:ended')[0]!.call, bob.id)).toBe('missed');
    await settle(200);
    // (chat:watermarks is the shared send path's tick bookkeeping, not call data.)
    expect(rb1.names().filter((n) => n !== 'chat:watermarks')).toEqual([]);
    expect(late.rec.names().filter((n) => n !== 'chat:watermarks')).toEqual(['ready']);
    // The call message is withheld from Bob and his chat row stays hidden.
    const row = await callRow(call.id);
    const [hidden] = await db
      .select()
      .from(messageHidden)
      .where(and(eq(messageHidden.userId, bob.id), eq(messageHidden.messageId, row.messageId!)));
    expect(hidden).toBeDefined();
    const [member] = await db
      .select()
      .from(chatMembers)
      .where(and(eq(chatMembers.chatId, chatId), eq(chatMembers.userId, bob.id)));
    expect(member!.hidden).toBe(true);
    expect((await partOf(call.id, bob.id)).hiddenAt).not.toBeNull();
    // Logs: Alice sees an unanswered outgoing call; Bob sees nothing.
    const aliceLog = (await t.api(alice).get('/api/calls').expect(200)).body;
    expect(aliceLog[0]).toMatchObject({
      call: { id: call.id },
      direction: 'outgoing',
      outcome: 'unanswered',
    });
    expect((await t.api(bob).get('/api/calls').expect(200)).body).toEqual([]);
    expect(domainOf(call.id).map((d) => d.event)).toEqual(['call.ended']);
    expect(domainOf(call.id)[0]!.payload.participantIds).toEqual([alice.id]);
  });

  it('eligibility: blocked by me, deleted peer, self chat, non-member, invalid payloads', async () => {
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    await block(alice, bob);
    expect(await ackError(a1, 'call:start', { chatId, type: 'audio' })).toMatchObject({
      code: 'blocked',
    });

    const carol = await t.createUser();
    const ac = await createDirect(alice, carol);
    await db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, carol.id));
    expect(await ackError(a1, 'call:start', { chatId: ac, type: 'audio' })).toMatchObject({
      code: 'forbidden',
    });

    const self = await createDirect(alice, alice);
    expect(await ackError(a1, 'call:start', { chatId: self, type: 'audio' })).toMatchObject({
      code: 'forbidden',
    });

    const dave = await t.createUser();
    const erin = await t.createUser();
    const de = await createDirect(dave, erin);
    expect(await ackError(a1, 'call:start', { chatId: de, type: 'audio' })).toMatchObject({
      code: 'not_found',
    });
    expect(
      await ackError(a1, 'call:start', { chatId: crypto.randomUUID(), type: 'audio' }),
    ).toMatchObject({ code: 'not_found' });

    expect(await ackError(a1, 'call:start', { chatId: 'nope', type: 'audio' })).toMatchObject({
      code: 'validation_error',
    });
    expect(await ackError(a1, 'call:start', { chatId: de, type: 'hologram' })).toMatchObject({
      code: 'validation_error',
    });
    expect(await ackError(a1, 'call:accept', { callId: 'x' })).toMatchObject({
      code: 'validation_error',
    });
    expect(await ackError(a1, 'call:accept', { callId: crypto.randomUUID() })).toMatchObject({
      code: 'not_found',
    });

    // Direct chats ring only the peer.
    const frank = await t.createUser();
    const af = await createDirect(alice, frank);
    expect(
      await ackError(a1, 'call:start', { chatId: af, type: 'audio', userIds: [dave.id] }),
    ).toMatchObject({ code: 'validation_error' });
    const ok = await ackCall(a1, 'call:start', { chatId: af, type: 'audio', userIds: [frank.id] });
    // A stranger can't accept, join or invite into it.
    const d1 = await t.connect(dave);
    expect((await ackError(d1, 'call:join', { callId: ok.id })).code).toBe('not_found');
    expect((await ackError(d1, 'call:invite', { callId: ok.id, userIds: [erin.id] })).code).toBe(
      'not_found',
    );
    // Invites are for group calls.
    expect((await ackError(a1, 'call:invite', { callId: ok.id, userIds: [frank.id] })).code).toBe(
      'forbidden',
    );
    send(a1, 'call:leave', { callId: ok.id });
    await until(async () => (await callRow(ok.id)).status === 'cancelled', 3000, 'cancelled');
  });

  it('silenceUnknownCallers: silent ring for non-contacts (no call:ringing), normal for contacts', async () => {
    const { alice, bob, chatId } = await pair();
    await setSettings(bob, { silenceUnknownCallers: true });
    const a1 = await t.connect(alice);
    const b1 = await t.connect(bob);
    const [ra1, rb1] = [a1, b1].map(recordEvents);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await until(() => rb1.of('call:incoming').length === 1, 3000, 'incoming');
    expect(rb1.of('call:incoming')[0]!.silent).toBe(true);
    expect(domainOf(call.id)[0]!.payload).toMatchObject({
      userIds: [bob.id],
      silentUserIds: [bob.id],
    });
    ra1.clear();
    send(b1, 'call:ringing', { callId: call.id });
    await settle(250);
    expect(ra1.of('call:updated')).toHaveLength(0);
    expect((await partOf(call.id, bob.id)).status).toBe('invited');
    send(a1, 'call:leave', { callId: call.id });
    await until(() => rb1.of('call:ended').length === 1, 3000, 'cancelled');

    await saveContact(bob, alice);
    rb1.clear();
    const second = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await until(() => rb1.of('call:incoming').length === 1, 3000, 'incoming 2');
    expect(rb1.of('call:incoming')[0]!.silent).toBe(false);
    send(b1, 'call:ringing', { callId: second.id });
    await until(
      async () => (await partOf(second.id, bob.id)).status === 'ringing',
      3000,
      'ringing',
    );
    send(a1, 'call:leave', { callId: second.id });
    await until(() => rb1.of('call:ended').length === 1, 3000, 'cancelled 2');
  });

  it('events on the incoming side reach every device in matrix order (chat:upsert → message:new → call:incoming)', async () => {
    // Guard for the ordering contract when the callee's chat row is hidden (new direct chat).
    const { alice, bob, chatId } = await pair();
    const a1 = await t.connect(alice);
    const late = await connectRecording(bob);
    const call = await ackCall(a1, 'call:start', { chatId, type: 'audio' });
    await until(() => late.rec.of('call:incoming').length >= 1, 3000, 'incoming');
    const seen = late.rec
      .names()
      .filter((n): n is keyof ServerToClientEvents =>
        ['chat:upsert', 'message:new', 'call:incoming'].includes(n),
      );
    expect(seen).toEqual(['chat:upsert', 'message:new', 'call:incoming']);
    send(a1, 'call:leave', { callId: call.id });
    await until(async () => (await callRow(call.id)).status === 'cancelled', 3000, 'cancelled');
  });
});
