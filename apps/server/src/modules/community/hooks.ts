/**
 * Community hooks: a deleted channel leaves the welcome screens that recommend it (in the
 * deleting transaction; the channel and Space deletions hold the Space lock).
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { chats, spaces } from '../../db/schema.js';
import { registerChatDeletionHook } from '../../services/hooks.js';

registerChatDeletionHook('community', async (tx, _fx, chatIds) => {
  const rows = await tx
    .select({ id: spaces.id, welcomeScreen: spaces.welcomeScreen })
    .from(spaces)
    .where(
      and(
        isNotNull(spaces.welcomeScreen),
        inArray(spaces.id, tx.select({ id: chats.spaceId }).from(chats).where(inArray(chats.id, chatIds))),
      ),
    );
  const gone = new Set(chatIds);
  for (const s of rows) {
    const w = s.welcomeScreen!;
    const channels = w.channels.filter((c) => !gone.has(c.channelId));
    if (channels.length !== w.channels.length)
      await tx.update(spaces).set({ welcomeScreen: { ...w, channels } }).where(eq(spaces.id, s.id));
  }
});
