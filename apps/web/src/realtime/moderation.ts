/**
 * Realtime: space:security (security actions and alerts) → the Space in the spaces store:
 * `invitesPaused` for everyone, `security` for moderators (features/moderation/api.ts). The
 * Spaces resync reloads every Space with both, so nothing more is needed on `ready`.
 */
import { applySecurity } from '@/features/moderation/api';
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerModerationHandlers(socket: AppSocket): void {
  socket.on('space:security', ({ spaceId, security }) => applySecurity(spaceId, security));
}

export async function resyncModeration(_info: ReadyInfo): Promise<void> {}
