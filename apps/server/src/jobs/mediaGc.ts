/**
 * Media GC (hourly, docs "Media" / "Jobs"): delete media rows — and their files, thumbnails
 * included — that no message, status, user, chat or community references and that are
 * older than ORPHAN_MEDIA_TTL_MS. Batches of 500 via `FOR UPDATE SKIP LOCKED`: a row being
 * referenced by an uncommitted transaction is KEY SHARE-locked (FK check /
 * `requireOwnedMedia`) and therefore skipped. Files are removed after the DELETE committed.
 */
import { sql } from 'drizzle-orm';
import { ORPHAN_MEDIA_TTL_MS } from '@enbox/shared';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { rawRows } from '../services/sql.js';
import { removeStoredFiles } from '../services/uploads.js';
import { registerJob } from './index.js';

export async function runMediaGc(opts: { ttlMs?: number; batchSize?: number } = {}): Promise<number> {
  const ttlMs = opts.ttlMs ?? ORPHAN_MEDIA_TTL_MS;
  const batch = opts.batchSize ?? 500;
  let total = 0;
  for (;;) {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    const rows = await rawRows<{ storage_key: string; thumbnail_key: string | null }>(
      db,
      sql`delete from media where id in (
            select m.id from media m
            where m.created_at < ${cutoff}::timestamptz
              and not exists (select 1 from messages x where x.media_id = m.id)
              and not exists (select 1 from statuses x where x.media_id = m.id)
              and not exists (select 1 from users x where x.avatar_media_id = m.id)
              and not exists (select 1 from chats x where x.avatar_media_id = m.id)
              and not exists (select 1 from communities x where x.avatar_media_id = m.id)
            order by m.created_at
            limit ${batch}
            for update skip locked
          )
          returning storage_key, thumbnail_key`,
    );
    await removeStoredFiles(rows.flatMap((r) => [r.storage_key, r.thumbnail_key]));
    total += rows.length;
    if (rows.length < batch) break;
  }
  if (total) logger.info({ deleted: total }, 'media gc');
  return total;
}

registerJob({ name: 'media-gc', intervalMs: 60 * 60_000, run: async () => void (await runMediaGc()) });
