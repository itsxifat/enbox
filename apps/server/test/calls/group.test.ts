import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_CALL_PARTICIPANTS } from '@enbox/shared';
import { resetCallState, setCallTimings } from '../../src/modules/calls/state.js';
import { transact } from '../../src/services/effects.js';
import { domainEvents } from '../../src/services/events.js';
import { upsertMembership } from '../../src/services/membership.js';
import { startTestServer, type TestServer, type TestSocket, type TestUser } from '../helpers.js';
import { block, createChannel, createGroup, recordEvents, settle } from '../services/fixtures.js';
import { ackCall, ackError, callRow, partOf, send, statusOf, until } from './helpers.js';

type Rec = ReturnType<typeof recordEvents>;

describe('calls: group', () => {
  let t: TestServer;
  const ended: { callId: string; participantIds: string[]; status: string }[] = [];

  beforeAll(async () => {
    t = await startTestServer();
    domainEvents.on('call.ended', (p) => void ended.push(p));
  });
  afterEach(() => setCallTimings());
  afterAll(async () => {
    resetCallState();
    await t.close();
  });

  async function users(n: number): Promise<TestUser[]> {
    const out: TestUser[] = [];
    for (let i = 0; i < n; i++) out.push(await t.createUser({ displayName: `U${i}` }));
    return out;
  }

  async function connectAll(list: TestUser[]): Promise<{ sockets: TestSocket[]; recs: Rec[] }> {
    const sockets: TestSocket[] = [];
    for (const u of list) sockets.push(await t.connect(u));
    return { sockets, recs: sockets.map(recordEvents) };
  }

  const clearAll = (recs: Rec[]) => recs.forEach((r) => r.clear());

  it('rings a subset, others join, invites, participant events go to call sockets only, ends when fewer than 2 remain', async () => {
    const [alice, bob, carol, dave, erin] = await users(5);
    const chatId = await createGroup(alice!, [bob!, carol!, dave!, erin!], { name: 'Team' });
    const {
      sockets: [a, b, c, d, e],
      recs,
    } = await connectAll([alice!, bob!, carol!, dave!, erin!]);
    const [ra, rb, rc, rd, re] = recs as [Rec, Rec, Rec, Rec, Rec];

    const call = await ackCall(a!, 'call:start', { chatId, type: 'audio', userIds: [bob!.id, carol!.id] });
    expect(call).toMatchObject({ isGroup: true, status: 'ringing' });
    expect(call.participants.map((p) => [p.userId, p.status])).toEqual([
      [alice!.id, 'joined'],
      ...[bob!.id, carol!.id].sort().map((id) => [id, 'invited']),
    ]);
    await until(() => rb.of('call:incoming').length === 1 && rc.of('call:incoming').length === 1, 3000, 'incoming');
    expect(rb.of('call:incoming')[0]!.chat).toEqual({ id: chatId, type: 'group', name: 'Team', avatarUrl: null, peer: null, memberCount: 5 });
    expect(rb.of('call:incoming')[0]!.caller.id).toBe(alice!.id);
    // Everyone in the room sees the call message; only the invitees ring.
    await until(() => rd.of('message:new').some((m) => m.message.type === 'call'), 3000, 'call message');
    expect(rd.of('message:new').find((m) => m.message.type === 'call')!.message.call).toMatchObject({ isGroup: true, status: 'ringing' });
    await settle();
    expect(rd.of('call:incoming')).toHaveLength(0);
    expect(re.of('call:incoming')).toHaveLength(0);
    // /calls/active lists it for non-participant members too.
    expect((await t.api(dave).get('/api/calls/active').expect(200)).body.map((x: { id: string }) => x.id)).toContain(call.id);

    // Dave joins without being rung: the first answer makes the call ongoing.
    clearAll(recs);
    const joined = await ackCall(d!, 'call:join', { callId: call.id, audioMuted: true });
    expect(joined.status).toBe('ongoing');
    expect(joined.participants.find((p) => p.userId === dave!.id)).toMatchObject({ status: 'joined', audioMuted: true, videoOff: true });
    await until(() => ra.of('call:participant-joined').length === 1, 3000, 'dave joined');
    expect(ra.of('call:participant-joined')[0]).toEqual({ callId: call.id, userId: dave!.id });
    await until(() => rb.of('call:updated').some((p) => p.call.status === 'ongoing'), 3000, 'bob call:updated');
    await until(() => re.of('message:updated').some((p) => p.message.call?.status === 'ongoing'), 3000, 'message ongoing');
    expect(rb.of('call:ring-stop')).toHaveLength(0); // Bob keeps ringing

    // Bob accepts: both call sockets learn about him; Carol (still ringing) is not in the room.
    clearAll(recs);
    await ackCall(b!, 'call:accept', { callId: call.id });
    await until(() => ra.of('call:participant-joined').length === 1 && rd.of('call:participant-joined').length === 1, 3000, 'bob joined');
    expect(rb.of('call:ring-stop')).toEqual([{ callId: call.id, reason: 'answered_elsewhere' }]);
    await settle();
    expect(rc.of('call:participant-joined')).toHaveLength(0);
    expect(rb.of('call:participant-joined')).toHaveLength(0);
    expect(re.of('message:updated')).toHaveLength(0); // status unchanged: no message rewrite

    // Bob invites Erin (joined users in the list are skipped).
    clearAll(recs);
    const invited = await ackCall(b!, 'call:invite', { callId: call.id, userIds: [erin!.id, dave!.id, alice!.id] });
    expect(statusOf(invited, erin!.id)).toBe('invited');
    expect(invited.participants.filter((p) => p.status === 'joined')).toHaveLength(3);
    await until(() => re.of('call:incoming').length === 1, 3000, 'erin incoming');
    expect(re.of('call:incoming')[0]!.call.status).toBe('ongoing');
    await until(() => ra.of('call:updated').some((p) => statusOf(p.call, erin!.id) === 'invited'), 3000, 'call:updated erin');
    expect(re.of('call:updated')).toHaveLength(0); // got call:incoming instead

    // Carol and Erin decline; Dave leaves.
    send(c!, 'call:decline', { callId: call.id });
    send(e!, 'call:decline', { callId: call.id });
    await until(async () => (await partOf(call.id, erin!.id)).status === 'declined' && (await partOf(call.id, carol!.id)).status === 'declined', 3000, 'declines');
    clearAll(recs);
    send(d!, 'call:leave', { callId: call.id });
    await until(() => ra.of('call:participant-left').length === 1 && rb.of('call:participant-left').length === 1, 3000, 'dave left');
    expect(ra.of('call:participant-left')[0]).toEqual({ callId: call.id, userId: dave!.id });
    await until(() => ra.of('call:updated').some((p) => statusOf(p.call, dave!.id) === 'left'), 3000, 'dave left update');
    expect(rd.of('call:participant-left')).toHaveLength(0);
    expect((await callRow(call.id)).status).toBe('ongoing');

    // Bob leaves → Alice alone and nobody ringing → ended for every visible participant.
    clearAll(recs);
    send(b!, 'call:leave', { callId: call.id });
    for (const r of recs) await until(() => r.of('call:ended').length === 1, 3000, 'call:ended');
    const final = ra.of('call:ended')[0]!;
    expect(final.status).toBe('ended');
    expect(final.call.durationSec).toEqual(expect.any(Number));
    expect(Object.fromEntries(final.call.participants.map((p) => [p.userId, p.status]))).toEqual({
      [alice!.id]: 'left',
      [bob!.id]: 'left',
      [carol!.id]: 'declined',
      [dave!.id]: 'left',
      [erin!.id]: 'declined',
    });
    await until(() => re.of('message:updated').some((p) => p.message.call?.status === 'ended'), 3000, 'message ended');
    expect(ended.find((x) => x.callId === call.id)!.participantIds.sort()).toEqual([alice!.id, bob!.id, carol!.id, dave!.id, erin!.id].sort());
  });

  it('ringing group call: initiator leaving cancels; all declined → declined; decline + timeout → missed', async () => {
    const [alice, bob, carol] = await users(3);
    const chatId = await createGroup(alice!, [bob!, carol!]);
    const {
      sockets: [a, b, c],
      recs: [ra, rb, rc],
    } = await connectAll([alice!, bob!, carol!]);

    // Ringing everyone when userIds is omitted.
    const cancelled = await ackCall(a!, 'call:start', { chatId, type: 'video' });
    expect(cancelled.participants.map((p) => p.userId).sort()).toEqual([alice!.id, bob!.id, carol!.id].sort());
    await until(() => rb!.of('call:incoming').length === 1 && rc!.of('call:incoming').length === 1, 3000, 'incoming');
    send(a!, 'call:leave', { callId: cancelled.id });
    for (const r of [rb!, rc!]) {
      await until(() => r.of('call:ended').length === 1, 3000, 'cancelled');
      expect(r.of('call:ring-stop')).toEqual([{ callId: cancelled.id, reason: 'cancelled' }]);
      expect(r.of('call:ended')[0]!.status).toBe('cancelled');
    }

    [ra!, rb!, rc!].forEach((r) => r.clear());
    const declined = await ackCall(a!, 'call:start', { chatId, type: 'video' });
    await until(() => rb!.of('call:incoming').length === 1 && rc!.of('call:incoming').length === 1, 3000, 'incoming 2');
    send(b!, 'call:decline', { callId: declined.id });
    await until(() => ra!.of('call:updated').some((p) => statusOf(p.call, bob!.id) === 'declined'), 3000, 'bob declined');
    expect((await callRow(declined.id)).status).toBe('ringing');
    send(c!, 'call:decline', { callId: declined.id });
    await until(() => ra!.of('call:ended').length === 1, 3000, 'declined');
    expect(ra!.of('call:ended')[0]!.status).toBe('declined');

    setCallTimings({ ringTimeoutMs: 400 });
    [ra!, rb!, rc!].forEach((r) => r.clear());
    const missed = await ackCall(a!, 'call:start', { chatId, type: 'audio' });
    await until(() => rb!.of('call:incoming').length === 1, 3000, 'incoming 3');
    send(b!, 'call:decline', { callId: missed.id });
    await until(() => ra!.of('call:ended').length === 1, 3000, 'missed');
    expect(ra!.of('call:ended')[0]!.status).toBe('missed');
    expect(rc!.of('call:ring-stop')).toEqual([{ callId: missed.id, reason: 'timeout' }]);
  });

  it('an ongoing group call survives with one participant while someone still rings; nobody joined → ended', async () => {
    setCallTimings({ ringTimeoutMs: 1500 });
    const [alice, bob, carol] = await users(3);
    const chatId = await createGroup(alice!, [bob!, carol!]);
    const {
      sockets: [a, b],
      recs: [ra, , rc],
    } = await connectAll([alice!, bob!, carol!]);
    const call = await ackCall(a!, 'call:start', { chatId, type: 'audio' });
    await ackCall(b!, 'call:accept', { callId: call.id });
    send(b!, 'call:leave', { callId: call.id });
    await until(() => ra!.of('call:participant-left').length === 1, 3000, 'bob left');
    await settle(150);
    expect((await callRow(call.id)).status).toBe('ongoing'); // Carol is still ringing
    expect(ra!.of('call:ended')).toHaveLength(0);

    // Alice leaves too: nobody joined any more → ended even though Carol still rings.
    send(a!, 'call:leave', { callId: call.id });
    await until(() => rc!.of('call:ended').length === 1, 3000, 'ended');
    expect(rc!.of('call:ended')[0]!.status).toBe('ended');
    expect(rc!.of('call:ring-stop')).toEqual([{ callId: call.id, reason: 'ended' }]);
    expect(statusOf(rc!.of('call:ended')[0]!.call, carol!.id)).toBe('missed');
  });

  it('join / accept / invite validations', async () => {
    const [alice, bob, carol, dave, erin, frank, stranger] = await users(7);
    const chatId = await createGroup(alice!, [bob!, carol!, dave!, erin!, frank!]);
    const other = await createGroup(erin!, [frank!]);
    const {
      sockets: [a, b, c, d, e, f, s],
      recs: [, rb, rc, , , rf],
    } = await connectAll([alice!, bob!, carol!, dave!, erin!, frank!, stranger!]);

    // Erin is busy in another group call.
    const busyCall = await ackCall(e!, 'call:start', { chatId: other, type: 'audio' });
    await ackCall(f!, 'call:accept', { callId: busyCall.id });
    await settle(100);
    rf!.clear();

    // Dave blocked Alice: skipped when ringing everyone (not even a participant).
    await block(dave!, alice!);
    const call = await ackCall(a!, 'call:start', { chatId, type: 'audio' });
    expect(call.participants.find((p) => p.userId === dave!.id)).toBeUndefined();
    expect(statusOf(call, erin!.id)).toBe('busy');
    expect(statusOf(call, frank!.id)).toBe('busy');
    await settle(200);
    expect(rf!.of('call:incoming')).toHaveLength(0);

    expect((await ackError(s!, 'call:join', { callId: call.id })).code).toBe('not_found'); // not a member
    expect((await ackError(e!, 'call:join', { callId: call.id })).code).toBe('conflict'); // busy
    // An invited participant can't invite; a stranger can't; unknown call → 404.
    expect((await ackError(c!, 'call:invite', { callId: call.id, userIds: [dave!.id] })).code).toBe('forbidden');
    expect((await ackError(s!, 'call:invite', { callId: call.id, userIds: [dave!.id] })).code).toBe('not_found');
    expect((await ackError(a!, 'call:invite', { callId: crypto.randomUUID(), userIds: [dave!.id] })).code).toBe('not_found');
    expect((await ackError(a!, 'call:invite', { callId: call.id, userIds: [] })).code).toBe('validation_error');

    // Bob declines, then accepts anyway (group: join semantics).
    send(b!, 'call:decline', { callId: call.id });
    await until(async () => (await partOf(call.id, bob!.id)).status === 'declined', 3000, 'declined');
    const accepted = await ackCall(b!, 'call:accept', { callId: call.id });
    expect(statusOf(accepted, bob!.id)).toBe('joined');

    // Carol declines; Bob re-invites her (resets invited_at, rings again). Dave's block is with
    // Alice, not with Bob, so Bob can ring him; non-members are dropped, busy users get `busy`.
    send(c!, 'call:decline', { callId: call.id });
    await until(async () => (await partOf(call.id, carol!.id)).status === 'declined', 3000, 'carol declined');
    const before = (await partOf(call.id, carol!.id)).invitedAt;
    rc!.clear();
    rb!.clear();
    const reinvited = await ackCall(b!, 'call:invite', { callId: call.id, userIds: [carol!.id, dave!.id, stranger!.id, erin!.id] });
    expect(statusOf(reinvited, carol!.id)).toBe('invited');
    expect(statusOf(reinvited, dave!.id)).toBe('invited'); // no block between Bob and Dave
    expect(reinvited.participants.find((p) => p.userId === stranger!.id)).toBeUndefined();
    expect(statusOf(reinvited, erin!.id)).toBe('busy');
    expect((await partOf(call.id, carol!.id)).invitedAt.getTime()).toBeGreaterThan(before.getTime());
    await until(() => rc!.of('call:incoming').length === 1, 3000, 'carol rung again');
    // Inviting someone already ringing is a no-op.
    const again = await ackCall(b!, 'call:invite', { callId: call.id, userIds: [carol!.id] });
    expect(statusOf(again, carol!.id)).toBe('invited');
    await settle(150);
    expect(rc!.of('call:incoming')).toHaveLength(1);

    // Former members can't join.
    await transact(async (tx, fx) => {
      await upsertMembership(tx, fx, { kind: 'deactivate', chatId, userId: carol!.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: carol!.id } });
    });
    await until(async () => (await partOf(call.id, carol!.id)).status === 'missed', 3000, 'carol forced out');
    expect((await ackError(c!, 'call:join', { callId: call.id })).code).toBe('not_member');

    // End everything; joining an ended call → expired.
    send(a!, 'call:leave', { callId: call.id });
    send(b!, 'call:leave', { callId: call.id });
    await until(async () => (await callRow(call.id)).status === 'ended', 3000, 'ended');
    expect((await ackError(a!, 'call:join', { callId: call.id })).code).toBe('expired');
    expect((await ackError(a!, 'call:invite', { callId: call.id, userIds: [bob!.id] })).code).toBe('expired');
    send(e!, 'call:leave', { callId: busyCall.id });
    send(f!, 'call:leave', { callId: busyCall.id });
    await until(async () => (await callRow(busyCall.id)).status === 'ended', 3000, 'busy call ended');
    void d;
  });

  it(`at most ${MAX_CALL_PARTICIPANTS} joined participants; ringing everyone needs userIds in big groups`, async () => {
    const list = await users(MAX_CALL_PARTICIPANTS + 1); // owner + 8 others
    const [owner, ...others] = list;
    const chatId = await createGroup(owner!, others);
    const { sockets } = await connectAll(list);
    const [o, ...rest] = sockets;

    const tooMany = await ackError(o!, 'call:start', { chatId, type: 'audio' });
    expect(tooMany.code).toBe('validation_error');
    expect((await ackError(o!, 'call:start', { chatId, type: 'audio', userIds: others.map((u) => u.id) })).code).toBe('validation_error'); // schema max 7

    const rung = others.slice(0, MAX_CALL_PARTICIPANTS - 1);
    const call = await ackCall(o!, 'call:start', { chatId, type: 'audio', userIds: rung.map((u) => u.id) });
    expect(call.participants).toHaveLength(MAX_CALL_PARTICIPANTS);
    for (let i = 0; i < rung.length; i++) await ackCall(rest[i]!, 'call:accept', { callId: call.id });
    expect((await callRow(call.id)).status).toBe('ongoing');
    const last = rest[MAX_CALL_PARTICIPANTS - 1]!;
    expect((await ackError(last, 'call:join', { callId: call.id })).code).toBe('limit_reached');
    expect((await ackError(o!, 'call:invite', { callId: call.id, userIds: [others.at(-1)!.id] })).code).toBe('limit_reached');
    // One leaves → there is room again.
    send(rest[0]!, 'call:leave', { callId: call.id });
    await until(async () => (await partOf(call.id, rung[0]!.id)).status === 'left', 3000, 'left');
    expect(statusOf(await ackCall(last, 'call:join', { callId: call.id }), others.at(-1)!.id)).toBe('joined');
  });

  it('forced leave when a participant leaves or is removed from the group (member.left)', async () => {
    const [alice, bob, carol, dave] = await users(4);
    const chatId = await createGroup(alice!, [bob!, carol!, dave!]);
    const {
      sockets: [a, b, c],
      recs: [ra, , , rd],
    } = await connectAll([alice!, bob!, carol!, dave!]);
    const call = await ackCall(a!, 'call:start', { chatId, type: 'audio' });
    await ackCall(b!, 'call:accept', { callId: call.id });
    await ackCall(c!, 'call:accept', { callId: call.id });
    await until(() => rd!.of('call:incoming').length === 1, 3000, 'dave rung');
    ra!.clear();

    await transact(async (tx, fx) => {
      await upsertMembership(tx, fx, {
        kind: 'deactivate',
        chatId,
        userId: bob!.id,
        reason: 'removed',
        systemEvent: { kind: 'member_removed', actorId: alice!.id, userId: bob!.id },
      });
    });
    await until(() => ra!.of('call:participant-left').length === 1, 3000, 'bob forced out');
    expect(ra!.of('call:participant-left')[0]).toEqual({ callId: call.id, userId: bob!.id });
    expect((await partOf(call.id, bob!.id)).status).toBe('left');
    // Bob's socket is out of the call rooms.
    send(b!, 'call:signal', { callId: call.id, toUserId: alice!.id, signal: { type: 'offer', sdp: 'x' } });
    await settle(150);
    expect(ra!.of('call:signal')).toHaveLength(0);

    // Dave (still ringing) leaves the group → missed + ring-stop.
    await transact(async (tx, fx) => {
      await upsertMembership(tx, fx, { kind: 'deactivate', chatId, userId: dave!.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: dave!.id } });
    });
    await until(() => rd!.of('call:ring-stop').length === 1, 3000, 'dave ring-stop');
    expect(rd!.of('call:ring-stop')[0]).toEqual({ callId: call.id, reason: 'ended' });
    expect((await partOf(call.id, dave!.id)).status).toBe('missed');
    expect((await callRow(call.id)).status).toBe('ongoing'); // Alice + Carol remain
    send(a!, 'call:leave', { callId: call.id });
    await until(async () => (await callRow(call.id)).status === 'ended', 3000, 'ended');
  });

  it('permissions: onlyAdminsCanSend groups, channels, former members', async () => {
    const [alice, bob, carol] = await users(3);
    const strict = await createGroup(alice!, [bob!, carol!], { settings: { onlyAdminsCanSend: true } });
    const channel = await createChannel(alice!);
    const {
      sockets: [a, b],
    } = await connectAll([alice!, bob!]);
    expect((await ackError(b!, 'call:start', { chatId: strict, type: 'audio' })).code).toBe('forbidden');
    expect((await ackError(a!, 'call:start', { chatId: channel, type: 'audio' })).code).toBe('forbidden');
    const call = await ackCall(a!, 'call:start', { chatId: strict, type: 'audio', userIds: [bob!.id] });
    // Bob may still answer a call he was rung for.
    expect((await ackCall(b!, 'call:accept', { callId: call.id })).status).toBe('ongoing');
    send(a!, 'call:leave', { callId: call.id });
    await until(async () => (await callRow(call.id)).status === 'ended', 3000, 'ended');

    await transact(async (tx, fx) => {
      await upsertMembership(tx, fx, { kind: 'deactivate', chatId: strict, userId: bob!.id, reason: 'left', systemEvent: { kind: 'member_left', actorId: bob!.id } });
    });
    const former = await ackError(b!, 'call:start', { chatId: strict, type: 'audio' });
    expect(former.code).toBe('not_member');
    // Nobody left to call (all userIds are non-members) → 400.
    expect((await ackError(a!, 'call:start', { chatId: strict, type: 'audio', userIds: [bob!.id] })).code).toBe('validation_error');
  });
});
