/**
 * Link preview GC (hourly and at boot): deletes cached link previews older than
 * LINK_PREVIEW_TTL_MS, and their stored images, in batches of 500. A link still in use is
 * simply fetched again the next time a client asks for it.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { LINK_PREVIEW_TTL_MS } from '../services/linkPreviews.js';
import { rawRows } from '../services/sql.js';
import { removeStoredFiles } from '../services/uploads.js';
import { registerJob } from './index.js';

export async function runLinkPreviewGc(
  opts: { ttlMs?: number; batchSize?: number } = {},
): Promise<number> {
  const ttlMs = opts.ttlMs ?? LINK_PREVIEW_TTL_MS;
  const batch = opts.batchSize ?? 500;
  let total = 0;
  for (;;) {
    const cutoff = new Date(Date.now() - ttlMs).toISOString();
    const rows = await rawRows<{ image_key: string | null }>(
      db,
      sql`delete from link_previews where url in (
            select url from link_previews
            where fetched_at < ${cutoff}::timestamptz
            order by fetched_at
            limit ${batch}
            for update skip locked
          )
          returning image_key`,
    );
    await removeStoredFiles(rows.map((r) => r.image_key));
    total += rows.length;
    if (rows.length < batch) break;
  }
  if (total) logger.info({ deleted: total }, 'link preview gc');
  return total;
}

registerJob({
  name: 'link-preview-gc',
  intervalMs: 60 * 60_000,
  runOnStart: true,
  run: async () => {
    await runLinkPreviewGc();
  },
});
