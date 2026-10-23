/**
 * Bookmark actions (message menu, Inbox): save, remove, set or clear a reminder. Optimistic on
 * the bookmarks store with rollback; the server's answer (and `bookmark:changed` on my other
 * devices) settles it.
 */
import { MAX_BOOKMARKS, type Bookmark, type ID, type Message } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { toast } from '@/stores/ui';
import { formatReminderTime } from './reminders';
import { useBookmarks } from './store';

/** What a bookmark action needs: the message (when I have it) and where it is. */
export interface BookmarkTarget {
  messageId: ID;
  chatId: ID;
  message: Message | null;
}

function failed(e: unknown): void {
  if (e instanceof ApiError && e.code === 'limit_reached')
    toast.error(`You can bookmark up to ${MAX_BOOKMARKS} messages. Remove some to save more.`);
  else toast.error(e);
}

/** PUT the bookmark (`remindAt`: undefined keeps the reminder, null clears it). */
async function put(target: BookmarkTarget, remindAt: string | null | undefined): Promise<boolean> {
  const store = useBookmarks.getState();
  const before = store.byId[target.messageId];
  store.upsert({
    messageId: target.messageId,
    chatId: target.chatId,
    createdAt: before?.createdAt ?? new Date().toISOString(),
    remindAt: remindAt === undefined ? (before?.remindAt ?? null) : remindAt,
    remindedAt: remindAt === undefined ? (before?.remindedAt ?? null) : null,
    message: target.message ?? before?.message ?? null,
  });
  try {
    const saved = await api.put<Bookmark>(
      `/api/messages/${target.messageId}/bookmark`,
      remindAt === undefined ? {} : { remindAt },
    );
    useBookmarks.getState().upsert(saved);
    return true;
  } catch (e) {
    if (before) useBookmarks.getState().upsert(before);
    else useBookmarks.getState().remove(target.messageId);
    failed(e);
    return false;
  }
}

export async function saveBookmark(target: BookmarkTarget): Promise<void> {
  if (await put(target, undefined))
    toast.success('Bookmarked', { id: `bookmark:${target.messageId}` });
}

/** Set (an ISO time) or clear (null) a reminder; a message not saved yet is saved with it. */
export async function setReminder(target: BookmarkTarget, remindAt: string | null): Promise<void> {
  if (!(await put(target, remindAt))) return;
  const when = remindAt
    ? formatReminderTime(remindAt).replace(/^(Today|Tomorrow) /, (w) => w.toLowerCase())
    : '';
  toast.success(remindAt ? `Reminder set for ${when}` : 'Reminder removed', {
    id: `bookmark:${target.messageId}`,
  });
}

export async function removeBookmark(messageId: ID): Promise<void> {
  const store = useBookmarks.getState();
  const before = store.byId[messageId];
  store.remove(messageId);
  try {
    await api.delete(`/api/messages/${messageId}/bookmark`);
  } catch (e) {
    if (before) useBookmarks.getState().upsert(before);
    toast.error(e);
  }
}
