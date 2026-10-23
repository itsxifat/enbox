/**
 * Realtime: ignores:changed (my ignore list). The event carries my whole list (changed on
 * any of my devices); every `ready` reloads it, since events missed while offline are not
 * replayed. Ignored users' typing is dropped where `chat:typing` lands (realtime/chats.ts).
 */
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useIgnores } from '@/stores/ignores';

export function registerIgnoresHandlers(socket: AppSocket): void {
  socket.on('ignores:changed', ({ userIds }) => useIgnores.getState().apply(userIds));
}

export async function resyncIgnores(_info: ReadyInfo): Promise<void> {
  await useIgnores.getState().load({ force: true });
}
