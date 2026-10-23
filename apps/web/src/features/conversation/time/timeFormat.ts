/**
 * Discord's message times: "Today at 3:14 PM", "Yesterday at 3:14 PM" or "10/22/2026 3:14 PM"
 * in a group's header, the short "3:14 PM" beside the later messages of a group, and the full
 * "Thursday, October 22, 2026 3:14 PM" in the tooltip of every one. Pure (unit-tested): `now`
 * and `locale` as in lib/format.ts.
 */
import { differenceInCalendarDays } from 'date-fns';
import { formatShortDate, formatTime, type FormatOptions } from '@/lib/format';

type DateInput = string | number | Date;

const toDate = (input: DateInput) => (input instanceof Date ? input : new Date(input));

const formats = new Map<string, Intl.DateTimeFormat>();
function dateFormat(locale: string | undefined, options: Intl.DateTimeFormatOptions) {
  const key = `${locale ?? ''}|${JSON.stringify(options)}`;
  let f = formats.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat(locale, options);
    formats.set(key, f);
  }
  return f;
}

/** A group header's time: "Today at 3:14 PM", "Yesterday at 3:14 PM", else "10/22/2026 3:14 PM". */
export function formatMessageTime(input: DateInput, opts: FormatOptions = {}): string {
  const d = toDate(input);
  const days = differenceInCalendarDays(opts.now ?? new Date(), d);
  const time = formatTime(d, opts);
  if (days <= 0) return `Today at ${time}`;
  if (days === 1) return `Yesterday at ${time}`;
  return `${formatShortDate(d, opts)} ${time}`;
}

/** The tooltip of a message time: "Thursday, October 22, 2026 3:14 PM". */
export function formatFullMessageTime(input: DateInput, opts: FormatOptions = {}): string {
  const d = toDate(input);
  const day = dateFormat(opts.locale, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(d);
  return `${day} ${formatTime(d, opts)}`;
}

/**
 * When the first unread message came, for "12 new messages since …": "3:14 PM" today,
 * "October 21 at 3:14 PM" earlier this year, "October 21, 2025 at 3:14 PM" before.
 */
export function formatSinceTime(input: DateInput, opts: FormatOptions = {}): string {
  const now = opts.now ?? new Date();
  const d = toDate(input);
  const time = formatTime(d, opts);
  if (differenceInCalendarDays(now, d) <= 0) return time;
  const day = dateFormat(
    opts.locale,
    d.getFullYear() === now.getFullYear()
      ? { month: 'long', day: 'numeric' }
      : { month: 'long', day: 'numeric', year: 'numeric' },
  ).format(d);
  return `${day} at ${time}`;
}
