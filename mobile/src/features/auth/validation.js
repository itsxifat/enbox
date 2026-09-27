/**
 * Client-side form helpers for auth/profile forms (agent 1). Server rules come from the
 * shared zod schemas; these add UX on top (live hints, strength meter).
 */
import { PASSWORD_MIN_LENGTH, phoneSchema, usernameSchema } from '@enbox/shared';

const COMMON = new Set([
  'password',
  'password1',
  'password123',
  '12345678',
  '123456789',
  '1234567890',
  'qwerty123',
  'qwertyuiop',
  'iloveyou',
  'abcdefgh',
  '11111111',
  'letmein1',
  'welcome1',
  'enbox123',
]);

/** A simple, dependency-free strength estimate for the register/change-password forms. */
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '' };
  if (pw.length < PASSWORD_MIN_LENGTH) return { score: 0, label: 'Too short' };
  const lower = pw.toLowerCase();
  if (COMMON.has(lower) || /^(.)\1+$/.test(pw) || /^(?:0123456789|abcdefghij)/.test(lower))
    return { score: 1, label: 'Too common' };
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(pw)).length;
  let score = 1;
  if (classes >= 2) score += 1;
  if (classes >= 3) score += 1;
  if (pw.length >= 12) score += 1;
  if (pw.length >= 16 && classes >= 2) score += 1;
  const s = Math.min(4, score);
  return { score: s, label: ['', 'Weak', 'Fair', 'Good', 'Strong'][s] };
}

/** Live username check: null when valid, else the (shared) validation message. */
export function usernameIssue(value) {
  if (!value) return null;
  const r = usernameSchema.safeParse(value);
  return r.success ? null : (r.error.issues[0]?.message ?? 'Invalid username');
}

/** Normalise what the user types into a username field (lowercase, no spaces, no '@'). */
export function normalizeUsernameInput(value) {
  return value.toLowerCase().replace(/\s/g, '').replace(/^@+/, '');
}

/** Canonical E.164 phone, or null when invalid. Blank → null too. */
export function canonicalPhone(value) {
  if (!value.trim()) return null;
  const r = phoneSchema.safeParse(value);
  return r.success ? r.data : null;
}
