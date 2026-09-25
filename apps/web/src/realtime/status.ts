/**
 * Realtime: status updates — OWNED BY FEATURE AGENT 4 (status UI).
 * Applies events to the status store and forwards them to the bus.
 */
import { bus } from '@/lib/bus';
import type { AppSocket, ReadyInfo } from '@/lib/socket';
import { useStatus } from '@/stores/status';

export function registerStatusHandlers(socket: AppSocket): void {
  socket.on('status:new', (p) => {
    useStatus.getState().applyNew(p.status, p.user);
    bus.emit('status:new', p);
  });
  socket.on('status:deleted', (p) => {
    useStatus.getState().applyDeleted(p.statusId, p.userId);
    bus.emit('status:deleted', p);
  });
  socket.on('status:viewed', (p) => {
    useStatus.getState().applyViewed(p.statusId, p.viewer, {
      firstView: p.firstView,
      viewCount: p.viewCount,
    });
    bus.emit('status:viewed', p);
  });
}

export async function resyncStatus(_info: ReadyInfo): Promise<void> {
  // Keep the feed fresh (it's small); agent 4 may make this smarter.
  await useStatus
    .getState()
    .loadFeed()
    .catch(() => undefined);
}
