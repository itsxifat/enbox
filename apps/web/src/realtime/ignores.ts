/**
 * Realtime: ignores:changed (my ignore list).
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerIgnoresHandlers(_socket: AppSocket): void {}

export async function resyncIgnores(_info: ReadyInfo): Promise<void> {}
