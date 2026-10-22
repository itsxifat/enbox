/**
 * Realtime: custom Space emoji → emoji store. `space:emojis` (to the Space room) replaces a
 * Space's list everywhere; leaving a Space drops its picker group; a Space upsert for a Space
 * the picker has no group of (just joined, maybe with emoji) and every `ready` mark the
 * groups stale, so the picker fetches them again when next shown (at once if it is open).
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useEmojis } from '@/stores/emojis';

export function registerEmojiHandlers(socket: AppSocket): void {
  const emojis = () => useEmojis.getState();
  socket.on('space:emojis', ({ spaceId, emojis: list }) => emojis().applySpaceEmojis(spaceId, list));
  socket.on('space:removed', ({ spaceId }) => emojis().dropSpace(spaceId));
  socket.on('space:upsert', ({ space }) => {
    const { groups, bySpace } = emojis();
    if (groups && !bySpace[space.id] && !groups.some((g) => g.spaceId === space.id)) emojis().invalidate();
  });
}

export async function resyncEmojis(_info: ReadyInfo): Promise<void> {
  const { groups } = useEmojis.getState();
  if (groups) useEmojis.getState().invalidate();
  // Lists open in Space Settings may have missed changes while offline.
  for (const spaceId of Object.keys(useEmojis.getState().bySpace))
    void useEmojis.getState().loadSpace(spaceId, { force: true }).catch(() => undefined);
}
