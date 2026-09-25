/**
 * Disappearing-messages purge (every minute, docs "Jobs" / "Pins and disappearing
 * messages"): hard-delete messages whose `expires_at` passed, in batches of 500 locked with
 * `FOR UPDATE SKIP LOCKED` (rows being edited/deleted/pinned by an uncommitted transaction
 * are skipped and picked up on a later run), looping while batches are full.
 *
 * Deleting the row drops every reference it held: reactions, stars, votes, hidden rows and
 * pins cascade; replies' `reply_to_id` is set null (their quote becomes `replyTo: null`); its
 * `media_id` reference disappears, so the media GC collects the file once nothing else uses
 * it. After each batch commits: `message:removed { chatId, messageIds }` → room per chat
 * (clients ignore ids they don't have), then `chat:pins` → room for chats that lost a pin.
 */
import { sql } from 'drizzle-orm';
import { db } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { Effects } from '../services/effects.js';
import { rawRows } from '../services/sql.js';
import { registerJob } from './index.js';

export async function runDisappearingPurge(opts: { batchSize?: number } = {}): Promise<number> {
  const batch = opts.batchSize ?? 500;
  let total = 0;
  for (;;) {
    const fx = new Effects();
    const deleted = await db.transaction(async (tx) => {
      // All parts of the statement share one snapshot: `pinned` sees chat_pins before the cascade.
      const rows = await rawRows<{ id: string; chat_id: string; pinned: boolean }>(
        tx,
        sql`with del as (
              delete from messages where id in (
                select id from messages
                where expires_at is not null and expires_at <= now()
                order by expires_at
                limit ${batch}
                for update skip locked
              )
              returning id, chat_id
            )
            select del.id, del.chat_id, exists (select 1 from chat_pins p where p.message_id = del.id) as pinned
            from del`,
      );
      const byChat = new Map<string, { ids: string[]; pinned: boolean }>();
      for (const r of rows) {
        const entry = byChat.get(r.chat_id) ?? { ids: [], pinned: false };
        entry.ids.push(r.id);
        entry.pinned ||= r.pinned;
        byChat.set(r.chat_id, entry);
      }
      for (const [chatId, { ids, pinned }] of byChat) {
        fx.messagesRemoved(chatId, ids);
        if (pinned) fx.chatPins(chatId);
      }
      await fx.prepare(tx);
      return rows.length;
    });
    fx.flush();
    total += deleted;
    if (deleted < batch) break;
  }
  if (total) logger.info({ purged: total }, 'disappearing purge');
  return total;
}

registerJob({
  name: 'disappearing-purge',
  intervalMs: 60_000,
  run: async () => void (await runDisappearingPurge()),
});
