/**
 * Profile themes: a profile with a profile (primary) and/or accent colour paints its whole
 * surface as a vertical primary → accent gradient, dims or lightens it under an inner panel,
 * and picks light or dark ink by contrast. Everything inside reads the usual tokens
 * (`--fg`, `--muted`, `--surface-2`…), which the theme overrides on the surface root, so the
 * shared building blocks need no themed variants. Without colours there is no theme: the
 * surface keeps the app's own colours.
 */
import type { CSSProperties } from 'react';

export type Ink = 'light' | 'dark';

export interface ProfileTheme {
  primary: string;
  accent: string;
  ink: Ink;
  /** The surface background (the gradient). */
  background: string;
  /** The inner panel's veil over the gradient (below the banner). */
  panel: string;
  /** Solid colour of the panel where the avatar sits: its ring and the status bubble. */
  ring: string;
  /** Token overrides for the surface's subtree. */
  vars: CSSProperties;
}

const HEX = /^#([0-9a-f]{6})$/i;

/** `#rrggbb` → [r, g, b] (0–255), or null for anything else. */
export function parseHex(color: string | null | undefined): [number, number, number] | null {
  const m = color ? HEX.exec(color.trim()) : null;
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  const h = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** `a` mixed with `b` by `t` (0 = a, 1 = b), in sRGB. */
export function mixHex(a: string, b: string, t: number): string {
  const x = parseHex(a);
  const y = parseHex(b);
  if (!x || !y) return a;
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** WCAG relative luminance (0 = black, 1 = white); 0 for an unparsable colour. */
export function relativeLuminance(color: string): number {
  const rgb = parseHex(color);
  if (!rgb) return 0;
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio of two colours (1–21). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const DARK_INK = '#060607';
const LIGHT_INK = '#ffffff';

/** The ink that reads best on `background`: white on dark colours, near-black on light ones. */
export function inkOn(background: string): Ink {
  return contrastRatio(background, LIGHT_INK) >= contrastRatio(background, DARK_INK)
    ? 'light'
    : 'dark';
}

/** How much the inner panel veils the gradient (black under light ink, white under dark). */
const PANEL_ALPHA = 0.42;

const LIGHT_VARS = {
  '--fg': LIGHT_INK,
  '--muted': 'rgb(255 255 255 / 0.82)',
  '--subtle': 'rgb(255 255 255 / 0.7)',
  '--surface-2': 'rgb(0 0 0 / 0.3)',
  '--hover': 'rgb(255 255 255 / 0.1)',
  '--selected': 'rgb(255 255 255 / 0.16)',
  '--line': 'rgb(255 255 255 / 0.16)',
  '--line-strong': 'rgb(255 255 255 / 0.28)',
  '--brand-ink': '#d4ceff',
  '--link': '#9dd0ff',
};

const DARK_VARS = {
  '--fg': DARK_INK,
  '--muted': 'rgb(6 6 7 / 0.76)',
  '--subtle': 'rgb(6 6 7 / 0.64)',
  '--surface-2': 'rgb(255 255 255 / 0.42)',
  '--hover': 'rgb(0 0 0 / 0.06)',
  '--selected': 'rgb(0 0 0 / 0.1)',
  '--line': 'rgb(0 0 0 / 0.12)',
  '--line-strong': 'rgb(0 0 0 / 0.22)',
  '--brand-ink': '#3a28c7',
  '--link': '#0047a8',
};

/**
 * The theme of a profile with colours, or null without any. One colour alone still themes
 * the surface: a lone primary fades into a darker shade of itself, a lone accent is the
 * primary as well.
 */
export function profileTheme(
  profileColor: string | null | undefined,
  accentColor: string | null | undefined,
): ProfileTheme | null {
  const p = parseHex(profileColor) ? profileColor!.toLowerCase() : null;
  const a = parseHex(accentColor) ? accentColor!.toLowerCase() : null;
  if (!p && !a) return null;
  const primary = p ?? a!;
  const accent = a ?? mixHex(primary, '#000000', 0.3);
  // Judge the ink on the gradient's middle; the panel's veil then pushes the gradient further
  // away from the ink (darker under white text, lighter under black).
  const middle = mixHex(primary, accent, 0.5);
  const ink = inkOn(middle);
  const veil = ink === 'light' ? '#000000' : '#ffffff';
  const panel = ink === 'light' ? `rgb(0 0 0 / ${PANEL_ALPHA})` : `rgb(255 255 255 / ${PANEL_ALPHA})`;
  return {
    primary,
    accent,
    ink,
    background: `linear-gradient(180deg, ${primary} 0%, ${accent} 100%)`,
    panel,
    ring: mixHex(primary, veil, PANEL_ALPHA),
    vars: { ...(ink === 'light' ? LIGHT_VARS : DARK_VARS), color: 'var(--fg)' } as CSSProperties,
  };
}
