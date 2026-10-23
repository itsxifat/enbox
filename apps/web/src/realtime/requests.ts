/**
 * Realtime: chat:request / chat:request-removed (message requests).
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerRequestsHandlers(_socket: AppSocket): void {}

export async function resyncRequests(_info: ReadyInfo): Promise<void> {}
