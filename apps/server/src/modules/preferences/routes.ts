import { Router } from 'express';
import { eq } from 'drizzle-orm';
import {
  PREFERENCES_MAX_BYTES,
  preferencesPatchSchema,
  type SyncedPreferences,
} from '@enbox/shared';
import { db } from '../../db/index.js';
import { users } from '../../db/schema.js';
import { authUserId } from '../../http/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { assertUserLimit } from '../../lib/userLimit.js';
import { parse } from '../../lib/validate.js';
import { transact } from '../../services/effects.js';

/**
 * Synced preferences (everyday wave, agent 3): the device preferences I sync across devices.
 * Paths are relative to /api (see ApiRoutes in @enbox/shared); mounted behind requireAuth.
 *
 *   GET   /me/preferences   SyncedPreferences
 *   PATCH /me/preferences   SyncedPreferences: merge keys (null deletes); me:preferences → my devices
 *
 * The document is opaque to the server (the web client's DevicePrefs names and values). Every
 * real change moves `updatedAt` forward (strictly, so devices can order writes) and sends the
 * whole document to all my sockets; the device that saved it ignores the echo.
 */
export const router = Router();

/** Saves per user (clients batch their changes, at most about one a second). */
const SAVE_LIMIT = { limit: 120, windowMs: 60_000 } as const;

const columns = {
  prefs: users.preferences,
  updatedAt: users.preferencesUpdatedAt,
  deletedAt: users.deletedAt,
};

type Row = { prefs: Record<string, unknown> | null; updatedAt: Date | null };

function toDocument(row: Row): SyncedPreferences {
  return { prefs: row.prefs ?? {}, updatedAt: row.updatedAt?.toISOString() ?? null };
}

/** `current` with `patch` merged in (null deletes a key); own data properties only. */
export function mergePreferences(
  current: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const next = new Map(Object.entries(current));
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) next.delete(key);
    else next.set(key, value);
  }
  return Object.fromEntries(next);
}

// GET /me/preferences → SyncedPreferences (`{ prefs: {}, updatedAt: null }` until a first save).
router.get('/me/preferences', async (req, res) => {
  const me = authUserId(req);
  const [row] = await db.select(columns).from(users).where(eq(users.id, me));
  if (!row || row.deletedAt) throw notFound('User');
  res.json(toDocument(row));
});

// PATCH /me/preferences { [key]: value | null } → SyncedPreferences. 400 when the merged
// document would exceed PREFERENCES_MAX_BYTES. No change: the document as it is, no event.
router.patch('/me/preferences', async (req, res) => {
  const me = authUserId(req);
  const patch = parse(preferencesPatchSchema, req.body ?? {});
  assertUserLimit(me, 'preferences', SAVE_LIMIT);
  const doc = await transact(async (tx, fx) => {
    const [row] = await tx.select(columns).from(users).where(eq(users.id, me)).for('no key update');
    if (!row || row.deletedAt) throw notFound('User');
    const current = row.prefs ?? {};
    const prefs = mergePreferences(current, patch);
    const serialized = JSON.stringify(prefs);
    if (serialized.length > PREFERENCES_MAX_BYTES) throw badRequest('Too many preferences');
    if (serialized === JSON.stringify(current)) return toDocument(row);
    // Strictly after the previous save, even within the same millisecond.
    const updatedAt = new Date(Math.max(Date.now(), (row.updatedAt?.getTime() ?? 0) + 1));
    await tx
      .update(users)
      .set({ preferences: prefs, preferencesUpdatedAt: updatedAt })
      .where(eq(users.id, me));
    const next = toDocument({ prefs, updatedAt });
    fx.toUser(me, 'me:preferences', next);
    return next;
  });
  res.json(doc);
});
