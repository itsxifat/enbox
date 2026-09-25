import type { z } from 'zod';
import { HttpError } from './errors.js';

/** A NUL character (PostgreSQL rejects it in text and jsonb) or an unpaired UTF-16 surrogate (jsonb rejects it). */
// eslint-disable-next-line no-control-regex -- matching NUL is the point
const UNSTORABLE = /\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/** Path of the first string (value or object key) in `value` that PostgreSQL cannot store, or null. */
function findUnstorable(value: unknown, path: (string | number)[] = [], depth = 0): (string | number)[] | null {
  if (typeof value === 'string') return UNSTORABLE.test(value) ? path : null;
  if (value === null || typeof value !== 'object' || depth > 32) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const found = findUnstorable(value[i], [...path, i], depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (value instanceof Date) return null;
  for (const [key, v] of Object.entries(value)) {
    if (UNSTORABLE.test(key)) return [...path, key];
    const found = findUnstorable(v, [...path, key], depth + 1);
    if (found) return found;
  }
  return null;
}

/**
 * Parse `input` with a zod schema, throwing `400 validation_error` with zod issues on failure.
 * Use for req.body, req.query, req.params and socket payloads. Strings containing a NUL
 * character or an unpaired surrogate are rejected too (anywhere in the parsed value): the
 * database cannot store them, so they must never reach a query (they would be 500s).
 */
export function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path?.length ? `${first.path.join('.')}: ` : '';
    throw new HttpError(400, 'validation_error', `${where}${first?.message ?? 'Invalid input'}`, result.error.issues);
  }
  const bad = findUnstorable(result.data);
  if (bad) {
    const where = bad.length ? `${bad.join('.')}: ` : '';
    throw new HttpError(400, 'validation_error', `${where}Invalid characters`, [{ code: 'custom', path: bad, message: 'Invalid characters' }]);
  }
  return result.data;
}

const MIN_STORABLE_MS = Date.parse('0001-01-01T00:00:00.000Z');
const MAX_STORABLE_MS = Date.parse('9999-12-31T23:59:59.999Z');

/**
 * A validated ISO datetime as a Date the database can store: `z.iso.datetime` accepts year
 * 0000 and offsets that push a 9999 date into year 10000, which the drivers' ISO encoding
 * turns into a Postgres error (500). Out of range → `400 validation_error` on `field`.
 */
export function storableDate(iso: string, field: string): Date {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms) || ms < MIN_STORABLE_MS || ms > MAX_STORABLE_MS) {
    throw new HttpError(400, 'validation_error', `${field}: Date out of range`, [{ code: 'custom', path: [field], message: 'Date out of range' }]);
  }
  return new Date(ms);
}
