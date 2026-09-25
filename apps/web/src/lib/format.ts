/**
 * Date/time & size formatting for chat UI. All functions accept an optional `now` (for
 * tests and consistent renders) and `locale` (default: the browser's locale).
 */
import { differenceInCalendarDays, isSameDay, isValid, parseISO } from 'date-fns';
import { formatBytes, formatDuration, type Presence } from '@enbox/shared';

export { formatBytes, formatDuration };

type DateInput = string | number | Date;

export interface FormatOptions {
  now?: Date;
  locale?: string;
}

function toDate(input: DateInput): Date {
  if (input instanceof Date) return input;
  if (typeof input === 'number') return new Date(input);
  const d = parseISO(input);
  return isValid(d) ? d : new Date(input);
}

const cache = new Map<string, Intl.DateTimeFormat>();
function dtf(locale: string | undefined, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let f = cache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    cache.set(key, f);
  }
  return f;
}

const twelveHour = new Map<string, boolean>();
function uses12h(locale: string | undefined): boolean {
  const key = locale ?? '';
  let v = twelveHour.get(key);
  if (v === undefined) {
    const hc = new Intl.DateTimeFormat(locale, { hour: 'numeric' }).resolvedOptions().hourCycle;
    v = hc === 'h11' || hc === 'h12';
    twelveHour.set(key, v);
  }
  return v;
}

/** "09:42" in 24-hour locales, "9:42 AM" in 12-hour locales. Message bubbles, call log. */
export function formatTime(input: DateInput, opts: FormatOptions = {}): string {
  return dtf(opts.locale, {
    hour: uses12h(opts.locale) ? 'numeric' : '2-digit',
    minute: '2-digit',
  }).format(toDate(input));
}

/** Full weekday name, e.g. "Monday". */
export function formatWeekday(input: DateInput, opts: FormatOptions = {}): string {
  return dtf(opts.locale, { weekday: 'long' }).format(toDate(input));
}

/** Short numeric date, e.g. "12/03/2025" (locale order). */
export function formatShortDate(input: DateInput, opts: FormatOptions = {}): string {
  return dtf(opts.locale, { day: '2-digit', month: '2-digit', year: 'numeric' }).format(
    toDate(input),
  );
}

/** Days between `input` and `now` by calendar day (0 = today, 1 = yesterday). */
function daysAgo(input: DateInput, now: Date): number {
  return differenceInCalendarDays(now, toDate(input));
}

/**
 * Chat-list timestamp: "10:42" today, "Yesterday", weekday within the last week,
 * otherwise a short date.
 */
export function formatChatListTime(input: DateInput, opts: FormatOptions = {}): string {
  const now = opts.now ?? new Date();
  const d = toDate(input);
  const days = daysAgo(d, now);
  if (days <= 0) return formatTime(d, opts);
  if (days === 1) return 'Yesterday';
  if (days < 7) return formatWeekday(d, opts);
  return formatShortDate(d, opts);
}

/**
 * Day separator inside a conversation: "Today", "Yesterday", weekday within the last
 * week, "12 March" this year, "12 March 2024" otherwise.
 */
export function formatDaySeparator(input: DateInput, opts: FormatOptions = {}): string {
  const now = opts.now ?? new Date();
  const d = toDate(input);
  const days = daysAgo(d, now);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 7) return formatWeekday(d, opts);
  const sameYear = d.getFullYear() === now.getFullYear();
  return dtf(
    opts.locale,
    sameYear
      ? { day: 'numeric', month: 'long' }
      : { day: 'numeric', month: 'long', year: 'numeric' },
  ).format(d);
}

/** True when two timestamps fall on the same local calendar day (day separators). */
export function isSameLocalDay(a: DateInput, b: DateInput): boolean {
  return isSameDay(toDate(a), toDate(b));
}

/**
 * Presence line under a chat title: "online", "last seen today at 10:42",
 * "last seen yesterday at 21:03", "last seen Monday at 09:15", "last seen 12/03/2025",
 * or '' when unknown/hidden.
 */
export function formatLastSeen(
  presence: Pick<Presence, 'online' | 'lastSeenAt'> | null | undefined,
  opts: FormatOptions = {},
): string {
  if (!presence) return '';
  if (presence.online) return 'online';
  if (!presence.lastSeenAt) return '';
  const now = opts.now ?? new Date();
  const d = toDate(presence.lastSeenAt);
  const days = daysAgo(d, now);
  const time = formatTime(d, opts);
  if (days <= 0) return `last seen today at ${time}`;
  if (days === 1) return `last seen yesterday at ${time}`;
  if (days < 7) return `last seen ${formatWeekday(d, opts)} at ${time}`;
  return `last seen ${formatShortDate(d, opts)}`;
}

/** Relative "x minutes ago" style for status updates: "Just now", "12 minutes ago", "Today, 10:42", "Yesterday, 21:03". */
export function formatRelativeShort(input: DateInput, opts: FormatOptions = {}): string {
  const now = opts.now ?? new Date();
  const d = toDate(input);
  const diffMin = Math.floor((now.getTime() - d.getTime()) / 60_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago`;
  const days = daysAgo(d, now);
  if (days <= 0) return `Today, ${formatTime(d, opts)}`;
  if (days === 1) return `Yesterday, ${formatTime(d, opts)}`;
  return `${formatShortDate(d, opts)}, ${formatTime(d, opts)}`;
}

/** Compact counts: 999, 1.2K, 12K, 1.3M (follower counts, views). */
export function formatCount(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  if (n < 1_000_000) return `${Math.floor(n / 1000)}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
}

/** Initials for avatars: "Ada Lovelace" → "AL", "ada" → "A", emoji-safe. */
export function initials(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  const first = Array.from(words[0]!)[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : '';
  return (first + last).toUpperCase();
}
