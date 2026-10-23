/**
 * The message menu's Bookmark / Remove Bookmark and Remind Me ▸ (In 20 minutes, In 1 hour, In
 * 3 hours, Tomorrow, Next week, Custom…, Remove Reminder) for messages I can see. Touch sheets
 * have no submenus: there Remind Me asks with a list (`chooseReminder`).
 */
import { AlarmClock, BookmarkMinus, BookmarkPlus, CalendarClock } from 'lucide-react';
import type { Bookmark, ChatSummary } from '@enbox/shared';
import type { MenuEntry } from '@/components/ui';
import { isActionable } from '@/features/conversation/actions';
import type { ClientMessage } from '@/stores/messages';
import { choose } from '@/stores/ui';
import { removeBookmark, saveBookmark, setReminder, type BookmarkTarget } from './actions';
import { openReminderDialog } from './ReminderDialog';
import { REMINDER_PRESETS, formatReminderTime, presetLabel, presetTime } from './reminders';
import { useBookmarks } from './store';

/** Saved messages: what the server accepts (not system or deleted, sent already). */
export function canBookmark(m: ClientMessage): boolean {
  return isActionable(m) && !m.deletedAt && m.type !== 'system';
}

/** A reminder still ahead (not fired yet). */
export function upcomingReminder(b: Bookmark | undefined): string | null {
  return b?.remindAt && !b.remindedAt ? b.remindAt : null;
}

/** Remind Me's choices for a message (or a bookmark of the Inbox). */
export function reminderEntries(target: BookmarkTarget, now = new Date()): MenuEntry[] {
  const current = upcomingReminder(useBookmarks.getState().byId[target.messageId]);
  return [
    ...REMINDER_PRESETS.map((preset) => ({
      ...presetLabel(preset, now),
      onSelect: () => void setReminder(target, presetTime(preset).toISOString()),
    })),
    {
      label: 'Custom…',
      icon: CalendarClock,
      onSelect: () => openReminderDialog(target, current),
    },
    current ? 'separator' : null,
    current
      ? { label: 'Remove Reminder', danger: true, onSelect: () => void setReminder(target, null) }
      : null,
  ];
}

/** Remind Me as a list (touch sheets). */
export async function chooseReminder(target: BookmarkTarget): Promise<void> {
  const current = upcomingReminder(useBookmarks.getState().byId[target.messageId]);
  const now = new Date();
  const value = await choose({
    title: 'Remind me',
    message: current ? `Reminder: ${formatReminderTime(current, now)}` : undefined,
    options: [
      ...REMINDER_PRESETS.map((preset) => {
        const { label, hint } = presetLabel(preset, now);
        return { value: preset as string, label: `${label} · ${hint}` };
      }),
      { value: 'custom', label: 'Custom…' },
      ...(current ? [{ value: 'remove', label: 'Remove Reminder', danger: true }] : []),
    ],
  });
  if (!value) return;
  if (value === 'custom') openReminderDialog(target, current);
  else if (value === 'remove') await setReminder(target, null);
  else {
    const preset = REMINDER_PRESETS.find((p) => p === value);
    if (preset) await setReminder(target, presetTime(preset).toISOString());
  }
}

export function bookmarkMenuItems(chat: ChatSummary, m: ClientMessage): MenuEntry[] {
  if (!canBookmark(m)) return [];
  const saved = !!useBookmarks.getState().byId[m.id];
  const target: BookmarkTarget = { messageId: m.id, chatId: chat.id, message: m };
  const current = upcomingReminder(useBookmarks.getState().byId[m.id]);
  return [
    saved
      ? { label: 'Remove Bookmark', icon: BookmarkMinus, onSelect: () => void removeBookmark(m.id) }
      : { label: 'Bookmark', icon: BookmarkPlus, onSelect: () => void saveBookmark(target) },
    {
      label: 'Remind Me',
      icon: AlarmClock,
      description: current ? formatReminderTime(current) : undefined,
      submenu: reminderEntries(target),
      onSelect: () => void chooseReminder(target),
    },
  ];
}
