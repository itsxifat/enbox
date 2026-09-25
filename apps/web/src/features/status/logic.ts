/**
 * Pure status helpers: text-status fonts, viewer navigation, durations. Unit-tested.
 */
import type { CSSProperties } from 'react';
import { STATUS_BACKGROUND_COLORS, STATUS_FONT_COUNT, type Status } from '@enbox/shared';

/** The STATUS_FONT_COUNT text-status fonts (index = `Status.font`), system fonts only (CSP). */
export const STATUS_FONTS: { name: string; style: CSSProperties }[] = [
  { name: 'Sans', style: { fontFamily: 'ui-sans-serif, system-ui, sans-serif', fontWeight: 600 } },
  {
    name: 'Serif',
    style: {
      fontFamily: "Georgia, 'Times New Roman', ui-serif, serif",
      fontWeight: 500,
      fontStyle: 'italic',
    },
  },
  {
    name: 'Mono',
    style: { fontFamily: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace", fontWeight: 500 },
  },
  {
    name: 'Script',
    style: {
      fontFamily: "'Segoe Script', 'Brush Script MT', 'Snell Roundhand', cursive",
      fontWeight: 500,
    },
  },
  {
    name: 'Bold',
    style: {
      fontFamily: "Impact, 'Arial Narrow', 'Franklin Gothic Bold', ui-sans-serif, sans-serif",
      fontWeight: 800,
      textTransform: 'uppercase',
      letterSpacing: '0.02em',
    },
  },
];

if (STATUS_FONTS.length !== STATUS_FONT_COUNT) {
  throw new Error('STATUS_FONTS must match STATUS_FONT_COUNT');
}

export function fontStyle(font: number | null | undefined): CSSProperties {
  return STATUS_FONTS[font ?? 0]?.style ?? STATUS_FONTS[0]!.style;
}

export const DEFAULT_STATUS_COLOR: string = STATUS_BACKGROUND_COLORS[0];

export function nextColor(current: string): string {
  const list = STATUS_BACKGROUND_COLORS as readonly string[];
  const i = list.indexOf(current);
  return list[(i + 1) % list.length]!;
}

/** Font size for a text status, shrinking with length (px). */
export function textStatusSize(text: string, compact = false): number {
  const n = [...text].length;
  const base = n <= 24 ? 40 : n <= 60 ? 34 : n <= 120 ? 28 : n <= 250 ? 23 : n <= 450 ? 19 : 16;
  return compact ? Math.round(base * 0.36) : base;
}

/** How long a status stays on screen (videos: their duration, capped). */
export const PHOTO_TEXT_DURATION_MS = 5_000;
export const MAX_STATUS_VIDEO_MS = 60_000;

export function statusDuration(s: Pick<Status, 'type' | 'media'>): number {
  if (s.type === 'video') {
    const d = s.media?.durationMs ?? 0;
    return d > 0 ? Math.min(d, MAX_STATUS_VIDEO_MS + 1_000) : 15_000;
  }
  return PHOTO_TEXT_DURATION_MS;
}

/** Where to start in a user's statuses: the first one I haven't seen, else the first. */
export function firstUnviewedIndex(statuses: Pick<Status, 'viewed'>[]): number {
  const i = statuses.findIndex((s) => !s.viewed);
  return i >= 0 ? i : 0;
}

export type ViewerMove =
  | { kind: 'status'; index: number }
  | { kind: 'user'; userIndex: number; direction: 1 | -1 }
  | { kind: 'close' };

/**
 * Next/previous position in the viewer. `queue` is the ordered list of users (snapshot at
 * open), `userIndex` the current user, `index`/`count` the current status and total.
 */
export function moveViewer(
  dir: 1 | -1,
  pos: { userIndex: number; index: number; count: number; queueLength: number },
): ViewerMove {
  const { userIndex, index, count, queueLength } = pos;
  if (dir === 1) {
    if (index + 1 < count) return { kind: 'status', index: index + 1 };
    if (userIndex + 1 < queueLength)
      return { kind: 'user', userIndex: userIndex + 1, direction: 1 };
    return { kind: 'close' };
  }
  if (index > 0) return { kind: 'status', index: index - 1 };
  if (userIndex > 0) return { kind: 'user', userIndex: userIndex - 1, direction: -1 };
  return { kind: 'status', index: 0 };
}

/** Segments of a status ring: one per status, `seen` greys it. */
export function ringSegments(count: number, size: number, stroke: number, gapPx = 3) {
  const r = size / 2 - stroke / 2;
  const c = 2 * Math.PI * r;
  const n = Math.max(1, count);
  const gap = n > 1 ? gapPx : 0;
  const seg = c / n - gap;
  return Array.from({ length: n }, (_, i) => ({
    r,
    dasharray: `${Math.max(0.5, seg)} ${c - Math.max(0.5, seg)}`,
    // Start at 12 o'clock, clockwise (the circle is rotated -90deg).
    dashoffset: -(i * (c / n)) - gap / 2,
  }));
}
