/**
 * Realtime: space:stickers (a Space's stickers) → stickers store.
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerStickerHandlers(_socket: AppSocket): void {}

export async function resyncSticker(_info: ReadyInfo): Promise<void> {}
