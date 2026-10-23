import { Router } from 'express';
import { eq } from 'drizzle-orm';
import {
  disableTotpSchema,
  enableTotpSchema,
  regenerateBackupCodesSchema,
  type BackupCodes,
  type TotpSetup,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { userBackupCodes, users } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { conflict, forbidden } from '../../lib/errors.js';
import { authLimiter } from '../../lib/rateLimit.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';
import { requireUser } from '../../services/users.js';
import { checkPassword } from '../auth/service.js';
import {
  assertCodeAttempt,
  consumeSecondFactor,
  invalidCode,
  lockMfaUser,
  meUpdatedEffect,
  replaceBackupCodes,
} from './service.js';
import { generateTotpSecret, otpauthUrl, verifyTotp } from './totp.js';

/**
 * Two-factor module — owns: /me/mfa/** (the login step, `POST /auth/login/mfa`, lives in
 * auth/routes.ts). Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind
 * requireAuth. Business rules: ./service.ts.
 *
 *   POST /me/mfa/totp/setup     a new pending secret + otpauth URL (409 when already on)
 *   POST /me/mfa/totp/enable    { code } for the pending secret → on, BackupCodes (once)
 *   POST /me/mfa/totp/disable   { code } TOTP or unused backup code → off, codes deleted
 *   POST /me/mfa/backup-codes   { password } → every code replaced, BackupCodes (once)
 *
 * Turning it on or off emits `me:updated` → my devices (`UserSelf.mfaEnabled`). Wrong codes
 * are `400 invalid_code`; a wrong password is `403 forbidden` (never 401). No secret column
 * is ever serialized.
 */
export const router = Router();

/** Start (or restart) the setup: replaces any earlier pending secret. */
router.post('/me/mfa/totp/setup', async (req, res) => {
  const me = authUserId(req);
  const setup = await db.transaction(async (tx) => {
    const user = await lockMfaUser(tx, me);
    if (user.totpSecret) throw conflict('Two-factor authentication is already on');
    const secret = generateTotpSecret();
    await tx.update(users).set({ totpPendingSecret: secret }).where(eq(users.id, me));
    const out: TotpSetup = { secret, otpauthUrl: otpauthUrl(user.username, secret) };
    return out;
  });
  res.set('Cache-Control', 'no-store');
  res.json(setup);
});

/** Confirm the pending secret with a first code: two-factor on, fresh backup codes. */
router.post('/me/mfa/totp/enable', async (req, res) => {
  const me = authUserId(req);
  const { code } = parse(enableTotpSchema, req.body ?? {});
  assertCodeAttempt(me);
  const codes = await transact(async (tx, fx) => {
    const user = await lockMfaUser(tx, me);
    if (user.totpSecret) throw conflict('Two-factor authentication is already on');
    if (!user.totpPendingSecret) throw conflict('Set up your authenticator app first');
    const step = verifyTotp(user.totpPendingSecret, code, { lastStep: user.totpLastStep });
    if (step === null) throw invalidCode();
    const now = new Date();
    await tx
      .update(users)
      .set({
        totpSecret: user.totpPendingSecret,
        totpPendingSecret: null,
        totpEnabledAt: now,
        // The confirming code is used up: it can't log in afterwards.
        totpLastStep: step,
        updatedAt: now,
      })
      .where(eq(users.id, me));
    const fresh = await replaceBackupCodes(tx, me);
    meUpdatedEffect(fx, me);
    return fresh;
  });
  const out: BackupCodes = { codes };
  res.set('Cache-Control', 'no-store');
  res.json(out);
});

/** Turn it off with a current code or an unused backup code. */
router.post('/me/mfa/totp/disable', async (req, res) => {
  const me = authUserId(req);
  const { code } = parse(disableTotpSchema, req.body ?? {});
  assertCodeAttempt(me);
  await transact(async (tx, fx) => {
    const user = await lockMfaUser(tx, me);
    if (!user.totpSecret) throw conflict('Two-factor authentication is off');
    if (!(await consumeSecondFactor(tx, user, code))) throw invalidCode();
    await tx
      .update(users)
      .set({
        totpSecret: null,
        totpPendingSecret: null,
        totpEnabledAt: null,
        totpLastStep: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, me));
    await tx.delete(userBackupCodes).where(eq(userBackupCodes.userId, me));
    meUpdatedEffect(fx, me);
  });
  res.status(204).end();
});

/** New backup codes (the old ones stop working); needs my password, like the login does. */
router.post('/me/mfa/backup-codes', authLimiter, async (req, res) => {
  const me = authUserId(req);
  const { password } = parse(regenerateBackupCodesSchema, req.body ?? {});
  if (!(await checkPassword(await requireUser(db, me), password)))
    throw forbidden('Your password is incorrect');
  const codes = await db.transaction(async (tx) => {
    const user = await lockMfaUser(tx, me);
    if (!user.totpSecret) throw conflict('Two-factor authentication is off');
    return replaceBackupCodes(tx, me);
  });
  const out: BackupCodes = { codes };
  res.set('Cache-Control', 'no-store');
  res.json(out);
});
