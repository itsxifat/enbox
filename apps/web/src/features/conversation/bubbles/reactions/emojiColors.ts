/**
 * The two dominant colours of an emoji (super reaction chips and their burst): the emoji is
 * drawn once on a small canvas and its pixels counted by hue; cached per emoji. A custom
 * emoji reads its (still) image. Anything unreadable (no canvas, a cross-origin image, an
 * all-grey emoji) falls back to the brand violets.
 */
import { useEffect, useState } from 'react';
import { parseCustomEmoji } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { emojiImageUrl, useEmojis } from '@/stores/emojis';
import { reactionKey } from './model';

export type EmojiColors = readonly [string, string];

/** The brand violet and its light ink. */
export const FALLBACK_COLORS: EmojiColors = ['#6d5dfc', '#a89eff'];

/** Canvas size in px (enough to see an emoji's colours, cheap to read). */
const SIZE = 24;
const HUE_BINS = 24;
/** The second colour is another hue at least this far round the wheel (🔥: orange, yellow)… */
const MIN_HUE_APART = 30;
/** …that covers at least this share of the first one's pixels. */
const MIN_SECOND_SHARE = 0.08;

const cache = new Map<string, EmojiColors>();
const loading = new Map<string, Promise<EmojiColors>>();

const hex2 = (v: number) =>
  Math.round(Math.max(0, Math.min(255, v)))
    .toString(16)
    .padStart(2, '0');
const toHex = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`;

/** `#rrggbb` mixed with white (`amount` 0..1). */
export function lighten(color: string, amount = 0.45): string {
  const n = Number.parseInt(color.slice(1), 16);
  const mix = (c: number) => c + (255 - c) * amount;
  return toHex(mix((n >> 16) & 255), mix((n >> 8) & 255), mix(n & 255));
}

/**
 * The two dominant colours of RGBA pixels: the average of the most common hue, then of the
 * most common hue at least MIN_HUE_APART away (else a lighter shade of the first).
 * Transparent, grey, near-black and near-white pixels don't count; null when none are left.
 */
export function dominantColors(data: ArrayLike<number>): EmojiColors | null {
  const bins = Array.from({ length: HUE_BINS }, () => ({ n: 0, r: 0, g: 0, b: 0 }));
  for (let i = 0; i + 3 < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    if (data[i + 3]! < 128) continue;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const light = (max + min) / 510;
    if (max - min < 46 || light < 0.12 || light > 0.94) continue;
    const c = max - min;
    const h = max === r ? ((g - b) / c + 6) % 6 : max === g ? (b - r) / c + 2 : (r - g) / c + 4;
    const bin = bins[Math.floor((h / 6) * HUE_BINS) % HUE_BINS]!;
    bin.n += 1;
    bin.r += r;
    bin.g += g;
    bin.b += b;
  }
  const ranked = bins
    .map((bin, i) => ({ ...bin, i }))
    .filter((bin) => bin.n > 0)
    .sort((x, y) => y.n - x.n);
  const first = ranked[0];
  if (!first) return null;
  const apart = (i: number) => {
    const d = Math.abs(i - first.i);
    return Math.min(d, HUE_BINS - d) * (360 / HUE_BINS);
  };
  const second = ranked.find(
    (bin) => apart(bin.i) >= MIN_HUE_APART && bin.n >= first.n * MIN_SECOND_SHARE,
  );
  const avg = (bin: typeof first) => toHex(bin.r / bin.n, bin.g / bin.n, bin.b / bin.n);
  const a = avg(first);
  return [a, second ? avg(second) : lighten(a)];
}

/** Draw on a fresh canvas and read its colours (null: no canvas, or a tainted one). */
function readColors(draw: (ctx: CanvasRenderingContext2D) => void): EmojiColors | null {
  try {
    const canvas = document.createElement('canvas');
    canvas.width = SIZE;
    canvas.height = SIZE;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    draw(ctx);
    const data = ctx.getImageData(0, 0, SIZE, SIZE)?.data;
    return data ? dominantColors(data) : null;
  } catch {
    return null;
  }
}

/** The colours of a unicode emoji (drawn now) or of a cached custom one; null: still loading. */
function colorsNow(emoji: string): EmojiColors | null {
  const key = reactionKey(emoji);
  const hit = cache.get(key);
  if (hit) return hit;
  if (parseCustomEmoji(emoji)) return null;
  const colors =
    readColors((ctx) => {
      ctx.font = `${SIZE - 4}px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(emoji, SIZE / 2, SIZE / 2 + 1);
    }) ?? FALLBACK_COLORS;
  cache.set(key, colors);
  return colors;
}

/** A custom emoji's colours from its still image (once per emoji). */
function loadCustomColors(emoji: string): Promise<EmojiColors> {
  const key = reactionKey(emoji);
  const custom = parseCustomEmoji(emoji);
  const src = custom
    ? mediaUrl(emojiImageUrl(custom, { still: true, known: useEmojis.getState().byId[custom.id] }))
    : undefined;
  let p = loading.get(key);
  if (!p) {
    p = new Promise<EmojiColors>((resolve) => {
      if (!src || typeof Image === 'undefined') return resolve(FALLBACK_COLORS);
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () =>
        resolve(readColors((ctx) => ctx.drawImage(img, 0, 0, SIZE, SIZE)) ?? FALLBACK_COLORS);
      img.onerror = () => resolve(FALLBACK_COLORS);
      img.src = src;
    }).then((colors) => {
      cache.set(key, colors);
      loading.delete(key);
      return colors;
    });
    loading.set(key, p);
  }
  return p;
}

/** The emoji's two colours (the fallback while a custom emoji's image loads). */
export function useEmojiColors(emoji: string): EmojiColors {
  const key = reactionKey(emoji);
  const now = colorsNow(emoji);
  const [loaded, setLoaded] = useState<{ key: string; colors: EmojiColors } | null>(null);
  useEffect(() => {
    if (now) return;
    let live = true;
    void loadCustomColors(emoji).then((colors) => {
      if (live) setLoaded({ key, colors });
    });
    return () => {
      live = false;
    };
  }, [emoji, key, now]);
  return now ?? (loaded?.key === key ? loaded.colors : FALLBACK_COLORS);
}
