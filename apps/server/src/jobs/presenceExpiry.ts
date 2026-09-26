/**
 * Presence expiry (every minute, docs "Jobs" / "Users, privacy and presence"): availability
 * choices past `availability_until` revert to `online` and presence notes past
 * `presence_note_expires_at` are cleared, in batches of 500 (`FOR UPDATE SKIP LOCKED`, like
 * the status expiry). Viewers already see the expired values as gone (`effectiveAvailability`,
 * `activePresenceNote`); the job makes the rows agree and, per user, re-evaluates their
 * presence subscribers and emits `me:updated` → user:<id> so their devices drop the choice.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { reevaluatePresence } from '../modules/users/presence.js';
import { emitToUser } from '../realtime/emit.js';
import { rawRows, uniq } from '../services/sql.js';
import { getUserRows, toUserSelf } from '../services/users.js';
import { registerJob } from './index.js';

/** Users whose availability choice or note just expired; returns how many were touched. */
export async function expirePresence(opts: { batchSize?: number } = {}): Promise<number> {
  const batch = opts.batchSize ?? 500;
  let total = 0;
  const statements = [
    sql`update users set availability = 'online', availability_until = null, updated_at = now()
        where id in (
          select id from users where availability_until <= now()
          order by availability_until limit ${batch} for update skip locked
        ) returning id`,
    sql`update users set presence_note_text = null, presence_note_emoji = null,
          presence_note_expires_at = null, updated_at = now()
        where id in (
          select id from users where presence_note_expires_at <= now()
          order by presence_note_expires_at limit ${batch} for update skip locked
        ) returning id`,
  ];
  for (const statement of statements) {
    for (;;) {
      const rows = await rawRows<{ id: string }>(db, statement);
      await notifyExpired(rows.map((r) => r.id));
      total += rows.length;
      if (rows.length < batch) break;
    }
  }
  return total;
}

/** After the batch committed: presence re-evaluation + `me:updated` for each user. */
async function notifyExpired(userIds: string[]): Promise<void> {
  const ids = uniq(userIds);
  if (ids.length === 0) return;
  const rows = await getUserRows(db, ids);
  for (const id of ids) {
    void reevaluatePresence(id);
    const row = rows.get(id);
    if (row && !row.deletedAt) emitToUser(id, 'me:updated', { user: toUserSelf(row) });
  }
}

registerJob({
  name: 'presence-expiry',
  intervalMs: 60_000,
  run: async () => void (await expirePresence()),
});
