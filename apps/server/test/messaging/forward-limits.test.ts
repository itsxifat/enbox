/**
 * Forwards count per copy against `USER_RATE_LIMITS.sendMessage` (docs "Rate limits"): the
 * real copy count is charged, and a forward creating more copies than one window allows is
 * rejected up front (400) instead of being capped. Regression tests for F5 / R9.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { USER_RATE_LIMITS } from '@enbox/shared';
import { config } from '../../src/config.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { startTestServer, type TestServer } from '../helpers.js';
import { createDirect, createGroup, send as sendFx } from '../services/fixtures.js';
import { historyOf, newClientId, sendOk } from './support.js';

describe('forward rate limit: per copy', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterEach(() => {
    config.rateLimit = false;
    resetUserLimits();
  });
  afterAll(() => t.close());

  it('one forward cannot create more messages than the sendMessage window allows (50 × 5 → 400, nothing created)', async () => {
    const u = await t.createUser();
    const targets: string[] = [];
    for (let i = 0; i < 5; i++) targets.push(await createGroup(u, []));
    for (let i = 0; i < 50; i++) await sendOk(t, u, targets[0]!, `src ${i}`);
    const sources = (await historyOf(t, u, targets[0]!, '?limit=100'))
      .filter((m) => m.type === 'text')
      .map((m) => m.id);
    expect(sources).toHaveLength(50);
    const before = (await historyOf(t, u, targets[1]!, '?limit=100')).length;

    config.rateLimit = true;
    resetUserLimits();
    const res = await t
      .api(u)
      .post('/api/messages/forward')
      .send({ clientId: 'f5', messageIds: sources, chatIds: targets });
    expect({ status: res.status, code: res.body.error?.code }).toEqual({
      status: 400,
      code: 'validation_error',
    });
    expect((await historyOf(t, u, targets[1]!, '?limit=100')).length).toBe(before);
    // Nothing was charged: a normal send still passes.
    await t
      .api(u)
      .post(`/api/chats/${targets[0]}/messages`)
      .send({ type: 'text', text: 'still fine', clientId: newClientId() })
      .expect(201);
  });

  it('two large forwards ~10 s apart cannot both pass: at most one window per window (≤ 120 copies in two windows)', async () => {
    const me = await t.createUser();
    const src = await t.createUser();
    const [p1, p2] = [await t.createUser(), await t.createUser()];
    const source = await createDirect(me, src);
    const targets = [await createDirect(me, p1), await createDirect(me, p2)];
    const ids: string[] = [];
    for (let i = 0; i < 50; i++) ids.push((await sendFx(src, source, `m${i}`)).message.id);

    config.rateLimit = true;
    resetUserLimits();
    const realNow = Date.now;
    let created = 0;
    try {
      const r1 = await t
        .api(me)
        .post('/api/messages/forward')
        .send({ clientId: newClientId(), messageIds: ids, chatIds: targets });
      if (r1.status < 300) created += (r1.body as unknown[]).length;
      Date.now = () => realNow() + 10_500; // the next 10 s window
      const r2 = await t
        .api(me)
        .post('/api/messages/forward')
        .send({ clientId: newClientId(), messageIds: ids, chatIds: targets });
      if (r2.status < 300) created += (r2.body as unknown[]).length;
      // A maximal forward (exactly one window) passes on a fresh window and uses it up.
      Date.now = () => realNow() + 21_000;
      const r3 = await t
        .api(me)
        .post('/api/messages/forward')
        .send({ clientId: newClientId(), messageIds: ids.slice(0, 30), chatIds: targets });
      expect(r3.status).toBe(201);
      created += (r3.body as unknown[]).length;
      const r4 = await t
        .api(me)
        .post('/api/messages/forward')
        .send({ clientId: newClientId(), messageIds: ids.slice(0, 1), chatIds: targets });
      expect(r4.status).toBe(429);
    } finally {
      Date.now = realNow;
    }
    expect(created).toBe(USER_RATE_LIMITS.sendMessage.limit);
  });
});
