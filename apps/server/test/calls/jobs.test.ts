import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { and, eq } from 'drizzle-orm';
import { db } from '../../src/db/index.js';
import { callParticipants, messages, statuses } from '../../src/db/schema.js';
import { runJobsOnce } from '../../src/jobs/index.js';
import { forceLeaveDirectCall, sweepCalls } from '../../src/modules/calls/service.js';
import { resetCallState } from '../../src/modules/calls/state.js';
import { transact } from '../../src/services/effects.js';
import { runAccountDeletionHooks } from '../../src/services/hooks.js';
import { sleep, startTestServer, type TestServer } from '../helpers.js';
import { createDirect, createGroup, recordEvents, saveContact } from '../services/fixtures.js';
import { ackCall, callRow, partOf, partRows, send, until } from './helpers.js';

describe('calls: jobs and hooks', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    resetCallState();
    await t.close();
  });

  const messageOf = async (callId: string) => {
    const [m] = await db
      .select()
      .from(messages)
      .where(eq(messages.id, (await callRow(callId)).messageId!));
    return m!;
  };

  it('crash recovery (first run of the calls job): ongoing → ended, ringing → missed, messages fixed; later runs only sweep', async () => {
    const [alice, bob, carol, dave] = await Promise.all(
      ['A', 'B', 'C', 'D'].map((n) => t.createUser({ displayName: n })),
    );
    const ab = await createDirect(alice!, bob!);
    const cd = await createDirect(carol!, dave!);
    const [a, b, c] = await Promise.all([alice!, bob!, carol!].map((u) => t.connect(u)));
    const rb = recordEvents(b!);
    const ongoing = await ackCall(a!, 'call:start', { chatId: ab, type: 'video' });
    await ackCall(b!, 'call:accept', { callId: ongoing.id });
    const ringing = await ackCall(c!, 'call:start', { chatId: cd, type: 'audio' });
    await sleep(30);

    resetCallState(); // the previous process is gone: no timers, no bindings
    await runJobsOnce();

    const o = await callRow(ongoing.id);
    expect(o.status).toBe('ended');
    expect(o.endedAt).not.toBeNull();
    expect((await partRows(ongoing.id)).map((p) => p.status)).toEqual(['left', 'left']);
    expect((await messageOf(ongoing.id)).metadata.call).toMatchObject({
      status: 'ended',
      durationSec: expect.any(Number),
    });
    const r = await callRow(ringing.id);
    expect(r.status).toBe('missed');
    expect((await partOf(ringing.id, dave!.id)).status).toBe('missed');
    expect((await partOf(ringing.id, carol!.id)).status).toBe('left');
    expect((await messageOf(ringing.id)).metadata.call).toMatchObject({
      status: 'missed',
      durationSec: null,
    });
    await until(() => rb.of('call:ended').length === 1, 3000, 'call:ended');
    await until(
      () => rb.of('message:updated').some((m) => m.message.call?.status === 'ended'),
      3000,
      'message:updated',
    );

    // Later runs don't touch healthy live calls.
    const live = await ackCall(a!, 'call:start', { chatId: ab, type: 'audio' });
    await runJobsOnce();
    expect((await callRow(live.id)).status).toBe('ringing');
    send(a!, 'call:leave', { callId: live.id });
    await until(async () => (await callRow(live.id)).status === 'cancelled', 3000, 'cancelled');
  });

  it('sweep closes overdue rings and expired reconnect windows when timers were lost', async () => {
    const [alice, bob] = await Promise.all(['A', 'B'].map((n) => t.createUser({ displayName: n })));
    const ab = await createDirect(alice!, bob!);
    const a = await t.connect(alice!);
    const b = await t.connect(bob!);
    const ra = recordEvents(a);

    const ringing = await ackCall(a, 'call:start', { chatId: ab, type: 'audio' });
    resetCallState();
    await db
      .update(callParticipants)
      .set({ invitedAt: new Date(Date.now() - 60_000) })
      .where(and(eq(callParticipants.callId, ringing.id), eq(callParticipants.userId, bob!.id)));
    await sweepCalls();
    expect((await callRow(ringing.id)).status).toBe('missed');
    await until(() => ra.of('call:ended').length === 1, 3000, 'missed');

    const ongoing = await ackCall(a, 'call:start', { chatId: ab, type: 'audio' });
    await ackCall(b, 'call:accept', { callId: ongoing.id });
    b.disconnect();
    await until(
      async () => (await partOf(ongoing.id, bob!.id)).disconnectedAt !== null,
      3000,
      'disconnected',
    );
    resetCallState();
    await sweepCalls();
    expect((await callRow(ongoing.id)).status).toBe('ongoing'); // still within the grace
    await db
      .update(callParticipants)
      .set({ disconnectedAt: new Date(Date.now() - 60_000) })
      .where(and(eq(callParticipants.callId, ongoing.id), eq(callParticipants.userId, bob!.id)));
    await sweepCalls();
    expect((await callRow(ongoing.id)).status).toBe('ended');
    expect((await partOf(ongoing.id, bob!.id)).status).toBe('left');
  });

  it('account deletion hooks: forced leave of every live call, statuses removed for their audience', async () => {
    const [alice, bob, carol, dave] = await Promise.all(
      ['A', 'B', 'C', 'D'].map((n) => t.createUser({ displayName: n })),
    );
    const ab = await createDirect(alice!, bob!);
    const group = await createGroup(carol!, [alice!, dave!]);
    const [a, b, c, d] = await Promise.all([alice!, bob!, carol!, dave!].map((u) => t.connect(u)));
    const [ra, rb, rc] = [a!, b!, c!].map(recordEvents);
    // Alice is rung in the group call, then (while it still rings) starts a 1:1 call with Bob.
    const grp = await ackCall(c!, 'call:start', { chatId: group, type: 'audio' });
    await until(() => ra!.of('call:incoming').length === 1, 3000, 'alice rung');
    const direct = await ackCall(a!, 'call:start', { chatId: ab, type: 'audio' });
    await ackCall(b!, 'call:accept', { callId: direct.id });
    await saveContact(alice!, bob!);
    const status = (
      await t.api(alice!).post('/api/status').send({ type: 'text', text: 'bye' }).expect(201)
    ).body;
    await until(() => rb!.of('status:new').length === 1, 3000, 'status:new');

    await transact((tx, fx) => runAccountDeletionHooks(tx, fx, alice!.id));

    await until(() => rb!.of('call:ended').length === 1, 3000, 'direct ended');
    expect(rb!.of('call:ended')[0]).toMatchObject({ callId: direct.id, status: 'ended' });
    expect((await partOf(grp.id, alice!.id)).status).toBe('missed');
    expect((await callRow(grp.id)).status).toBe('ringing'); // Dave still rings
    await until(
      () =>
        rc!
          .of('call:updated')
          .some(
            (p) => p.call.participants.find((x) => x.userId === alice!.id)?.status === 'missed',
          ),
      3000,
      'group update',
    );
    expect(ra!.of('call:ring-stop')).toContainEqual({ callId: grp.id, reason: 'ended' });
    await until(() => rb!.of('status:deleted').length === 1, 3000, 'status:deleted');
    expect(rb!.of('status:deleted')[0]).toEqual({ statusId: status.id, userId: alice!.id });
    expect(await db.select().from(statuses).where(eq(statuses.userId, alice!.id))).toEqual([]);

    send(c!, 'call:leave', { callId: grp.id });
    await until(async () => (await callRow(grp.id)).status === 'cancelled', 3000, 'cancelled');
    void d;
  });

  it('forceLeaveDirectCall (block): the blocker is forced out, which ends the 1:1 call', async () => {
    const [alice, bob] = await Promise.all(['A', 'B'].map((n) => t.createUser({ displayName: n })));
    const ab = await createDirect(alice!, bob!);
    const a = await t.connect(alice!);
    const b = await t.connect(bob!);
    const ra = recordEvents(a);
    const rb = recordEvents(b);

    const ongoing = await ackCall(a, 'call:start', { chatId: ab, type: 'audio' });
    await ackCall(b, 'call:accept', { callId: ongoing.id });
    await forceLeaveDirectCall(bob!.id, alice!.id);
    await until(() => ra.of('call:ended').length === 1, 3000, 'ended');
    expect(ra.of('call:participant-left')).toEqual([{ callId: ongoing.id, userId: bob!.id }]);
    expect(ra.of('call:ended')[0]!.status).toBe('ended');

    const ringing = await ackCall(a, 'call:start', { chatId: ab, type: 'audio' });
    await until(() => rb.of('call:incoming').length === 2, 3000, 'incoming');
    await forceLeaveDirectCall(alice!.id, bob!.id);
    await until(() => rb.of('call:ended').some((e) => e.callId === ringing.id), 3000, 'cancelled');
    expect((await callRow(ringing.id)).status).toBe('cancelled');
    expect(rb.of('call:ring-stop').at(-1)).toEqual({ callId: ringing.id, reason: 'cancelled' });
    // No live call: a no-op.
    await forceLeaveDirectCall(alice!.id, bob!.id);
  });
});
