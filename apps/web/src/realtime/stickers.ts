/**
 * Realtime: space:stickers (a Space's stickers) → stickers store. The event (to the Space
 * room, the whole list) replaces a Space's list everywhere; leaving a Space drops its picker
 * group; a Space upsert for a Space the picker has no group of (just joined, maybe with
 * stickers) and every `ready` mark the groups stale, so the picker fetches them again when
 * next shown (at once if it is open).
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useStickers } from '@/stores/stickers';

export function registerStickerHandlers(socket: AppSocket): void {
  const stickers = () => useStickers.getState();
  socket.on('space:stickers', ({ spaceId, stickers: list }) =>
    stickers().applySpaceStickers(spaceId, list),
  );
  socket.on('space:removed', ({ spaceId }) => stickers().dropSpace(spaceId));
  socket.on('space:upsert', ({ space }) => {
    const { groups, bySpace } = stickers();
    if (groups && !bySpace[space.id] && !groups.some((g) => g.spaceId === space.id))
      stickers().invalidate();
  });
}

export async function resyncSticker(_info: ReadyInfo): Promise<void> {
  if (useStickers.getState().groups) useStickers.getState().invalidate();
  // Lists open in Space Settings may have missed changes while offline.
  for (const spaceId of Object.keys(useStickers.getState().bySpace))
    void useStickers
      .getState()
      .loadSpace(spaceId, { force: true })
      .catch(() => undefined);
}
