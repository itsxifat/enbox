/**
 * TOTP (RFC 6238) on `node:crypto` only: HMAC-SHA1, 30-second steps, 6 digits. Secrets are 20
 * random bytes, base32-encoded (RFC 4648, no padding) — what authenticator apps expect.
 *
 * `verifyTotp` accepts the previous, current and next step (clock drift) and returns the step
 * that matched, so the caller can store it and refuse that step (and older ones) next time:
 * a code works once.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

export const TOTP_PERIOD_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted on either side of the current one. */
export const TOTP_WINDOW = 1;
const SECRET_BYTES = 20;
const ISSUER = 'Enbox';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** RFC 4648 base32 without padding. */
export function base32Encode(bytes: Uint8Array): string {
  let out = '';
  let value = 0;
  let bits = 0;
  for (const byte of bytes) {
    value = ((value << 8) | byte) & 0xffff;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Inverse of `base32Encode` (case-insensitive; padding, spaces and dashes ignored). */
export function base32Decode(input: string): Buffer {
  const s = input.toUpperCase().replace(/[\s=-]/g, '');
  const out: number[] = [];
  let value = 0;
  let bits = 0;
  for (const ch of s) {
    const index = BASE32.indexOf(ch);
    if (index < 0) throw new Error('Invalid base32 string');
    value = ((value << 5) | index) & 0xffff;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new secret: 20 random bytes as base32 (32 characters). */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(SECRET_BYTES));
}

/** HOTP (RFC 4226) value of `counter`, zero-padded to `digits`. */
export function hotp(key: Uint8Array, counter: number, digits = TOTP_DIGITS): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', key).update(message).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const binary =
    ((mac[offset]! & 0x7f) << 24) |
    (mac[offset + 1]! << 16) |
    (mac[offset + 2]! << 8) |
    mac[offset + 3]!;
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/** The 30-second step at `timeMs`. */
export function totpStep(timeMs = Date.now()): number {
  return Math.floor(timeMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The code for a base32 secret at `step` (tests and the RFC vectors use `digits`). */
export function totpCode(secret: string, step: number, digits = TOTP_DIGITS): string {
  return hotp(base32Decode(secret), step, digits);
}

/**
 * The step `code` is valid for (current ±TOTP_WINDOW), or null. Steps ≤ `lastStep` are
 * refused (already used). Every candidate is compared in constant time.
 */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { now?: number; lastStep?: number | null } = {},
): number | null {
  if (code.length !== TOTP_DIGITS || !/^\d+$/.test(code)) return null;
  const key = base32Decode(secret);
  const given = Buffer.from(code);
  const current = totpStep(opts.now);
  let matched: number | null = null;
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    const ok = timingSafeEqual(Buffer.from(hotp(key, step)), given);
    const fresh = opts.lastStep == null || step > opts.lastStep;
    if (ok && fresh && matched === null) matched = step;
  }
  return matched;
}

/**
 * `otpauth://` URL for authenticator apps (Key Uri Format), label and issuer URL-encoded:
 * `otpauth://totp/Enbox:<account>?secret=…&issuer=Enbox&algorithm=SHA1&digits=6&period=30`.
 */
export function otpauthUrl(account: string, secret: string): string {
  const issuer = encodeURIComponent(ISSUER);
  return (
    `otpauth://totp/${issuer}:${encodeURIComponent(account)}` +
    `?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_PERIOD_SECONDS}`
  );
}
