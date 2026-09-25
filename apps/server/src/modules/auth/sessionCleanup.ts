/**
 * Session cleanup job (docs "Jobs"): delete expired sessions (push subscriptions cascade) in
 * batches, drop them from the token cache and disconnect any socket still using them.
 */
import { inArray, lte, sql } from 'drizzle-orm';
import { db } from '../../db/index.js';
import { sessions } from '../../db/schema.js';
import { registerJob } from '../../jobs/index.js';
import { disconnectSession } from '../../realtime/emit.js';
import { invalidateSessions } from '../../services/sessions.js';

const BATCH = 500;

/** Delete every expired session; returns how many were removed. */
export async function runSessionCleanup(now: Date = new Date()): Promise<number> {
  let total = 0;
  for (;;) {
    const expired = db
      .select({ id: sessions.id })
      .from(sessions)
      .where(lte(sessions.expiresAt, now))
      .limit(BATCH);
    const rows = await db
      .delete(sessions)
      .where(inArray(sessions.id, sql`(${expired})`))
      .returning({ id: sessions.id });
    const ids = rows.map((r) => r.id);
    if (ids.length) {
      invalidateSessions(ids);
      for (const id of ids) disconnectSession(id);
    }
    total += ids.length;
    if (ids.length < BATCH) return total;
  }
}

registerJob({
  name: 'session-cleanup',
  intervalMs: 60 * 60_000,
  run: async () => {
    await runSessionCleanup();
  },
});
