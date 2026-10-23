/**
 * Server Guide hooks: a deleted channel leaves the guides that use it (in the deleting
 * transaction; members get the trimmed guide), and leaving a Space forgets my Browse Channels
 * choices there (a rejoin starts from the channels' defaults, like Discord).
 */
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { rooms } from '@enbox/shared';
import { chats, spaceMemberChannels, spaces } from '../../db/schema.js';
import { emitToRooms } from '../../realtime/emit.js';
import { registerChatDeletionHook } from '../../services/hooks.js';
import { onSpaceMemberLeft } from '../../services/spaceMemberHooks.js';

registerChatDeletionHook('guide', async (tx, fx, chatIds) => {
  const rows = await tx
    .select({ id: spaces.id, guide: spaces.guide })
    .from(spaces)
    .where(
      and(
        isNotNull(spaces.guide),
        inArray(
          spaces.id,
          tx.select({ id: chats.spaceId }).from(chats).where(inArray(chats.id, chatIds)),
        ),
      ),
    );
  const gone = new Set(chatIds);
  for (const s of rows) {
    const g = s.guide!;
    const todos = g.todos.filter((t) => !gone.has(t.channelId));
    const resources = g.resources.filter((r) => !gone.has(r.channelId));
    if (todos.length === g.todos.length && resources.length === g.resources.length) continue;
    const guide = { ...g, todos, resources };
    await tx.update(spaces).set({ guide }).where(eq(spaces.id, s.id));
    fx.add(() => emitToRooms([rooms.space(s.id)], 'space:guide', { spaceId: s.id, guide }));
  }
});

onSpaceMemberLeft(async (tx, _fx, { spaceId, userId }) => {
  await tx
    .delete(spaceMemberChannels)
    .where(and(eq(spaceMemberChannels.spaceId, spaceId), eq(spaceMemberChannels.userId, userId)));
});
