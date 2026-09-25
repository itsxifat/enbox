/**
 * Crash recovery of the calls job (docs "Calls → Crash recovery"): the flag that switches the
 * job from recovery to sweeping flips only once recovery succeeded, so a failed boot run
 * (database not ready yet, a transient error) is retried by the next run instead of leaving
 * the previous process's calls live — and their participants busy — forever.
 * Regression tests for CALLS-5 / R5. The job keeps a module-level flag: these must be the
 * first runs of the calls job in this file.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { db } from '../../src/db/index.js';
import { runJobsOnce, startJobs, stopJobs } from '../../src/jobs/index.js';
import { resetCallState } from '../../src/modules/calls/state.js';
import { sleep, startTestServer, type TestServer, type TestUser } from '../helpers.js';
import { createDirect } from '../services/fixtures.js';
import { failNextGlobalQuery } from '../support/db-hooks.js';
import { ackCall, callRow, partOf } from './helpers.js';

describe('calls job: crash recovery is retried until it succeeds', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    resetCallState();
    await t.close();
  });

  /** An ongoing A–B call left behind by a "previous process" (no bindings, timers or sockets). */
  async function orphanedCall(): Promise<{ a: TestUser; b: TestUser; callId: string }> {
    const [a, b] = [await t.createUser(), await t.createUser()];
    const chatId = await createDirect(a, b);
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    const call = await ackCall(sa, 'call:start', { chatId, type: 'audio' });
    await ackCall(sb, 'call:accept', { callId: call.id });
    resetCallState();
    sa.disconnect();
    sb.disconnect();
    await sleep(100);
    expect((await callRow(call.id)).status).toBe('ongoing');
    return { a, b, callId: call.id };
  }

  it('a boot run failing on its first query (startJobs) is retried by the next run', async () => {
    const { a, b, callId } = await orphanedCall();
    // Boot: the calls job's first run hits a transient DB error on its first query.
    const dbAny = db as unknown as Record<string, unknown>;
    dbAny.select = () => {
      throw new Error('Connection terminated unexpectedly (simulated boot blip)');
    };
    try {
      startJobs();
    } finally {
      delete dbAny.select;
      stopJobs();
    }
    await sleep(50);
    expect((await callRow(callId)).status).toBe('ongoing');

    await runJobsOnce(); // the next tick of the calls job: recovery again
    expect({
      call: (await callRow(callId)).status,
      a: (await partOf(callId, a.id)).status,
      b: (await partOf(callId, b.id)).status,
    }).toEqual({
      call: 'ended',
      a: 'left',
      b: 'left',
    });
  });

  it('once recovered, later runs only sweep (healthy live calls are left alone)', async () => {
    const [a, b] = [await t.createUser(), await t.createUser()];
    const chatId = await createDirect(a, b);
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    const call = await ackCall(sa, 'call:start', { chatId, type: 'audio' });
    await ackCall(sb, 'call:accept', { callId: call.id });
    await runJobsOnce();
    expect((await callRow(call.id)).status).toBe('ongoing');
    sa.disconnect();
    sb.disconnect();
  });
});

describe('recoverCalls: a failed run is reported (so the job retries it)', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(async () => {
    resetCallState();
    await t.close();
  });

  it('throws when its initial query fails, and the next run closes the calls', async () => {
    const { recoverCalls } = await import('../../src/modules/calls/service.js');
    const [a, b] = [await t.createUser(), await t.createUser()];
    const chatId = await createDirect(a, b);
    const sa = await t.connect(a);
    const sb = await t.connect(b);
    const call = await ackCall(sa, 'call:start', { chatId, type: 'audio' });
    await ackCall(sb, 'call:accept', { callId: call.id });
    resetCallState();
    sa.disconnect();
    sb.disconnect();
    await sleep(100);

    const inj = failNextGlobalQuery((text) =>
      /^select "id" from "calls" where "calls"."status" in/.test(text),
    );
    await expect(recoverCalls()).rejects.toThrow();
    inj.restore();
    expect(inj.failed()).toBe(true);
    expect((await callRow(call.id)).status).toBe('ongoing');
    await recoverCalls();
    expect((await callRow(call.id)).status).toBe('ended');
  });
});
