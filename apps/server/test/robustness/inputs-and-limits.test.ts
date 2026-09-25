/**
 * Robustness regressions: unstorable input is a 400 (never a 500), per-IP limits can't be
 * dodged with a spoofed X-Forwarded-For, push fan-out and status posting are bounded, and
 * uploads never orphan stored files. Regression tests for R1, R3, R7, R8, R11 and R12.
 */
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { pushSubscriptions } from '../../src/db/schema.js';
import { sweepUploadTmp } from '../../src/jobs/mediaGc.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import { pushIdle, setPushSender } from '../../src/modules/push/sender.js';
import { MAX_PUSH_SUBSCRIPTIONS_PER_USER } from '../../src/modules/push/routes.js';
import { STATUS_FEED_PER_AUTHOR } from '../../src/modules/status/service.js';
import { uploadTmpDir } from '../../src/services/uploads.js';
import { sleep, startTestServer, type TestServer } from '../helpers.js';
import { activeDirect, mkStatus, newClientId, sendReq } from '../messaging/support.js';
import { saveContact } from '../services/fixtures.js';

describe('robustness: inputs and limits', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterEach(() => {
    config.rateLimit = false;
    resetUserLimits();
  });
  afterAll(() => t.close());

  describe('R1: a NUL byte or a lone surrogate is a 400, never a 500', () => {
    it('unauthenticated login and register', async () => {
      const login = await t.api().post('/api/auth/login').send({ identifier: 'ab\u0000c', password: 'password123' });
      expect({ status: login.status, code: login.body.error?.code }).toEqual({ status: 400, code: 'validation_error' });
      const register = await t.api().post('/api/auth/register').send({ username: `nul${Date.now() % 100000}`, displayName: 'a\u0000b', password: 'password123' });
      expect({ status: register.status, code: register.body.error?.code }).toEqual({ status: 400, code: 'validation_error' });
    });

    it('message text, clientId, poll question (lone surrogate), location name', async () => {
      const [a, b] = [await t.createUser(), await t.createUser()];
      const d = await activeDirect(t, a, b);
      const cases = [
        { text: 'hi\u0000there' },
        { text: 'ok', clientId: 'c\u00003' },
        { type: 'poll', clientId: newClientId(), poll: { question: 'q\ud800', options: ['a', 'b'] } },
        { type: 'poll', clientId: newClientId(), poll: { question: 'q', options: ['a\udc00', 'b'] } },
        { type: 'location', clientId: newClientId(), location: { latitude: 1, longitude: 2, name: 'x\u0000' } },
      ];
      for (const body of cases) {
        const res = await sendReq(t, a, d, body);
        expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 400, code: 'validation_error' });
      }
      // Well-formed surrogate pairs (emoji) are fine.
      expect((await sendReq(t, a, d, { text: 'party 🎉' })).status).toBe(201);
    });

    it('query strings, profile, group names, statuses, contacts', async () => {
      const a = await t.createUser();
      const checks = [
        t.api(a).get('/api/users/search?q=abc%00'),
        t.api(a).get('/api/search/messages?q=a%00'),
        t.api(a).get('/api/channels/discover?q=a%00'),
        t.api(a).patch('/api/me').send({ about: 'x\u0000' }),
        t.api(a).post('/api/groups').send({ name: 'g\u0000' }),
        t.api(a).post('/api/status').send({ type: 'text', text: 's\u0000' }),
        t.api(a).post('/api/contacts').send({ userId: (await t.createUser()).id, name: 'n\u0000' }),
      ];
      for (const req of checks) {
        const res = await req;
        expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 400, code: 'validation_error' });
      }
    });
  });

  describe('R8: out-of-range datetimes are a 400, never a 500', () => {
    it.each(['0000-01-01T00:00:00Z', '9999-12-31T23:59:59-14:00'])('PATCH prefs mutedUntil %s', async (mutedUntil) => {
      const [a, b] = [await t.createUser(), await t.createUser()];
      const d = await activeDirect(t, a, b);
      const res = await t.api(a).patch(`/api/chats/${d}/prefs`).send({ mutedUntil });
      expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 400, code: 'validation_error' });
    });

    it('GET /calls?before=0000-01-01T00:00:00Z', async () => {
      const a = await t.createUser();
      const res = await t.api(a).get('/api/calls?before=0000-01-01T00:00:00Z');
      expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 400, code: 'validation_error' });
    });

    it('in-range values (MUTE_FOREVER, year 1) still work', async () => {
      const [a, b] = [await t.createUser(), await t.createUser()];
      const d = await activeDirect(t, a, b);
      await t.api(a).patch(`/api/chats/${d}/prefs`).send({ mutedUntil: '9999-12-31T23:59:59.000Z' }).expect(200);
      await t.api(a).get('/api/calls?before=0001-01-01T00:00:00Z').expect(200);
    });
  });

  it('R3: without TRUST_PROXY a client cannot dodge the per-IP auth limiter by rotating X-Forwarded-For', async () => {
    const victim = await t.createUser();
    expect(config.trustProxy).toBe(false);
    config.rateLimit = true;
    // express-rate-limit warns (console.error) about an X-Forwarded-For it ignores: that is
    // the operator's hint to set TRUST_PROXY behind a proxy.
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    const statuses: number[] = [];
    try {
      for (let i = 0; i < 25; i++) {
        const res = await t
          .api()
          .post('/api/auth/login')
          .set('X-Forwarded-For', `10.9.0.${i + 1}`)
          .send({ identifier: victim.username, password: `wrong-password-${i}` });
        statuses.push(res.status);
      }
    } finally {
      warn.mockRestore();
    }
    // authLimiter: 20 attempts / 10 min per client IP → attempts 21..25 are 429.
    expect(statuses.filter((s) => s === 429).length).toBe(5);
  });

  describe('R7: push fan-out is bounded', () => {
    it('one session keeps one subscription: 50 endpoints registered by one device → one push per event', async () => {
      const [alice, bob] = [await t.createUser(), await t.createUser()];
      const d = await activeDirect(t, alice, bob);
      for (let i = 0; i < 50; i++) {
        await t
          .api(bob)
          .post('/api/push/subscriptions')
          .send({ endpoint: `https://fcm.googleapis.com/fcm/send/r7-${bob.id}-${i}`, keys: { p256dh: 'BPublicKey', auth: 'authSecret' } })
          .expect(204);
      }
      const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, bob.id));
      expect(rows.map((r) => r.endpoint)).toEqual([`https://fcm.googleapis.com/fcm/send/r7-${bob.id}-49`]);

      let sends = 0;
      setPushSender(async (target) => {
        if (target.endpoint.includes(bob.id)) sends += 1;
      });
      try {
        await pushIdle();
        sends = 0;
        expect((await sendReq(t, alice, d, { text: 'one notification' })).status).toBe(201);
        await pushIdle();
      } finally {
        setPushSender(undefined);
      }
      expect(sends).toBe(1);
    });

    it(`a user keeps at most MAX_PUSH_SUBSCRIPTIONS_PER_USER subscriptions (oldest dropped)`, async () => {
      const u = await t.createUser();
      const { createSession } = await import('../../src/services/sessions.js');
      const endpoints: string[] = [];
      for (let i = 0; i < MAX_PUSH_SUBSCRIPTIONS_PER_USER + 3; i++) {
        const { token } = await createSession({ userId: u.id, deviceName: `d${i}` });
        const endpoint = `https://fcm.googleapis.com/fcm/send/cap-${u.id}-${i}`;
        endpoints.push(endpoint);
        await t.api({ token }).post('/api/push/subscriptions').send({ endpoint, keys: { p256dh: 'k', auth: 'a' } }).expect(204);
        await sleep(2); // distinct createdAt
      }
      const rows = await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, u.id));
      expect(rows.map((r) => r.endpoint).sort()).toEqual(endpoints.slice(3).sort());
    });

    it('a subscription failing repeatedly (not 404/410) is dropped', async () => {
      const [alice, bob] = [await t.createUser(), await t.createUser()];
      const d = await activeDirect(t, alice, bob);
      const endpoint = `https://fcm.googleapis.com/fcm/send/junk-${bob.id}`;
      await t.api(bob).post('/api/push/subscriptions').send({ endpoint, keys: { p256dh: 'junk', auth: 'junk' } }).expect(204);
      setPushSender(async (target) => {
        if (target.endpoint === endpoint) throw new Error('local encryption failed: bad p256dh');
      });
      try {
        for (let i = 0; i < 5; i++) {
          await sendReq(t, alice, d, { text: `m${i}` }).expect(201);
          await pushIdle();
        }
      } finally {
        setPushSender(undefined);
      }
      expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.endpoint, endpoint))).toEqual([]);
    });
  });

  describe('R11: status posting is rate-limited and the feed is capped per author', () => {
    it('POST /status → 429 after 30 per hour', async () => {
      const u = await t.createUser();
      config.rateLimit = true;
      resetUserLimits();
      for (let i = 0; i < 30; i++) await t.api(u).post('/api/status').send({ type: 'text', text: `s${i}` }).expect(201);
      const res = await t.api(u).post('/api/status').send({ type: 'text', text: 'one too many' });
      expect({ status: res.status, code: res.body.error?.code }).toEqual({ status: 429, code: 'rate_limited' });
    });

    it(`the feed shows at most STATUS_FEED_PER_AUTHOR (latest) statuses of an author`, async () => {
      const [author, viewer] = [await t.createUser(), await t.createUser()];
      await saveContact(author, viewer);
      const ids: string[] = [];
      for (let i = 0; i < STATUS_FEED_PER_AUTHOR + 5; i++) {
        ids.push((await mkStatus(author.id, [viewer.id], { text: `s${i}` })).id);
        await sleep(1);
      }
      const feed = (await t.api(viewer).get('/api/status/feed').expect(200)).body as { updates: { user: { id: string }; statuses: { id: string }[] }[] };
      const mine = feed.updates.find((u) => u.user.id === author.id)!;
      expect(mine.statuses.map((s) => s.id)).toEqual(ids.slice(5));
    });
  });

  describe('R12: uploads never orphan stored files', () => {
    const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
    const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF\0'), Buffer.alloc(64)]);
    const storedFiles = () =>
      (fs.readdirSync(t.uploadDir, { recursive: true }) as string[]).filter((f) => !f.startsWith('.tmp') && fs.statSync(path.join(t.uploadDir, f)).isFile());

    it('when moving the thumbnail into the store fails, the already-stored main file is removed', async () => {
      const u = await t.createUser();
      const before = new Set(storedFiles());
      const origRename = fsp.rename;
      let renames = 0;
      (fsp as { rename: typeof fsp.rename }).rename = (async (from: fs.PathLike, to: fs.PathLike) => {
        renames += 1;
        if (renames === 2) throw Object.assign(new Error('ENOSPC: no space left on device, rename'), { code: 'ENOSPC', errno: -28 });
        return origRename(from, to);
      }) as typeof fsp.rename;
      let status: number;
      try {
        const res = await t
          .api(u)
          .post('/api/media')
          .field('kind', 'image')
          .attach('file', PNG, { filename: 'a.png', contentType: 'image/png' })
          .attach('thumbnail', JPEG, { filename: 't.jpg', contentType: 'image/jpeg' });
        status = res.status;
      } finally {
        (fsp as { rename: typeof fsp.rename }).rename = origRename;
      }
      expect(renames).toBe(2);
      expect(status).toBe(500);
      expect(storedFiles().filter((f) => !before.has(f))).toEqual([]);
      expect(fs.readdirSync(uploadTmpDir())).toEqual([]); // temp files cleaned up too
    });

    it('the media GC sweeps stale temp uploads (leftovers of a crash), keeping fresh ones', async () => {
      fs.mkdirSync(uploadTmpDir(), { recursive: true });
      const stale = path.join(uploadTmpDir(), 'stale-upload');
      const fresh = path.join(uploadTmpDir(), 'fresh-upload');
      fs.writeFileSync(stale, 'x');
      fs.writeFileSync(fresh, 'y');
      const old = new Date(Date.now() - 2 * 60 * 60_000);
      fs.utimesSync(stale, old, old);
      expect(await sweepUploadTmp()).toBe(1);
      expect(fs.existsSync(stale)).toBe(false);
      expect(fs.existsSync(fresh)).toBe(true);
      fs.rmSync(fresh);
    });
  });
});
