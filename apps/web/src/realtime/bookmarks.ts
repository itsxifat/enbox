/**
 * Realtime: bookmark:changed, bookmark:removed and reminder:due (my devices only) into the
 * bookmarks store, a due reminder's toast; a saved message's message:updated / message:removed
 * keep its preview current; every `ready` reloads my bookmarks. Also offers each message:new
 * to the in-app banners (features/notifications/banners.ts), registered after the messages
 * handler so the chat list already has it.
 */
import { useBookmarks } from '@/features/bookmarks/store';
import { offerMessageBanner } from '@/features/notifications/banners';
import { showReminderToast } from '@/features/notifications/reminderToast';
import type { AppSocket, ReadyInfo } from '@/lib/socket';

export function registerBookmarkHandlers(socket: AppSocket): void {
  socket.on('bookmark:changed', ({ bookmark }) => useBookmarks.getState().upsert(bookmark));
  socket.on('bookmark:removed', ({ messageId }) => useBookmarks.getState().remove(messageId));
  socket.on('reminder:due', ({ bookmark }) => {
    useBookmarks.getState().upsert(bookmark);
    showReminderToast(bookmark);
  });
  socket.on('message:updated', ({ message }) =>
    useBookmarks.getState().setMessage(message.id, message),
  );
  socket.on('message:removed', ({ messageIds }) => {
    for (const id of messageIds) useBookmarks.getState().setMessage(id, null);
  });
  socket.on('message:new', ({ message }) => offerMessageBanner(message));
}

export async function resyncBookmarks(_info: ReadyInfo): Promise<void> {
  await useBookmarks.getState().load();
}
