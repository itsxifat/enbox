/**
 * Realtime: space:sounds (a Space's soundboard) and voice:sound (play it) → soundboard store.
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerSoundboardHandlers(_socket: AppSocket): void {}

export async function resyncSoundboard(_info: ReadyInfo): Promise<void> {}
