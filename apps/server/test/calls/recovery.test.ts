/**
 * Calls left behind by a dead process (docs "Cluster" → "Calls"): participants whose call
 * socket was bound on a process that is gone (crash, restart, a release that predates socket
 * bindings) enter the reconnect grace through the leader's sweep. Their clients can rejoin
 * through any process; otherwise the grace ends them. A restart never ends calls by itself.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { NODE_ID } from '../../src/cluster/node.js';
import { db } from '../../src/db/index.js';
import { callParticipants, clusterNodes } from '../../src/db/schema.js';
import { sweepCalls } from '../../src/modules/calls/service.js';
import { resetCallState, setCallTimings } from '../../src/modules/calls/state.js';
import {
  sleep,
  startTestServer,
  type TestServer,
  type TestSocket,
  type TestUser,
} from '../helpers.js';
import { createDirect, recordEvents } from '../services/fixtures.js';
import { ackCall, callRow, partOf, until } from './helpers.js';

describe('calls: participants bound to a dead process', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterEach(() => setCallTimings());
  afterAll(async () => {
    resetCallState();
    await t.close();
  });

  /** An ongoing A–B call whose two call sockets were bound by `nodeId` (default: a dead node). */
  async function boundElsewhere(
    nodeId: string | null = 'dead-node',
  ): Promise<{ a: TestUser; b: TestUser; sa: TestSocket; sb: TestSocket; callId: string }> {
    const [a, b] = [await t.createUser(), await t.createUser()];
    const chatId = await createDirect(a, b);
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    const call = await ackCall(sa, 'call:start', { chatId, type: 'audio' });
    await ackCall(sb, 'call:accept', { callId: call.id });
    resetCallState(); // that process's index and timers are gone with it
    await db
      .update(callParticipants)
      .set(nodeId === null ? { nodeId: null, socketId: null } : { nodeId })
      .where(eq(callParticipants.callId, call.id));
    return { a, b, sa, sb, callId: call.id };
  }

  it('the leader sweep moves them into the reconnect grace; the call goes on', async () => {
    const { a, b, sa, sb, callId } = await boundElsewhere();
    await sweepCalls();
    const [pa, pb] = [await partOf(callId, a.id), await partOf(callId, b.id)];
    expect({
      call: (await callRow(callId)).status,
      a: [pa.status, pa.disconnectedAt !== null, pa.socketId, pa.nodeId],
      b: [pb.status, pb.disconnectedAt !== null, pb.socketId, pb.nodeId],
    }).toEqual({
      call: 'ongoing',
      a: ['joined', true, null, null],
      b: ['joined', true, null, null],
    });
    sa.disconnect();
    sb.disconnect();
  });

  it('a client rejoins through this process within the grace and keeps the call', async () => {
    const { a, b, sa, sb, callId } = await boundElsewhere();
    await sweepCalls();
    await ackCall(sa, 'call:rejoin', { callId });
    await ackCall(sb, 'call:rejoin', { callId });
    const pa = await partOf(callId, a.id);
    expect({
      call: (await callRow(callId)).status,
      a: [pa.status, pa.disconnectedAt, pa.socketId, pa.nodeId],
      b: (await partOf(callId, b.id)).nodeId,
    }).toEqual({
      call: 'ongoing',
      a: ['joined', null, sa.id, NODE_ID],
      b: NODE_ID,
    });
    sa.disconnect();
    sb.disconnect();
  });

  it('without a rejoin the grace ends the call', async () => {
    setCallTimings({ reconnectGraceMs: 150 });
    const { a, b, sa, sb, callId } = await boundElsewhere();
    const ra = recordEvents(sa);
    await sweepCalls();
    await sleep(250); // > grace (the timer, or the next sweep, closes it)
    await sweepCalls();
    await until(async () => (await callRow(callId)).status === 'ended', 3000, 'ended');
    expect([(await partOf(callId, a.id)).status, (await partOf(callId, b.id)).status]).toEqual([
      'left',
      'left',
    ]);
    await until(() => ra.of('call:ended').length === 1, 3000, 'call:ended');
    sa.disconnect();
    sb.disconnect();
  });

  it('participants bound to a live process are left alone', async () => {
    await db
      .insert(clusterNodes)
      .values({ id: 'live-node', heartbeatAt: new Date() })
      .onConflictDoUpdate({ target: clusterNodes.id, set: { heartbeatAt: new Date() } });
    const { a, sa, sb, callId } = await boundElsewhere('live-node');
    await sweepCalls();
    expect((await partOf(callId, a.id)).disconnectedAt).toBeNull();
    expect((await callRow(callId)).status).toBe('ongoing');
    sa.disconnect();
    sb.disconnect();
  });

  it('participants without any binding (a release that predates bindings) are recovered too', async () => {
    const { a, sa, sb, callId } = await boundElsewhere(null);
    await sweepCalls();
    expect((await partOf(callId, a.id)).disconnectedAt).not.toBeNull();
    sa.disconnect();
    sb.disconnect();
  });
});
