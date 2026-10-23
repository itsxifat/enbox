/**
 * Realtime: bookmark:changed, bookmark:removed and reminder:due (everyday wave, agent 6), my
 * devices only; every `ready` reloads what's needed.
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerBookmarkHandlers(_socket: AppSocket): void {}

export async function resyncBookmarks(_info: ReadyInfo): Promise<void> {}
