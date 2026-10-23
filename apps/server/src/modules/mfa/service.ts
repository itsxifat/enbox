/**
 * Two-factor sign-in (docs "Accounts, sessions and deletion"): TOTP codes that work once,
 * backup codes, the stateless login ticket and the `me:updated` fan-out after a change.
 *
 * - TOTP: `verifyTotp` (./totp.ts) finds the step a code is valid for; the step is consumed
 *   with a compare-and-set on `users.totp_last_step`, so a code works once even when two
 *   requests race with it.
 * - Backup codes: `BACKUP_CODE_COUNT` codes `xxxx-xxxx` (a–z0–9, crypto randomness), stored as
 *   sha256 of `<userId>:<code without the dash>` (high-entropy codes: no slow hash needed) and
 *   returned once. One works once: `used_at` is set atomically.
 * - Login ticket (`MfaChallenge.ticket`): `base64url(JSON { userId, exp, deviceName })` + "." +
 *   base64url(HMAC-SHA256), keyed with the user's `password_hash + totp_secret`. No server
 *   state: a password change or turning two-factor off invalidates every open ticket.
 * - Code checks (login step, enable, disable) are limited per user (`MFA_LIMITS.code`).
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { z } from 'zod';
import { BACKUP_CODE_COUNT, idSchema, type MfaChallenge, type UserSelf } from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { userBackupCodes, users } from '../../db/schema.js';
import { sha256 } from '../../lib/crypto.js';
import { HttpError, notFound, unauthorized } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { emitToUser } from '../../realtime/emit.js';
import type { Effects } from '../../services/effects.js';
import { loadUserSelf } from '../../services/users.js';
import { verifyTotp } from './totp.js';

export const MFA_LIMITS = {
  /** Two-factor code checks (`POST /auth/login/mfa`, enable, disable), per user. */
  code: { limit: 5, windowMs: 60_000 },
} as const;

/** How long the login ticket of an `MfaChallenge` stays valid. */
export const LOGIN_TICKET_TTL_MS = 5 * 60_000;

/** `400 invalid_code`: the code is wrong, expired or already used. */
export function invalidCode(): HttpError {
  return new HttpError(400, 'invalid_code', 'Invalid two-factor code');
}

/** `401`: the ticket expired, was forged, or the password / two-factor changed since. */
export function loginTimedOut(): HttpError {
  return unauthorized('Your login timed out. Log in again.');
}

/** Count one code attempt for `userId` (`429 rate_limited` past `MFA_LIMITS.code`). */
export function assertCodeAttempt(userId: string): void {
  assertUserLimit(userId, 'mfaCode', MFA_LIMITS.code);
}

/** The two-factor columns of a user, as the checks below need them. */
export interface MfaUser {
  id: string;
  username: string;
  passwordHash: string;
  totpSecret: string | null;
  totpPendingSecret: string | null;
  totpLastStep: number | null;
  deletedAt: Date | null;
}

const mfaColumns = {
  id: users.id,
  username: users.username,
  passwordHash: users.passwordHash,
  totpSecret: users.totpSecret,
  totpPendingSecret: users.totpPendingSecret,
  totpLastStep: users.totpLastStep,
  deletedAt: users.deletedAt,
};

/**
 * Lock my users row for a two-factor change (`NO KEY UPDATE`, like profile changes: FK checks
 * of concurrent inserts referencing me aren't blocked). 404 when unknown or deleted.
 */
export async function lockMfaUser(tx: DbOrTx, userId: string): Promise<MfaUser> {
  const [row] = await tx
    .select(mfaColumns)
    .from(users)
    .where(eq(users.id, userId))
    .for('no key update');
  if (!row || row.deletedAt) throw notFound('User');
  return row;
}

// ---------------------------------------------------------------------------
// Backup codes
// ---------------------------------------------------------------------------

const BACKUP_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

function randomBackupCode(): string {
  let s = '';
  // randomInt is uniform (no modulo bias).
  for (let i = 0; i < 8; i++) s += BACKUP_ALPHABET[randomInt(BACKUP_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

/** `count` distinct fresh codes, `xxxx-xxxx`. */
export function generateBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  while (codes.size < count) codes.add(randomBackupCode());
  return [...codes];
}

/** ` ABCD-1234 ` → `abcd1234` (the dash is optional when typing one). */
export function normalizeBackupCode(code: string): string {
  return code.trim().toLowerCase().replace(/-/g, '');
}

export function backupCodeHash(userId: string, code: string): string {
  return sha256(`${userId}:${normalizeBackupCode(code)}`);
}

/** Replace every backup code of a user with fresh ones; returns them (shown once). */
export async function replaceBackupCodes(tx: DbOrTx, userId: string): Promise<string[]> {
  const codes = generateBackupCodes();
  await tx.delete(userBackupCodes).where(eq(userBackupCodes.userId, userId));
  await tx
    .insert(userBackupCodes)
    .values(codes.map((code) => ({ userId, codeHash: backupCodeHash(userId, code) })));
  return codes;
}

/** Mark an unused backup code used; false when it doesn't exist or was used already. */
async function consumeBackupCode(dbx: DbOrTx, userId: string, code: string): Promise<boolean> {
  const used = await dbx
    .update(userBackupCodes)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(userBackupCodes.userId, userId),
        eq(userBackupCodes.codeHash, backupCodeHash(userId, code)),
        isNull(userBackupCodes.usedAt),
      ),
    )
    .returning({ userId: userBackupCodes.userId });
  return used.length > 0;
}

