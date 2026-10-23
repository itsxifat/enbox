/**
 * Voice channel status (Discord's "Set a channel status"): a line on a voice or Stage channel
 * saying what is going on there, shown under its row in the channel list and in its header.
 *
 * - `setVoiceStatus`: only someone connected to that channel (their voice state) with SPEAK
 *   there — on a Stage a speaker or one of its moderators; trimmed, empty clears it.
 *   `chat:updated { space }` → the channel's room, as the channel PATCH does (a private channel
 *   stays private).
 * - `clearEmptyVoiceStatuses`: after people left channels (leave, disconnect, move, sweeps), one
 *   UPDATE clears the status of those nobody is connected to any more.
 *
 * Both take the channel row lock (`setVoiceStatus` through `getChatAccess`, the clear through
 * its UPDATE), so a status set by the last person in the channel just as they leave is cleared
 * by their leave: the clear waits for the set to commit and then finds nobody left.
 */
import { and, eq, inArray, isNotNull, sql } from 'drizzle-orm';
import { PERM, hasPerm } from '@enbox/shared';
import { db, type DbOrTx } from '../../db/index.js';
import { chats, voiceStates } from '../../db/schema.js';
import { forbidden, notFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { getChatAccess } from '../../services/chats.js';
import { Effects, transact } from '../../services/effects.js';
import { loadChannelOverwrites } from '../../services/spaceAccess.js';
import { toSpaceChannelInfo } from '../../services/spaceSummaries.js';
// service.ts imports this module too: only functions cross (used at call time).
import { isStageModerator } from './service.js';

/** `PUT /chats/:chatId/voice-status`, per user: one change every two seconds. */
export const VOICE_STATUS_RATE = { limit: 1, windowMs: 2_000 } as const;

/**
 * Set (or clear, with null or blank text) the status of the voice or Stage channel `chatId`.
 * 404 unless I can see a voice channel there, 403 unless I am connected to it with SPEAK — on
 * a Stage as a speaker or one of its moderators (not every listener).
 */
export async function setVoiceStatus(
  userId: string,
  chatId: string,
  status: string | null,
): Promise<void> {
  const next = status?.trim() || null;
  await transact(async (tx, fx) => {
    const { chat, space } = await getChatAccess(tx, userId, chatId, { lock: true });
    if ((chat.type !== 'space_voice' && chat.type !== 'space_stage') || !space)
      throw notFound('Voice channel');
    const [mine] = await tx
      .select({ channelId: voiceStates.channelId, suppressed: voiceStates.suppressed })
      .from(voiceStates)
      .where(eq(voiceStates.userId, userId));
    if (mine?.channelId !== chatId) throw forbidden('Join the voice channel to set its status');
    if (!hasPerm(space.bits, PERM.SPEAK))
      throw forbidden('You do not have permission to set the status of this voice channel');
    if (chat.type === 'space_stage' && mine.suppressed && !isStageModerator(space.bits))
      throw forbidden('Only speakers can set the status of this Stage');
    if (chat.voiceStatus === next) return;
    const [fresh] = await tx
      .update(chats)
      .set({ voiceStatus: next, updatedAt: new Date() })
      .where(eq(chats.id, chatId))
      .returning();
    fx.chatUpdated(chatId, { space: toSpaceChannelInfo(fresh!, space.overwrites) });
  });
}

/**
 * Clear the status of every channel of `channelIds` nobody is connected to (people just left
 * them). Never throws: a failure is logged and the status stays until the next leave. Pass the
 * transaction a caller deleted voice states in (its events then go out at once, like the rest
 * of that caller's).
 */
export async function clearEmptyVoiceStatuses(
  channelIds: Iterable<string>,
  dbx: DbOrTx = db,
): Promise<void> {
  const ids = [...new Set(channelIds)];
  if (!ids.length) return;
  try {
    const cleared = await dbx
      .update(chats)
      .set({ voiceStatus: null, updatedAt: new Date() })
      .where(
        and(
          inArray(chats.id, ids),
          isNotNull(chats.voiceStatus),
          sql`not exists (select 1 from ${voiceStates} where ${voiceStates.channelId} = ${chats.id})`,
        ),
      )
      .returning();
    if (!cleared.length) return;
    const overwrites = await loadChannelOverwrites(
      dbx,
      cleared.map((c) => c.id),
    );
    const fx = new Effects();
    for (const c of cleared)
      fx.chatUpdated(c.id, { space: toSpaceChannelInfo(c, overwrites.get(c.id) ?? []) });
    await fx.prepare(dbx);
    fx.flush();
  } catch (err) {
    logger.warn({ err, channelIds: ids }, 'voice status clear failed');
  }
}
