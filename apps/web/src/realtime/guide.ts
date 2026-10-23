/**
 * Realtime: space:guide and me:channel-prefs (Server Guide, Browse Channels).
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerGuideHandlers(_socket: AppSocket): void {}

export async function resyncGuide(_info: ReadyInfo): Promise<void> {}
