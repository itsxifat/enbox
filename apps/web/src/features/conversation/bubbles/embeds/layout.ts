/**
 * Pure helpers of the rich embed renderer (RichEmbed.tsx): the fields grid, the colour bar
 * and the footer timestamp. Unit-tested.
 */
import { differenceInCalendarDays } from 'date-fns';
import type { EmbedField } from '@enbox/shared';
import { formatShortDate, formatTime } from '@/lib/format';

/** A field and its `grid-column` in the 12-column grid of wide screens. */
export interface FieldCell {
  field: EmbedField;
  /** e.g. `1 / 5` (a third), `7 / 13` (the second half), `1 / 13` (a full row). */
  column: string;
}

/**
 * Discord's fields layout: consecutive inline fields share a row, at most `perRow` of them
 * (three; two beside a thumbnail), splitting it evenly; any other field takes a row of its
 * own. Phones stack every field (the renderer ignores `column` there).
 */
export function layoutFields(fields: readonly EmbedField[], perRow = 3): FieldCell[] {
  const out: FieldCell[] = [];
  let row: EmbedField[] = [];
  const flush = () => {
    const span = 12 / row.length;
    row.forEach((field, i) =>
      out.push({ field, column: `${1 + i * span} / ${1 + (i + 1) * span}` }),
    );
    row = [];
  };
  for (const field of fields) {
    if (field.inline) {
      row.push(field);
      if (row.length === perRow) flush();
      continue;
    }
    if (row.length) flush();
    out.push({ field, column: '1 / 13' });
  }
  if (row.length) flush();
  return out;
}

/** `0xRRGGBB` → `#rrggbb`; null when unset or out of range (the theme's line colour). */
export function embedColor(color: number | null | undefined): string | null {
  if (color == null || !Number.isInteger(color) || color < 0 || color > 0xffffff) return null;
  return `#${color.toString(16).padStart(6, '0')}`;
}

/** The footer's time, like message times: "Today at 9:42", "Yesterday at 9:42", else a date. */
export function formatEmbedTimestamp(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const days = differenceInCalendarDays(now, d);
  if (days === 0) return `Today at ${formatTime(d)}`;
  if (days === 1) return `Yesterday at ${formatTime(d)}`;
  return `${formatShortDate(d)} ${formatTime(d)}`;
}

/** A link an embed may open: https only (the server checks it too). */
export function safeLink(url: string | null | undefined): string | null {
  return url && /^https:\/\//i.test(url) ? url : null;
}

/** An image an embed may show: our own copy (`/uploads/…`), never a third-party host. */
export function safeImage(url: string | null | undefined): string | null {
  return url && url.startsWith('/') && !url.startsWith('//') ? url : null;
}
