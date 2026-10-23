/**
 * Gradient app themes (Settings ▸ Chats ▸ Theme ▸ Colour): eight presets and a Custom one made
 * from two picked colours, over Light or the dark palettes. The look itself lives in index.css
 * ("Gradient app themes": `html[data-app-theme]` tints the surfaces with `--theme-hue` and puts
 * a `--theme-a` → `--theme-b` gradient behind the panes); this module names them, turns the
 * Custom colours into those variables (stores/ui.ts sets them inline on <html>) and gives the
 * browser chrome colour of each.
 */
import type { ResolvedTheme } from '@/stores/ui';

export const APP_THEMES = [
  'twilight',
  'aurora',
  'ember',
  'lagoon',
  'blossom',
  'citrus',
  'forest',
  'midnight',
] as const;
export type AppThemePreset = (typeof APP_THEMES)[number];
/** 'default' = the plain palette (no gradient). */
export type AppTheme = 'default' | AppThemePreset | 'custom';

export const APP_THEME_LABELS: Record<AppTheme, string> = {
  default: 'Default',
  twilight: 'Twilight',
  aurora: 'Aurora',
  ember: 'Ember',
  lagoon: 'Lagoon',
  blossom: 'Blossom',
  citrus: 'Citrus',
  forest: 'Forest',
  midnight: 'Midnight',
  custom: 'Custom',
};

/** Surface hue of each preset (keep in sync with `--theme-hue` in index.css). */
const PRESET_HUES: Record<AppThemePreset, number> = {
  twilight: 285,
  aurora: 175,
  ember: 40,
  lagoon: 220,
  blossom: 350,
  citrus: 105,
  forest: 155,
  midnight: 270,
};

/** Brand violet to pink: what Custom starts from. */
export const DEFAULT_CUSTOM_THEME_COLORS: [string, string] = ['#6d5dfc', '#e0529c'];

export function isAppTheme(value: unknown): value is AppTheme {
  return (
    value === 'default' ||
    value === 'custom' ||
    (typeof value === 'string' && (APP_THEMES as readonly string[]).includes(value))
  );
}

/** Two lowercase `#rrggbb` colours (what `<input type="color">` gives). */
export function isCustomThemeColors(value: unknown): value is [string, string] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every((c) => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c))
  );
}

// ---------------------------------------------------------------------------
// OKLCH (Björn Ottosson's OKLab) ↔ sRGB hex
// ---------------------------------------------------------------------------

export interface Oklch {
  l: number;
  c: number;
  /** Degrees, 0..360. */
  h: number;
}

const toLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const toGamma = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** `#rrggbb` → OKLCH, or null for anything else. */
export function hexToOklch(hex: string): Oklch | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return null;
  const n = parseInt(match[1]!, 16);
  const r = toLinear(((n >> 16) & 255) / 255);
  const g = toLinear(((n >> 8) & 255) / 255);
  const b = toLinear((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const h = (Math.atan2(B, A) * 180) / Math.PI;
  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(A, B),
    h: h < 0 ? h + 360 : h,
  };
}

/** OKLCH → `#rrggbb`, each channel clipped to the sRGB gamut. */
export function oklchToHex({ l, c, h }: Oklch): string {
  const rad = (h * Math.PI) / 180;
  const A = c * Math.cos(rad);
  const B = c * Math.sin(rad);
  const L = (l + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const M = (l - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const S = (l - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return `#${[
    4.0767416621 * L - 3.3077115913 * M + 0.2309699292 * S,
    -1.2684380046 * L + 2.6097574011 * M - 0.3413193965 * S,
    -0.0041960863 * L - 0.7034186147 * M + 1.707614701 * S,
  ]
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, toGamma(v))) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

// ---------------------------------------------------------------------------
// Custom theme
// ---------------------------------------------------------------------------

/** The variables a Custom theme sets inline on <html> (cleared for the other themes). */
export const CUSTOM_THEME_VARS = ['--theme-hue', '--theme-tint', '--theme-a', '--theme-b'] as const;
export type CustomThemeVar = (typeof CUSTOM_THEME_VARS)[number];

/** Below this chroma a colour counts as grey (its hue means nothing). */
const ACHROMATIC = 0.02;
/** Gradient stops of a mode: lightness range and chroma cap, so text stays readable. */
const STOP_RANGE: Record<ResolvedTheme, { min: number; max: number; chroma: number }> = {
  dark: { min: 0.26, max: 0.46, chroma: 0.16 },
  light: { min: 0.8, max: 0.94, chroma: 0.1 },
};

function oklchCss(l: number, c: number, h: number): string {
  return `oklch(${l.toFixed(3)} calc(${c.toFixed(4)} * var(--saturation, 1)) ${h.toFixed(1)})`;
}

function customColors(colors: readonly string[]): [Oklch, Oklch] {
  const [a, b] = DEFAULT_CUSTOM_THEME_COLORS;
  return [
    hexToOklch(colors[0] ?? a) ?? hexToOklch(a)!,
    hexToOklch(colors[1] ?? b) ?? hexToOklch(b)!,
  ];
}

/** The surface hue and how strongly to tint (0 for two greys) of a pair of colours. */
function customHue(colors: readonly string[]): { hue: number; tint: number } {
  const [a, b] = customColors(colors);
  const lead = a.c >= ACHROMATIC || b.c < ACHROMATIC ? a : b;
  return { hue: lead.h, tint: Math.min(1, Math.max(a.c, b.c) / 0.08) };
}

/** `--theme-*` of a Custom theme in a mode: the picked hues, stops kept in the mode's range. */
export function customThemeVars(
  colors: readonly string[],
  resolvedTheme: ResolvedTheme,
): Record<CustomThemeVar, string> {
  const range = STOP_RANGE[resolvedTheme];
  const stop = (k: Oklch) =>
    oklchCss(Math.min(range.max, Math.max(range.min, k.l)), Math.min(k.c, range.chroma), k.h);
  const [a, b] = customColors(colors);
  const { hue, tint } = customHue(colors);
  return {
    '--theme-hue': hue.toFixed(1),
    '--theme-tint': tint.toFixed(2),
    '--theme-a': stop(a),
    '--theme-b': stop(b),
  };
}

/** The tinted `--surface` of each mode (keep in sync with index.css). */
const SURFACE: Record<ResolvedTheme, { l: number; c: number }> = {
  dark: { l: 0.235, c: 0.035 },
  light: { l: 0.985, c: 0.012 },
};

/** Browser chrome colour (`theme-color`) of a gradient theme: its surface; null for Default. */
export function appThemeChromeColor(
  theme: AppTheme,
  colors: readonly string[],
  resolvedTheme: ResolvedTheme,
  saturation = 1,
): string | null {
  if (theme === 'default') return null;
  const { hue, tint } =
    theme === 'custom' ? customHue(colors) : { hue: PRESET_HUES[theme], tint: 1 };
  const s = SURFACE[resolvedTheme];
  return oklchToHex({ l: s.l, c: s.c * tint * saturation, h: hue });
}
