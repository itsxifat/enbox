import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { DEFAULT_ABOUT, DEFAULT_USER_SETTINGS, type AuthResponse, type SessionInfo } from '@enbox/shared';
import { db } from '../../src/db/index.js';
import { pushSubscriptions, sessions, users } from '../../src/db/schema.js';
import { runSessionCleanup } from '../../src/modules/auth/sessionCleanup.js';
import { resolveToken } from '../../src/services/sessions.js';
import { expectNoEvent, startTestServer, waitForEvent, type TestServer, type TestUser } from '../helpers.js';
import { recordEvents } from '../services/fixtures.js';
import { newDevice, waitDisconnect } from './util.js';

const CHROME_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SAFARI_IOS = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

describe('auth: register, login, sessions, password', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  function register(body: Record<string, unknown>, ua?: string) {
    const req = t.api().post('/api/auth/register');
    if (ua) req.set('User-Agent', ua);
    return req.send(body);
  }

  function login(identifier: string, password: string, extra: Record<string, unknown> = {}, ua?: string) {
    const req = t.api().post('/api/auth/login');
    if (ua) req.set('User-Agent', ua);
    return req.send({ identifier, password, ...extra });
  }

  /** A registered user (through the API) as a TestUser. */
  async function registered(username: string, phone?: string): Promise<TestUser> {
    const res = await register({ username, displayName: username.toUpperCase(), password: 'secret-pass-1', ...(phone ? { phone } : {}) }).expect(201);
    const body = res.body as AuthResponse;
    const [s] = await db.select().from(sessions).where(eq(sessions.userId, body.user.id));
    return { id: body.user.id, username, displayName: body.user.displayName, token: body.token, sessionId: s!.id, password: 'secret-pass-1' };
  }

  describe('POST /api/auth/register', () => {
    it('creates the account and a session; returns 201 { token, user: UserSelf }', async () => {
      const res = await register({ username: 'Alice_1', displayName: '  Alice  ', password: 'correct horse', phone: '+1 (555) 010-0001' }, CHROME_WINDOWS).expect(201);
      const body = res.body as AuthResponse;
      expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/);
      expect(body.user).toMatchObject({
        username: 'alice_1', // lowercased
        displayName: 'Alice', // trimmed
        phone: '+15550100001', // canonical E.164
        about: DEFAULT_ABOUT,
        avatarUrl: null,
        settings: DEFAULT_USER_SETTINGS,
      });
      expect(Date.parse(body.user.createdAt)).not.toBeNaN();
      const me = await t.api({ token: body.token }).get('/api/me').expect(200);
      expect(me.body.id).toBe(body.user.id);
      const list = (await t.api({ token: body.token }).get('/api/auth/sessions').expect(200)).body as SessionInfo[];
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ deviceName: 'Chrome on Windows', userAgent: CHROME_WINDOWS, current: true });
      // Stored as a scrypt hash, never the password.
      const [row] = await db.select().from(users).where(eq(users.id, body.user.id));
      expect(row!.passwordHash).toMatch(/^scrypt\$/);
      expect(row!.passwordHash).not.toContain('correct horse');
    });

    it('uses an explicit device name and treats a blank phone as absent', async () => {
      const res = await register({ username: 'bob_1', displayName: 'Bob', password: 'password-1', phone: '', deviceName: ' My laptop ' }, SAFARI_IOS).expect(201);
      expect(res.body.user.phone).toBeNull();
      const list = (await t.api({ token: res.body.token }).get('/api/auth/sessions').expect(200)).body as SessionInfo[];
      expect(list[0]!.deviceName).toBe('My laptop');
    });

    it.each([
      ['username too short', { username: 'ab' }],
      ['username without a letter', { username: '12345' }],
      ['username with invalid characters', { username: 'bad name!' }],
      ['reserved deleted_ prefix', { username: 'deleted_abc' }],
      ['password too short', { password: 'short' }],
      ['invalid phone', { phone: '12ab' }],
      ['phone without enough digits', { phone: '+12345' }],
      ['missing display name', { displayName: undefined }],
      ['blank display name', { displayName: '   ' }],
    ])('rejects %s with 400 validation_error', async (_label, override) => {
      const body = { username: 'valid_name', displayName: 'Valid', password: 'password-1', ...override };
      const res = await register(body).expect(400);
      expect(res.body.error.code).toBe('validation_error');
    });

    it('rejects a taken username (case-insensitive) or phone (any formatting) with 409', async () => {
      await registered('carol', '+15550100002');
      const dupName = await register({ username: 'CAROL', displayName: 'C', password: 'password-1' }).expect(409);
      expect(dupName.body.error).toMatchObject({ code: 'conflict', message: expect.stringMatching(/username/i) });
      const dupPhone = await register({ username: 'carol2', displayName: 'C', password: 'password-1', phone: '001 555 010 0002' }).expect(409);
      expect(dupPhone.body.error).toMatchObject({ code: 'conflict', message: expect.stringMatching(/phone/i) });
    });
  });

  describe('POST /api/auth/login', () => {
    let dave: TestUser;
    beforeAll(async () => {
      dave = await registered('dave', '+15550100003');
    });

    it('logs in by username (any case, optional whitespace)', async () => {
      const res = await login('  DAVE ', 'secret-pass-1').expect(200);
      expect(res.body.user).toMatchObject({ id: dave.id, username: 'dave', phone: '+15550100003' });
      await t.api({ token: res.body.token }).get('/api/me').expect(200);
    });

    it.each(['+15550100003', '+1 (555) 010-0003', '1 555 010 0003', '15550100003', '0015550100003', '+1.555.010.0003'])(
      'logs in by phone written as %s',
      async (identifier) => {
        const res = await login(identifier, 'secret-pass-1').expect(200);
        expect(res.body.user.id).toBe(dave.id);
      },
    );

    it('every login is a new session (linked device) with its own device name', async () => {
      const res = await login('dave', 'secret-pass-1', { deviceName: 'Work PC' }).expect(200);
      const list = (await t.api({ token: res.body.token }).get('/api/auth/sessions').expect(200)).body as SessionInfo[];
      expect(list.length).toBeGreaterThan(2);
      expect(list[0]).toMatchObject({ deviceName: 'Work PC', current: true });
      expect(list.filter((s) => s.current)).toHaveLength(1);
    });

    it('fails with the same 401 for a wrong password, an unknown user and a malformed phone', async () => {
      const wrong = await login('dave', 'not-the-password').expect(401);
      const unknown = await login('nobody_here', 'secret-pass-1').expect(401);
      const unknownPhone = await login('+15559999999', 'secret-pass-1').expect(401);
      const badPhone = await login('12', 'secret-pass-1').expect(401);
      for (const r of [unknown, unknownPhone, badPhone]) expect(r.body).toEqual(wrong.body);
      expect(wrong.body.error.code).toBe('unauthorized');
    });

    it('validates the body', async () => {
      await login('', 'x').expect(400);
      await t.api().post('/api/auth/login').send({ identifier: 'dave' }).expect(400);
    });

    it('deleted accounts cannot log in (same error as a wrong password)', async () => {
      const erin = await registered('erin', '+15550100004');
      await t.api(erin).delete('/api/me').send({ password: 'secret-pass-1' }).expect(204);
      const byName = await login('erin', 'secret-pass-1').expect(401);
      const byPhone = await login('+15550100004', 'secret-pass-1').expect(401);
      const [row] = await db.select().from(users).where(eq(users.id, erin.id));
      const byDeletedName = await login(row!.username, 'secret-pass-1').expect(401);
      const wrong = await login('dave', 'nope-nope').expect(401);
      for (const r of [byName, byPhone, byDeletedName]) expect(r.body).toEqual(wrong.body);
    });
  });

  describe('sessions', () => {
    it('lists only my unexpired sessions, the current one first', async () => {
      const u = await t.createUser();
      const other = await newDevice(u, 'Tablet');
      const expired = await newDevice(u, 'Old phone');
      await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, expired.sessionId));
      await t.createUser(); // someone else's session
      const list = (await t.api(other).get('/api/auth/sessions').expect(200)).body as SessionInfo[];
      expect(list.map((s) => s.id)).toEqual([other.sessionId, u.sessionId]);
      expect(list[0]).toMatchObject({ current: true, deviceName: 'Tablet', ip: null });
      expect(list[1]).toMatchObject({ current: false, deviceName: 'test' });
      expect(Object.keys(list[0]!).sort()).toEqual(['createdAt', 'current', 'deviceName', 'id', 'ip', 'lastActiveAt', 'userAgent']);
    });

    it('DELETE /auth/sessions/:id revokes one of my sessions: session:revoked → that device, then disconnect', async () => {
      const u = await t.createUser();
      const phone = await newDevice(u, 'Phone');
      const [sCurrent, sPhone] = [await t.connect(u), await t.connect(phone)];
      await db.insert(pushSubscriptions).values({ userId: u.id, sessionId: phone.sessionId, endpoint: 'https://fcm.googleapis.com/fcm/send/phone-1', p256dh: 'k', auth: 'a' });
      const log = recordEvents(sPhone);
      const gone = waitDisconnect(sPhone);
      await t.api(u).delete(`/api/auth/sessions/${phone.sessionId}`).expect(204);
      await gone;
      expect(log.names()).toEqual(['session:revoked']);
      expect(log.of('session:revoked')[0]).toEqual({ sessionId: phone.sessionId });
      await expectNoEvent(sCurrent, 'session:revoked');
      expect(sCurrent.connected).toBe(true);
      await t.api(phone).get('/api/me').expect(401);
      await t.api(u).get('/api/me').expect(200);
      expect(await resolveToken(phone.token)).toBeNull();
      // Push subscriptions cascade with their session.
      expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.sessionId, phone.sessionId))).toEqual([]);
      // A revoked device can't reconnect.
      await expect(t.connect(phone)).rejects.toThrow(/unauthorized/);
    });

    it("DELETE /auth/sessions/:id only affects the caller's sessions (404 otherwise) and validates the id", async () => {
      const u = await t.createUser();
      const stranger = await t.createUser();
      const r = await t.api(u).delete(`/api/auth/sessions/${stranger.sessionId}`).expect(404);
      expect(r.body.error.code).toBe('not_found');
      await t.api(stranger).get('/api/me').expect(200);
      await t.api(u).delete(`/api/auth/sessions/${crypto.randomUUID()}`).expect(404);
      await t.api(u).delete('/api/auth/sessions/not-a-uuid').expect(400);
    });

    it('deleting the current session is a logout (no session:revoked)', async () => {
      const u = await t.createUser();
      const s = await t.connect(u);
      const log = recordEvents(s);
      const gone = waitDisconnect(s);
      await t.api(u).delete(`/api/auth/sessions/${u.sessionId}`).expect(204);
      await gone;
      expect(log.names()).not.toContain('session:revoked');
      await t.api(u).get('/api/me').expect(401);
    });

    it('DELETE /auth/sessions logs out every OTHER device, each notified with its own id', async () => {
      const u = await t.createUser();
      const d2 = await newDevice(u, 'Two');
      const d3 = await newDevice(u, 'Three');
      const [s1, s2, s3] = [await t.connect(u), await t.connect(d2), await t.connect(d3)];
      const e2 = waitForEvent(s2, 'session:revoked');
      const e3 = waitForEvent(s3, 'session:revoked');
      const g2 = waitDisconnect(s2);
      const g3 = waitDisconnect(s3);
      await t.api(u).delete('/api/auth/sessions').expect(204);
      expect(await e2).toEqual({ sessionId: d2.sessionId });
      expect(await e3).toEqual({ sessionId: d3.sessionId });
      await Promise.all([g2, g3]);
      await expectNoEvent(s1, 'session:revoked');
      expect(s1.connected).toBe(true);
      const list = (await t.api(u).get('/api/auth/sessions').expect(200)).body as SessionInfo[];
      expect(list.map((x) => x.id)).toEqual([u.sessionId]);
      await t.api(d2).get('/api/me').expect(401);
      await t.api(d3).get('/api/me').expect(401);
    });

    it('POST /auth/logout deletes the current session (push subscriptions cascade) and drops its sockets', async () => {
      const u = await t.createUser();
      const other = await newDevice(u);
      const s = await t.connect(u);
      const sOther = await t.connect(other);
      await t
        .api(u)
        .post('/api/push/subscriptions')
        .send({ endpoint: 'https://fcm.googleapis.com/fcm/send/logout-1', keys: { p256dh: 'p', auth: 'a' } })
        .expect(204);
      const log = recordEvents(s);
      const gone = waitDisconnect(s);
      await t.api(u).post('/api/auth/logout').expect(204);
      await gone;
      expect(log.names()).not.toContain('session:revoked');
      await t.api(u).get('/api/me').expect(401);
      await t.api(u).post('/api/auth/logout').expect(401);
      expect(await db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, u.id))).toEqual([]);
      // Other devices are untouched.
      await expectNoEvent(sOther, 'session:revoked');
      await t.api(other).get('/api/me').expect(200);
    });

    it('the session cleanup job deletes expired sessions', async () => {
      const u = await t.createUser();
      const old = await newDevice(u, 'Expired');
      await db.update(sessions).set({ expiresAt: new Date(Date.now() - 60_000) }).where(eq(sessions.id, old.sessionId));
      expect(await runSessionCleanup()).toBeGreaterThanOrEqual(1);
      expect(await db.select().from(sessions).where(eq(sessions.id, old.sessionId))).toEqual([]);
      await t.api(old).get('/api/me').expect(401);
      await t.api(u).get('/api/me').expect(200);
    });
  });

  describe('POST /api/auth/change-password', () => {
    it('rejects a wrong current password with 403 (not 401) and validates the new one', async () => {
      const u = await registered('frank');
      const wrong = await t.api(u).post('/api/auth/change-password').send({ currentPassword: 'nope-nope', newPassword: 'another-pass' }).expect(403);
      expect(wrong.body.error.code).toBe('forbidden');
      await t.api(u).post('/api/auth/change-password').send({ currentPassword: 'secret-pass-1', newPassword: 'short' }).expect(400);
      await t.api(u).post('/api/auth/change-password').send({}).expect(400);
      await login('frank', 'secret-pass-1').expect(200);
    });

    it('changes the password and revokes every other session (session:revoked + disconnect)', async () => {
      const u = await registered('grace');
      const other = await newDevice(u, 'Other');
      const s = await t.connect(u);
      const sOther = await t.connect(other);
      const revoked = waitForEvent(sOther, 'session:revoked');
      const gone = waitDisconnect(sOther);
      await t.api(u).post('/api/auth/change-password').send({ currentPassword: 'secret-pass-1', newPassword: 'brand-new-pass' }).expect(204);
      expect(await revoked).toEqual({ sessionId: other.sessionId });
      await gone;
      await expectNoEvent(s, 'session:revoked');
      await t.api(u).get('/api/me').expect(200);
      await t.api(other).get('/api/me').expect(401);
      await login('grace', 'secret-pass-1').expect(401);
      await login('grace', 'brand-new-pass').expect(200);
    });
  });
});
