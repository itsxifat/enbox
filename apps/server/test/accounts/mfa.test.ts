import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  BACKUP_CODE_COUNT,
  type AuthResponse,
  type BackupCodes,
  type MfaChallenge,
  type SessionInfo,
  type TotpSetup,
  type UserSelf,
} from '@enbox/shared';
import { config } from '../../src/config.js';
import { db } from '../../src/db/index.js';
import { sessions, userBackupCodes, users } from '../../src/db/schema.js';
import { resetUserLimits } from '../../src/lib/userLimit.js';
import {
  LOGIN_TICKET_TTL_MS,
  backupCodeHash,
  generateBackupCodes,
  issueLoginTicket,
  normalizeBackupCode,
} from '../../src/modules/mfa/service.js';
import {
  base32Decode,
  base32Encode,
  generateTotpSecret,
  otpauthUrl,
  totpCode,
  totpStep,
  verifyTotp,
} from '../../src/modules/mfa/totp.js';
import {
  sleep,
  startTestServer,
  waitForEvent,
  type TestServer,
  type TestUser,
} from '../helpers.js';
import { newDevice } from './util.js';

// RFC 6238 appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

describe('TOTP (RFC 6238) primitives', () => {
  it('base32 follows RFC 4648 (no padding) and round-trips', () => {
    const vectors: [string, string][] = [
      ['', ''],
      ['f', 'MY'],
      ['fo', 'MZXQ'],
      ['foo', 'MZXW6'],
      ['foob', 'MZXW6YQ'],
      ['fooba', 'MZXW6YTB'],
      ['foobar', 'MZXW6YTBOI'],
    ];
    for (const [plain, encoded] of vectors) {
      expect(base32Encode(Buffer.from(plain))).toBe(encoded);
      expect(base32Decode(encoded).toString()).toBe(plain);
    }
    expect(base32Decode('mzxw 6ytb-oi======').toString()).toBe('foobar');
    expect(() => base32Decode('MZ1W')).toThrow();
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });

  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 SHA-1 vector at T=%i', (seconds, expected) => {
    const step = totpStep(seconds * 1000);
    expect(totpCode(RFC_SECRET, step, 8)).toBe(expected);
    // The 6-digit code (what apps show) is the same value modulo 10^6.
    expect(totpCode(RFC_SECRET, step)).toBe(expected.slice(2));
  });

  it('accepts the previous, current and next step only, and never a step ≤ the last used one', () => {
    const now = 1_111_111_111_000; // 1111111111 s: 21 s into its step
    const step = totpStep(now);
    const code = (s: number) => totpCode(RFC_SECRET, s);
    expect(verifyTotp(RFC_SECRET, code(step), { now })).toBe(step);
    expect(verifyTotp(RFC_SECRET, code(step - 1), { now })).toBe(step - 1);
    expect(verifyTotp(RFC_SECRET, code(step + 1), { now })).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, code(step - 2), { now })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code(step + 2), { now })).toBeNull();
    // A code works once: the stored step and older ones are refused.
    expect(verifyTotp(RFC_SECRET, code(step), { now, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code(step - 1), { now, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, code(step + 1), { now, lastStep: step })).toBe(step + 1);
    expect(verifyTotp(RFC_SECRET, code(step), { now, lastStep: step - 1 })).toBe(step);
    for (const bad of ['', '12345', '1234567', 'abcdef', '１２３４５６'])
      expect(verifyTotp(RFC_SECRET, bad, { now })).toBeNull();
  });

  it('makes 20-byte base32 secrets and otpauth URLs authenticator apps accept', () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
    expect(generateTotpSecret()).not.toBe(secret);
    expect(otpauthUrl('ada.l', 'JBSWY3DPEHPK3PXP')).toBe(
      'otpauth://totp/Enbox:ada.l?secret=JBSWY3DPEHPK3PXP&issuer=Enbox&algorithm=SHA1&digits=6&period=30',
    );
    expect(otpauthUrl('a b/c', 'X')).toContain('/Enbox:a%20b%2Fc?');
  });

  it('makes distinct xxxx-xxxx backup codes and hashes them normalized, per user', () => {
    const codes = generateBackupCodes();
    expect(codes).toHaveLength(BACKUP_CODE_COUNT);
    expect(new Set(codes).size).toBe(BACKUP_CODE_COUNT);
    for (const c of codes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);
    expect(normalizeBackupCode(' ABCD-1234 ')).toBe('abcd1234');
    const id = crypto.randomUUID();
    expect(backupCodeHash(id, 'abcd-1234')).toBe(backupCodeHash(id, 'ABCD1234'));
    expect(backupCodeHash(id, 'abcd-1234')).not.toBe(
      backupCodeHash(crypto.randomUUID(), 'abcd-1234'),
    );
    expect(backupCodeHash(id, 'abcd-1234')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('two-factor sign-in', () => {
  let t: TestServer;

  beforeAll(async () => {
    t = await startTestServer();
  });
  afterAll(() => t.close());

  const UA_LOGIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0 Safari/537.36';

  function login(u: TestUser, extra: Record<string, unknown> = {}) {
    return t
      .api()
      .post('/api/auth/login')
      .set('User-Agent', UA_LOGIN)
      .send({ identifier: u.username, password: u.password, ...extra });
  }

  async function challenge(
    u: TestUser,
    extra: Record<string, unknown> = {},
  ): Promise<MfaChallenge> {
    const body = (await login(u, extra).expect(200)).body as MfaChallenge;
    expect(body.mfaRequired).toBe(true);
    return body;
  }

  function loginMfa(ticket: string, code: string) {
    return t.api().post('/api/auth/login/mfa').set('User-Agent', UA_LOGIN).send({ ticket, code });
  }

  async function setup(u: TestUser): Promise<TotpSetup> {
    return (await t.api(u).post('/api/me/mfa/totp/setup').expect(200)).body as TotpSetup;
  }

  /** Turn two-factor on through the API; returns the secret and the backup codes. */
  async function enable(u: TestUser): Promise<{ secret: string; codes: string[] }> {
    const { secret } = await setup(u);
    const res = await t
      .api(u)
      .post('/api/me/mfa/totp/enable')
      .send({ code: totpCode(secret, totpStep()) })
      .expect(200);
    return { secret, codes: (res.body as BackupCodes).codes };
  }

  /** A code the server takes right now: forget the last used step, then the current code. */
  async function freshCode(u: TestUser, secret: string): Promise<string> {
    await db.update(users).set({ totpLastStep: null }).where(eq(users.id, u.id));
    return totpCode(secret, totpStep());
  }

  /** Wait until enough of the current 30-second step is left for codes computed now. */
  async function midStep(marginMs = 5_000): Promise<void> {
    const left = 30_000 - (Date.now() % 30_000);
    if (left < marginMs) await sleep(left + 50);
  }

  async function sessionCount(userId: string): Promise<number> {
    return (await db.select().from(sessions).where(eq(sessions.userId, userId))).length;
  }

  async function row(userId: string) {
    const [r] = await db.select().from(users).where(eq(users.id, userId));
    return r!;
  }

  describe('setup and enable', () => {
    it('setup returns a pending secret and its otpauth URL; a new setup replaces it', async () => {
      const u = await t.createUser({ username: 'mfa.setup' });
      const res = await t.api(u).post('/api/me/mfa/totp/setup').expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const first = res.body as TotpSetup;
      expect(first.secret).toMatch(/^[A-Z2-7]{32}$/);
      expect(first.otpauthUrl).toBe(
        `otpauth://totp/Enbox:mfa.setup?secret=${first.secret}&issuer=Enbox&algorithm=SHA1&digits=6&period=30`,
      );
      expect(await row(u.id)).toMatchObject({ totpPendingSecret: first.secret, totpSecret: null });
      // Not on yet.
      expect(((await t.api(u).get('/api/me').expect(200)).body as UserSelf).mfaEnabled).toBe(false);
      expect((await login(u).expect(200)).body.token).toEqual(expect.any(String));

      const second = await setup(u);
      expect(second.secret).not.toBe(first.secret);
      expect((await row(u.id)).totpPendingSecret).toBe(second.secret);
      // The replaced secret's codes no longer confirm.
      const stale = await t
        .api(u)
        .post('/api/me/mfa/totp/enable')
        .send({ code: totpCode(first.secret, totpStep()) })
        .expect(400);
      expect(stale.body.error).toEqual({
        code: 'invalid_code',
        message: 'Invalid two-factor code',
      });
    });

    it('enable confirms the pending secret: on, backup codes once (stored hashed), mfaEnabled on /me and my other devices', async () => {
      const u = await t.createUser();
      const other = await newDevice(u, 'Phone');
      const sock = await t.connect(other);
      const { secret } = await setup(u);

      const wrong = await t.api(u).post('/api/me/mfa/totp/enable').send({ code: '000000' });
      // (A one-in-a-million collision with the real code would make this a 200.)
      expect(wrong.status).toBe(400);
      expect(wrong.body.error.code).toBe('invalid_code');
      await t.api(u).post('/api/me/mfa/totp/enable').send({ code: '12ab56' }).expect(400);

      const updated = waitForEvent(sock, 'me:updated', { filter: (p) => !!p.user.mfaEnabled });
      const res = await t
        .api(u)
        .post('/api/me/mfa/totp/enable')
        .send({ code: totpCode(secret, totpStep()) })
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const { codes } = res.body as BackupCodes;
      expect(codes).toHaveLength(BACKUP_CODE_COUNT);
      for (const c of codes) expect(c).toMatch(/^[a-z0-9]{4}-[a-z0-9]{4}$/);

      const r = await row(u.id);
      expect(r).toMatchObject({ totpSecret: secret, totpPendingSecret: null });
      expect(r.totpEnabledAt).toBeInstanceOf(Date);
      const stored = await db
        .select()
        .from(userBackupCodes)
        .where(eq(userBackupCodes.userId, u.id));
      expect(stored.map((s) => s.codeHash).sort()).toEqual(
        codes.map((c) => backupCodeHash(u.id, c)).sort(),
      );
      expect(JSON.stringify(stored)).not.toContain(codes[0]!);

      const me = (await t.api(u).get('/api/me').expect(200)).body as UserSelf;
      expect(me.mfaEnabled).toBe(true);
      const pushed = await updated;
      expect(pushed.user).toMatchObject({ id: u.id, mfaEnabled: true });
      expect(JSON.stringify(pushed)).not.toContain(secret);

      // Already on: no new setup or enable.
      await t.api(u).post('/api/me/mfa/totp/setup').expect(409);
      await t
        .api(u)
        .post('/api/me/mfa/totp/enable')
        .send({ code: totpCode(secret, totpStep() + 1) })
        .expect(409);
    });

    it('enable without a setup is 409; bodies are validated', async () => {
      const u = await t.createUser();
      const res = await t
        .api(u)
        .post('/api/me/mfa/totp/enable')
        .send({ code: '123456' })
        .expect(409);
      expect(res.body.error.code).toBe('conflict');
      for (const body of [{}, { code: '12345' }, { code: 'abcd-1234' }, { code: 1234567 }])
        await t.api(u).post('/api/me/mfa/totp/enable').send(body).expect(400);
      await t.api().post('/api/me/mfa/totp/setup').expect(401);
    });

    it("the confirming code is used up: it can't log in afterwards", async () => {
      const u = await t.createUser();
      const { secret } = await setup(u);
      await midStep();
      const code = totpCode(secret, totpStep());
      await t.api(u).post('/api/me/mfa/totp/enable').send({ code }).expect(200);
      const { ticket } = await challenge(u);
      const replay = await loginMfa(ticket, code).expect(400);
      expect(replay.body.error.code).toBe('invalid_code');
    });
  });

  describe('login', () => {
    it('accounts without two-factor log in exactly as before', async () => {
      const u = await t.createUser();
      const body = (await login(u).expect(200)).body as AuthResponse;
      expect(Object.keys(body).sort()).toEqual(['token', 'user']);
      expect(body.user).toMatchObject({ id: u.id, mfaEnabled: false });
    });

    it('with two-factor on, the password step answers an MfaChallenge and creates no session', async () => {
      const u = await t.createUser();
      await enable(u);
      const before = await sessionCount(u.id);
      const res = await login(u, { deviceName: 'Laptop' }).expect(200);
      const body = res.body as MfaChallenge;
      expect(Object.keys(body).sort()).toEqual(['expiresAt', 'mfaRequired', 'ticket']);
      expect(body.mfaRequired).toBe(true);
      expect(body.ticket).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
      const ttl = Date.parse(body.expiresAt) - Date.now();
      expect(ttl).toBeGreaterThan(LOGIN_TICKET_TTL_MS - 10_000);
      expect(ttl).toBeLessThanOrEqual(LOGIN_TICKET_TTL_MS);
      expect(await sessionCount(u.id)).toBe(before);
      // A wrong password is still the plain 401, never a challenge.
      const wrong = await login({ ...u, password: 'not-the-password' }).expect(401);
      expect(wrong.body.error.code).toBe('unauthorized');
    });

    it('ticket + TOTP code → a session like the login would have made (device name, client info)', async () => {
      const u = await t.createUser();
      const { secret } = await enable(u);
      const { ticket } = await challenge(u, { deviceName: 'Work laptop' });
      const ua = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) Safari/605.1.15';
      const res = await t
        .api()
        .post('/api/auth/login/mfa')
        .set('User-Agent', ua)
        .send({ ticket, code: await freshCode(u, secret) })
        .expect(200);
      const body = res.body as AuthResponse;
      expect(body.user).toMatchObject({ id: u.id, mfaEnabled: true });
      const list = (await t.api({ token: body.token }).get('/api/auth/sessions').expect(200))
        .body as SessionInfo[];
      expect(list[0]).toMatchObject({ current: true, deviceName: 'Work laptop', userAgent: ua });
      // Without a device name the session is named after the browser, as at login.
      const second = await challenge(u);
      const res2 = await loginMfa(second.ticket, await freshCode(u, secret)).expect(200);
      const list2 = (await t.api({ token: res2.body.token }).get('/api/auth/sessions').expect(200))
        .body as SessionInfo[];
      expect(list2[0]).toMatchObject({ current: true, deviceName: 'Chrome on Windows' });
    });

    it('a TOTP code works once, and the ±1 step window works', async () => {
      const u = await t.createUser();
      const { secret } = await enable(u);
      const { ticket } = await challenge(u);
      await midStep();
      await db.update(users).set({ totpLastStep: null }).where(eq(users.id, u.id));
      const now = totpStep();
      // The previous step (clock behind), then the next one (clock ahead).
      await loginMfa(ticket, totpCode(secret, now - 1)).expect(200);
      await loginMfa(ticket, totpCode(secret, now + 1)).expect(200);
      expect((await row(u.id)).totpLastStep).toBe(now + 1);
      // Every step ≤ the last accepted one is refused, and so is anything outside the window.
      for (const s of [now - 1, now, now + 1, now - 2, now + 2]) {
        const res = await loginMfa(ticket, totpCode(secret, s)).expect(400);
        expect(res.body.error).toEqual({
          code: 'invalid_code',
          message: 'Invalid two-factor code',
        });
      }
    });

    it('two concurrent logins with the same code: exactly one wins', async () => {
      const u = await t.createUser();
      const { secret } = await enable(u);
      const [a, b] = [await challenge(u), await challenge(u)];
      const code = await freshCode(u, secret);
      const statuses = (
        await Promise.all([loginMfa(a.ticket, code), loginMfa(b.ticket, code)])
      ).map((r) => r.status);
      expect(statuses.sort()).toEqual([200, 400]);
    });

    it('a backup code works once (any case, dash optional)', async () => {
      const u = await t.createUser();
      const { codes } = await enable(u);
      const { ticket } = await challenge(u);
      const [first, second, third] = codes as [string, string, string];
      const before = await sessionCount(u.id);
      const res = await loginMfa(ticket, first).expect(200);
      expect((res.body as AuthResponse).user.id).toBe(u.id);
      expect(await sessionCount(u.id)).toBe(before + 1);
      const [used] = await db
        .select()
        .from(userBackupCodes)
        .where(eq(userBackupCodes.codeHash, backupCodeHash(u.id, first)));
      expect(used!.usedAt).toBeInstanceOf(Date);
      const again = await loginMfa(ticket, first).expect(400);
      expect(again.body.error.code).toBe('invalid_code');
      await loginMfa(ticket, second.toUpperCase()).expect(200);
      await loginMfa(ticket, third.replace('-', '')).expect(200);
      // Unknown codes, and somebody else's.
      await loginMfa(ticket, 'zzzz-zzzz').expect(400);
      const other = await t.createUser();
      const { codes: theirs } = await enable(other);
      await loginMfa(ticket, theirs[0]!).expect(400);
    });

    it('the same backup code used twice at once: exactly one wins', async () => {
      const u = await t.createUser();
      const { codes } = await enable(u);
      const { ticket } = await challenge(u);
      const statuses = (
        await Promise.all([loginMfa(ticket, codes[0]!), loginMfa(ticket, codes[0]!)])
      ).map((r) => r.status);
      expect(statuses.sort()).toEqual([200, 400]);
    });

    it('forged, malformed and expired tickets are refused with 401 "Your login timed out"', async () => {
      const u = await t.createUser();
      const { secret } = await enable(u);
      const other = await t.createUser();
      await enable(other);
      const { ticket } = await challenge(u);
      const [payload, signature] = ticket.split('.') as [string, string];
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as {
        userId: string;
        exp: number;
      };
      const encode = (d: unknown) => Buffer.from(JSON.stringify(d)).toString('base64url');
      const r = await row(u.id);
      const forged = [
        // Payload changed, signature kept: a longer life, someone else's account.
        `${encode({ ...data, exp: data.exp + 3_600_000 })}.${signature}`,
        `${encode({ ...data, userId: other.id })}.${signature}`,
        // Signed with a key that isn't the user's.
        `${payload}.${createHmac('sha256', 'guess').update(payload).digest('base64url')}`,
        `${payload}.${createHmac('sha256', r.passwordHash).update(payload).digest('base64url')}`,
        // Malformed.
        `${payload}.${signature}.extra`,
        `${payload}${signature}`,
        `${encode({ userId: 'not-a-uuid', exp: data.exp })}.${signature}`,
        `${Buffer.from('not json').toString('base64url')}.${signature}`,
        // Expired, though properly signed.
        issueLoginTicket(
          { id: u.id, passwordHash: r.passwordHash, totpSecret: r.totpSecret! },
          undefined,
          Date.now() - LOGIN_TICKET_TTL_MS - 1_000,
        ).ticket,
      ];
      for (const bad of forged) {
        const res = await loginMfa(bad, await freshCode(u, secret)).expect(401);
        expect(res.body.error).toEqual({
          code: 'unauthorized',
          message: 'Your login timed out. Log in again.',
        });
      }
      // The real one still works (nothing above used up the code).
      await loginMfa(ticket, await freshCode(u, secret)).expect(200);
      // Validation comes first.
      await loginMfa('short', '123456').expect(400);
      await loginMfa(ticket, '12345').expect(400);
      await t.api().post('/api/auth/login/mfa').send({}).expect(400);
    });

    it('a password change kills open tickets; so does turning two-factor off (and on again)', async () => {
      const u = await t.createUser();
      const { secret } = await enable(u);
      const open = await challenge(u);
      await t
        .api(u)
        .post('/api/auth/change-password')
        .send({ currentPassword: u.password, newPassword: 'brand-new-pass' })
        .expect(204);
      await loginMfa(open.ticket, await freshCode(u, secret)).expect(401);
      const changed = { ...u, password: 'brand-new-pass' };
      const fresh = await challenge(changed);
      await t
        .api(u)
        .post('/api/me/mfa/totp/disable')
        .send({ code: await freshCode(u, secret) })
        .expect(204);
      await loginMfa(fresh.ticket, '123456').expect(401);
      const again = await enable(changed);
      await loginMfa(fresh.ticket, await freshCode(u, again.secret)).expect(401);
      await loginMfa((await challenge(changed)).ticket, await freshCode(u, again.secret)).expect(
        200,
      );
    });

    it('deleted accounts: open tickets stop working', async () => {
      const u = await t.createUser();
      const { secret, codes } = await enable(u);
      const { ticket } = await challenge(u);
      await t.api(u).delete('/api/me').send({ password: u.password, code: codes[0] }).expect(204);
      await loginMfa(ticket, totpCode(secret, totpStep() + 1)).expect(401);
      expect(
        await db.select().from(userBackupCodes).where(eq(userBackupCodes.userId, u.id)),
      ).toEqual([]);
    });

    it('limits code attempts per user (5 a minute), counted only once the ticket checked out', async () => {
      const u = await t.createUser();
      const { secret } = await enable(u);
      const { ticket } = await challenge(u);
      const [payload] = ticket.split('.') as [string];
      config.rateLimit = true;
      resetUserLimits();
      try {
        // Forged tickets for this user don't use up their attempts.
        for (let i = 0; i < 3; i++) await loginMfa(`${payload}.forged${i}`, '000000').expect(401);
        const wrong = totpCode(secret, totpStep() + 5);
        for (let i = 0; i < 5; i++) await loginMfa(ticket, wrong).expect(400);
        const limited = await loginMfa(ticket, await freshCode(u, secret)).expect(429);
        expect(limited.body.error.code).toBe('rate_limited');
      } finally {
        config.rateLimit = false;
        resetUserLimits();
      }
      await loginMfa(ticket, await freshCode(u, secret)).expect(200);
    });
  });

  describe('disable and backup codes', () => {
    it('disable takes a current code: everything cleared, mfaEnabled off on my devices, plain logins again', async () => {
      const u = await t.createUser();
      const other = await newDevice(u, 'Tablet');
      const sock = await t.connect(other);
      const { secret } = await enable(u);
      const wrong = await t
        .api(u)
        .post('/api/me/mfa/totp/disable')
        .send({ code: totpCode(secret, totpStep() + 5) })
        .expect(400);
      expect(wrong.body.error.code).toBe('invalid_code');
      await t.api(u).post('/api/me/mfa/totp/disable').send({ code: 'nope' }).expect(400);

      const updated = waitForEvent(sock, 'me:updated', {
        filter: (p) => p.user.mfaEnabled === false,
      });
      await t
        .api(u)
        .post('/api/me/mfa/totp/disable')
        .send({ code: await freshCode(u, secret) })
        .expect(204);
      expect((await updated).user.mfaEnabled).toBe(false);
      expect(await row(u.id)).toMatchObject({
        totpSecret: null,
        totpPendingSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
      });
      expect(
        await db.select().from(userBackupCodes).where(eq(userBackupCodes.userId, u.id)),
      ).toEqual([]);
      expect(((await t.api(u).get('/api/me').expect(200)).body as UserSelf).mfaEnabled).toBe(false);
      expect((await login(u).expect(200)).body.token).toEqual(expect.any(String));
      // Already off.
      await t.api(u).post('/api/me/mfa/totp/disable').send({ code: '123456' }).expect(409);
    });

    it('disable takes an unused backup code (not a used one)', async () => {
      const u = await t.createUser();
      const { codes } = await enable(u);
      await loginMfa((await challenge(u)).ticket, codes[0]!).expect(200);
      await t.api(u).post('/api/me/mfa/totp/disable').send({ code: codes[0] }).expect(400);
      await t
        .api(u)
        .post('/api/me/mfa/totp/disable')
        .send({ code: codes[1]!.toUpperCase() })
        .expect(204);
      expect((await row(u.id)).totpSecret).toBeNull();
    });

    it('deleting the account needs a second factor too, and refuses a wrong or used one', async () => {
      const u = await t.createUser();
      const { secret, codes } = await enable(u);
      const del = (body: Record<string, unknown>) => t.api(u).delete('/api/me').send(body);
      const missing = await del({ password: u.password }).expect(400);
      expect(missing.body.error.code).toBe('invalid_code');
      await del({ password: u.password, code: '000000' }).expect(400);
      await loginMfa((await challenge(u)).ticket, codes[0]!).expect(200);
      await del({ password: u.password, code: codes[0] }).expect(400);
      await del({ password: 'wrong-password', code: await freshCode(u, secret) }).expect(403);
      expect((await row(u.id)).deletedAt).toBeNull();
      resetUserLimits();
      await del({ password: u.password, code: await freshCode(u, secret) }).expect(204);
      expect((await row(u.id)).deletedAt).not.toBeNull();
    });

    it('regenerating needs my password and replaces every code', async () => {
      const u = await t.createUser();
      await t.api(u).post('/api/me/mfa/backup-codes').send({ password: u.password }).expect(409);
      const { codes: old } = await enable(u);

      const wrong = await t
        .api(u)
        .post('/api/me/mfa/backup-codes')
        .send({ password: 'not-my-password' })
        .expect(403);
      expect(wrong.body.error.code).toBe('forbidden');
      await t.api(u).post('/api/me/mfa/backup-codes').send({}).expect(400);

      const res = await t
        .api(u)
        .post('/api/me/mfa/backup-codes')
        .send({ password: u.password })
        .expect(200);
      expect(res.headers['cache-control']).toBe('no-store');
      const { codes } = res.body as BackupCodes;
      expect(codes).toHaveLength(BACKUP_CODE_COUNT);
      expect(codes.filter((c) => old.includes(c))).toEqual([]);
      const stored = await db
        .select()
        .from(userBackupCodes)
        .where(eq(userBackupCodes.userId, u.id));
      expect(stored).toHaveLength(BACKUP_CODE_COUNT);
      expect(stored.every((s) => s.usedAt === null)).toBe(true);

      // The old codes stop working; the new ones work.
      const { ticket } = await challenge(u);
      await loginMfa(ticket, old[1]!).expect(400);
      await loginMfa(ticket, codes[0]!).expect(200);
    });
  });

  it('no secret column reaches the wire', async () => {
    const u = await t.createUser();
    const viewer = await t.createUser();
    const sock = await t.connect(u);
    const updated = waitForEvent(sock, 'me:updated', { filter: (p) => !!p.user.mfaEnabled });
    const { secret, codes } = await enable(u);
    const { ticket } = await challenge(u);
    const bodies = [
      (await updated).user,
      (await t.api(u).get('/api/me').expect(200)).body,
      (await t.api(viewer).get(`/api/users/${u.id}`).expect(200)).body,
      (await loginMfa(ticket, await freshCode(u, secret)).expect(200)).body,
    ];
    for (const body of bodies) {
      const json = JSON.stringify(body);
      expect(json).not.toContain(secret);
      expect(json).not.toMatch(/totp|backup|passwordHash/i);
      for (const c of codes) expect(json).not.toContain(c);
    }
    expect(bodies[2]).not.toHaveProperty('mfaEnabled');
  });
});
