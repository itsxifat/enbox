/**
 * Event date lines and the wizard's date / time fields (local time, the browser's locale).
 */
import { formatTime, type FormatOptions } from '@/lib/format';

const dayFormats = new Map<string, Intl.DateTimeFormat>();
function dayFormat(locale: string | undefined, withYear: boolean): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${withYear}`;
  let f = dayFormats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      ...(withYear ? { year: 'numeric' } : {}),
    });
    dayFormats.set(key, f);
  }
  return f;
}

/** "Sat, Oct 25 · 7:00 PM" (the year too when it is not this year's). */
export function formatEventDate(input: string | Date, opts: FormatOptions = {}): string {
  const d = typeof input === 'string' ? new Date(input) : input;
  const now = opts.now ?? new Date();
  const day = dayFormat(opts.locale, d.getFullYear() !== now.getFullYear()).format(d);
  return `${day} · ${formatTime(d, opts)}`;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** `<input type="date">` value of a local date: "2026-10-25". */
export function toDateInput(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** `<input type="time">` value of a local time: "19:00". */
export function toTimeInput(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** The local date and time of two input values, or null when either is empty or invalid. */
export function fromInputs(date: string, time: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null;
  const [y, m, day] = date.split('-').map(Number) as [number, number, number];
  const [h, min] = time.split(':').map(Number) as [number, number];
  const d = new Date(y, m - 1, day, h, min, 0, 0);
  return Number.isNaN(d.getTime()) || d.getMonth() !== m - 1 ? null : d;
}

/** A new event's default start: the next full hour. */
export function defaultEventStart(now = new Date()): Date {
  const d = new Date(now);
  d.setMinutes(0, 0, 0);
  d.setHours(d.getHours() + 1);
  return d;
}
