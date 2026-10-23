/**
 * A due reminder (`reminder:due`, every device of mine): a toast with the message's first line
 * and Open (which marks it seen and jumps to it), plus the notification sound unless I'm in do
 * not disturb. The push covers Enbox in the background.
 */
import { isDnd, truncate, type Bookmark } from '@enbox/shared';
import { reminderKey, useBookmarks } from '@/features/bookmarks/store';
import { jumpToMessage } from '@/features/inbox/lib';
import { bus } from '@/lib/bus';
import { playSound } from '@/lib/notify';
import { notificationBody } from '@/realtime/messages';
import { useAuth } from '@/stores/auth';
import { streamerHides } from '@/stores/streamer';
import { toast, useUi } from '@/stores/ui';
import { nameOf } from '@/stores/users';

/** Long enough to be reached (the toast pauses while hovered or focused). */
export const REMINDER_TOAST_MS = 15_000;

/** "Alice: the text" of a reminder's message (null when it is gone or hidden by Streamer Mode). */
export function reminderText(b: Bookmark): string | null {
  const m = b.message;
  if (!m || streamerHides('notifications')) return null;
  const me = useAuth.getState().user;
  const names = { nameOf: (id: string) => nameOf(id, { you: me?.displayName }) };
  const body = notificationBody(m, names, { viewerId: me?.id });
  const firstLine = body.split('\n').find((l) => l.trim()) ?? body;
  const who = m.senderId ? names.nameOf(m.senderId) : m.authorOverride?.name;
  return truncate(`${who ? `${who}: ` : ''}${firstLine.trim()}`, 140);
}

export function showReminderToast(b: Bookmark): void {
  const m = b.message;
  toast.info('Reminder', {
    id: `reminder:${b.messageId}`,
    description: m
      ? (reminderText(b) ?? 'About a message you saved')
      : 'This message is no longer available',
    duration: REMINDER_TOAST_MS,
    action: m
      ? {
          label: 'Open',
          onClick: () => {
            useBookmarks.getState().markSeen([reminderKey(b)]);
            void jumpToMessage(b.chatId, m, (to) => bus.emit('navigate', { to }));
          },
        }
      : undefined,
  });
  const me = useAuth.getState().user;
  if (useUi.getState().prefs.sounds && me && !isDnd(me)) playSound('notification');
}
