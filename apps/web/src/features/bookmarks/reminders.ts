/**
 * Remind Me presets (Discord's): in 20 minutes, in 1 hour, in 3 hours, tomorrow at 9:00, next
 * week (Monday at 9:00), or a custom time; and how a reminder's time reads. Pure.
 */
import {
  addDays,
  addHours,
  addMinutes,
  isSameDay,
  nextMonday,
  setHours,
  startOfDay,
} from 'date-fns';
import { formatTime } from '@/lib/format';

export type ReminderPreset = 'in20m' | 'in1h' | 'in3h' | 'tomorrow' | 'nextWeek';

export const REMINDER_PRESETS: readonly ReminderPreset[] = [
  'in20m',
  'in1h',
  'in3h',
  'tomorrow',
  'nextWeek',
];

/** When a preset fires, from `now` (local 9:00 for tomorrow and next Monday). */
export function presetTime(preset: ReminderPreset, now = new Date()): Date {
  switch (preset) {
    case 'in20m':
      return addMinutes(now, 20);
    case 'in1h':
      return addHours(now, 1);
    case 'in3h':
      return addHours(now, 3);
    case 'tomorrow':
      return setHours(startOfDay(addDays(now, 1)), 9);
    case 'nextWeek':
      return setHours(startOfDay(nextMonday(now)), 9);
  }
}

/** A preset's menu label and the time it lands on (the item's hint). */
export function presetLabel(
  preset: ReminderPreset,
  now = new Date(),
): { label: string; hint: string } {
  const at = presetTime(preset, now);
  switch (preset) {
    case 'in20m':
      return { label: 'In 20 minutes', hint: formatTime(at) };
    case 'in1h':
      return { label: 'In 1 hour', hint: formatTime(at) };
    case 'in3h':
      return { label: 'In 3 hours', hint: formatTime(at) };
    case 'tomorrow':
      return { label: 'Tomorrow', hint: formatTime(at) };
    case 'nextWeek':
      return { label: 'Next week', hint: `${weekday(at)} ${formatTime(at)}` };
  }
}

const weekday = (d: Date) => d.toLocaleDateString([], { weekday: 'short' });

/** "Today at 3:45 PM", "Tomorrow at 9:00 AM", "Mon, Oct 27 at 9:00 AM" (a year on: with it). */
export function formatReminderTime(iso: string, now = new Date()): string {
  const d = new Date(iso);
  const time = formatTime(d);
  if (isSameDay(d, now)) return `Today at ${time}`;
  if (isSameDay(d, addDays(now, 1))) return `Tomorrow at ${time}`;
  if (isSameDay(d, addDays(now, -1))) return `Yesterday at ${time}`;
  const sameYear = d.getFullYear() === now.getFullYear();
  const date = d.toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
  return `${date} at ${time}`;
}

/** `<input type="date">` / `<input type="time">` values of a local time. */
export function toDateInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function toTimeInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The local time a date and a time input name, or null when either is incomplete. */
export function fromInputs(date: string, time: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) return null;
  const d = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}
