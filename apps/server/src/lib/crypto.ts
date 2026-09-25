import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { INVITE_CODE_ALPHABET, INVITE_CODE_LENGTH } from '@enbox/shared';

const scrypt = promisify(scryptCb) as (
  password: string,
  salt: Buffer,
  keylen: number,
  opts: object,
) => Promise<Buffer>;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const KEYLEN = 64;

/** Format: scrypt$N$r$p$saltB64$hashB64 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${SCRYPT_PARAMS.N}$${SCRYPT_PARAMS.r}$${SCRYPT_PARAMS.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, N, r, p, saltB64, hashB64] = parts as [string, string, string, string, string, string];
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** 256-bit random session token (base64url). */
export function generateToken(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * URL-safe, unambiguous invite code (INVITE_CODE_LENGTH chars ≈ 128 bits; matches
 * `inviteCodeSchema`). Codes share one space across chats and communities: callers retry
 * generation when the code already exists in either table.
 */
export function generateInviteCode(length = INVITE_CODE_LENGTH): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++)
    out += INVITE_CODE_ALPHABET[bytes[i]! % INVITE_CODE_ALPHABET.length];
  return out;
}
