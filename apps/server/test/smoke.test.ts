import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestServer, type TestServer } from './helpers.js';

describe('server smoke', () => {
  let t: TestServer;
  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  it('serves health and config', async () => {
    const health = await t.api().get('/api/health').expect(200);
    expect(health.body.ok).toBe(true);
    const cfg = await t.api().get('/api/config').expect(200);
    expect(cfg.body.maxUploadBytes).toBeGreaterThan(0);
  });

  it('rejects unauthenticated API calls and unknown endpoints', async () => {
    const res = await t.api().get('/api/chats').expect(401);
    expect(res.body.error.code).toBe('unauthorized');
    const u = await t.createUser();
    const nf = await t.api(u).get('/api/definitely-not-here').expect(404);
    expect(nf.body.error.code).toBe('not_found');
  });

  it('authenticates sockets and emits ready', async () => {
    const u = await t.createUser();
    const s = await t.connect(u);
    expect(s.connected).toBe(true);
    await expect(t.connect({ token: 'bogus' })).rejects.toThrow(/unauthorized/);
  });
});