// ---------------------------------------------------------------------------
// Second factor
// ---------------------------------------------------------------------------

/**
 * Check the second factor of a user with two-factor on, and use it up: a TOTP code (its step
 * is stored with a compare-and-set guarded by the secret, so it works once even under
 * concurrency, and never after the secret changed) or an unused backup code (marked used).
 * False when neither matches. `code` is already validated (6 digits, or a backup code).
 */
export async function consumeSecondFactor(
  dbx: DbOrTx,
  user: Pick<MfaUser, 'id' | 'totpSecret' | 'totpLastStep'>,
  code: string,
): Promise<boolean> {
  const secret = user.totpSecret;
  if (!secret) return false;
  if (!/^\d{6}$/.test(code)) return consumeBackupCode(dbx, user.id, code);
  const step = verifyTotp(secret, code, { lastStep: user.totpLastStep });
  if (step === null) return false;
  const consumed = await dbx
    .update(users)
    .set({ totpLastStep: step })
    .where(
      and(
        eq(users.id, user.id),
        eq(users.totpSecret, secret),
        or(isNull(users.totpLastStep), lt(users.totpLastStep, step)),
      ),
    )
    .returning({ id: users.id });
  return consumed.length > 0;
}

// ---------------------------------------------------------------------------
// Login ticket
// ---------------------------------------------------------------------------

const ticketPayloadSchema = z.object({
  userId: idSchema,
  exp: z.number().int().positive(),
  deviceName: z.string().max(100).optional(),
});
type TicketPayload = z.infer<typeof ticketPayloadSchema>;

/** base64url HMAC-SHA256 of the ticket's payload part. */
function ticketSignature(
  key: { passwordHash: string; totpSecret: string },
  payload: string,
): string {
  return createHmac('sha256', key.passwordHash + key.totpSecret)
    .update(payload)
    .digest('base64url');
}

/**
 * `POST /auth/login`'s answer for an account with two-factor on (after the password check):
 * a ticket for `POST /auth/login/mfa` that carries the login's device name.
 */
export function issueLoginTicket(
  user: { id: string; passwordHash: string; totpSecret: string },
  deviceName: string | undefined,
  now = Date.now(),
): MfaChallenge {
  const exp = now + LOGIN_TICKET_TTL_MS;
  const data: TicketPayload = { userId: user.id, exp, ...(deviceName ? { deviceName } : {}) };
  const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
  const signature = ticketSignature(user, payload);
  return {
    mfaRequired: true,
    ticket: `${payload}.${signature}`,
    expiresAt: new Date(exp).toISOString(),
  };
}

/**
 * The user (two-factor still on, not deleted) and device name of a valid, unexpired ticket.
 * Anything else — malformed, forged, expired, signed before a password change or before
 * two-factor was turned off and on again — is `401` "Your login timed out".
 */
export async function verifyLoginTicket(
  ticket: string,
): Promise<{ user: MfaUser; deviceName: string | undefined }> {
  const parts = ticket.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw loginTimedOut();
  const [payload, signature] = parts as [string, string];
  let data: TicketPayload;
  try {
    const parsed = ticketPayloadSchema.safeParse(
      JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')),
    );
    if (!parsed.success) throw loginTimedOut();
    data = parsed.data;
  } catch {
    throw loginTimedOut();
  }
  // Stale tickets are refused before any lookup (the answer is the same either way).
  if (data.exp <= Date.now()) throw loginTimedOut();
  const [user] = await db.select(mfaColumns).from(users).where(eq(users.id, data.userId)).limit(1);
  if (!user || user.deletedAt || !user.totpSecret) throw loginTimedOut();
  // Compared as the canonical base64url text, so no other spelling of the MAC passes.
  const expected = Buffer.from(
    ticketSignature({ passwordHash: user.passwordHash, totpSecret: user.totpSecret }, payload),
  );
  const given = Buffer.from(signature);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw loginTimedOut();
  return { user, deviceName: data.deviceName };
}

// ---------------------------------------------------------------------------
// Fan-out
// ---------------------------------------------------------------------------

/**
 * `me:updated { user }` → user:<me> with my profile as of the end of the transaction, so my
 * other devices see `mfaEnabled` change (the same event PATCH /me uses).
 */
export function meUpdatedEffect(fx: Effects, userId: string): Effects {
  let user: UserSelf | null = null;
  return fx.add(
    () => {
      if (user) emitToUser(userId, 'me:updated', { user });
    },
    async (dbx) => {
      user = await loadUserSelf(dbx, userId);
    },
  );
}
