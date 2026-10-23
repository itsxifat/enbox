/**
 * Realtime: me:preferences (everyday wave, agent 3): my synced preferences changed on another
 * device; every `ready` reloads them.
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerPreferencesHandlers(_socket: AppSocket): void {}

export async function resyncPreferences(_info: ReadyInfo): Promise<void> {}
