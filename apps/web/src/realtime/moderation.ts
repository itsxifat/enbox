/**
 * Realtime: space:security (security actions and alerts).
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerModerationHandlers(_socket: AppSocket): void {}

export async function resyncModeration(_info: ReadyInfo): Promise<void> {}
