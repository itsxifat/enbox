/**
 * Chat appearance presets and the precedence resolver (apps/web/README.md "Chat themes &
 * animations"). A theme is enum ids plus one validated `#rrggbb` accent, and every value
 * that reaches CSS comes from the curated tables below or from `color-mix()` of that hex —
 * no user string is ever interpolated.
 *
 *   const a = resolveAppearance({ override: chat.theme, shared: chat.sharedTheme, device: prefs, resolvedTheme, media: chat.wallpaper });
 *   <div style={a.style} {...a.data}>…</div>   // the conversation root
 */
import { CHAT_THEME_PRESET_LABELS, WALLPAPER_BLUR_MAX, WALLPAPER_DIM_MAX } from '@enbox/shared';

// ---------------------------------------------------------------------------
// Theme presets
// ---------------------------------------------------------------------------

/** The variables a preset sets; the same names as the tokens in index.css. */

function vars(out, outMeta, inn, inMeta, wallpaper, ink, soft, tick) {
  return {
    '--bubble-out': out,
    '--bubble-out-meta': outMeta,
    '--bubble-in': inn,
    '--bubble-in-meta': inMeta,
    '--wallpaper': wallpaper,
    '--wallpaper-ink': ink,
    '--brand-soft': soft,
    '--tick-read': tick,
  };
}

/** Curated light + dark pairs per `CHAT_THEME_PRESETS` id; text stays `--fg` on every bubble. */
export const CHAT_THEME_PRESET_DEFS = {
  default: {
    label: CHAT_THEME_PRESET_LABELS.default,
    swatch: { light: '#6d5dfc', dark: '#7f71ff' },
    light: null,
    dark: null,
  },
  midnight: {
    label: CHAT_THEME_PRESET_LABELS.midnight,
    swatch: { light: '#3d55d8', dark: '#7f9cff' },
    light: vars(
      '#dfe4ff',
      '#4a5590',
      '#ffffff',
      '#6b6f85',
      '#e6e9f7',
      'rgb(60 80 200 / 0.08)',
      '#e3e7ff',
      '#2f5ad8',
    ),
    dark: vars(
      '#26306b',
      '#b9c3ff',
      '#161a2b',
      '#9aa0bd',
      '#070a18',
      'rgb(120 140 255 / 0.06)',
      '#1c2350',
      '#7f9cff',
    ),
  },
  ocean: {
    label: CHAT_THEME_PRESET_LABELS.ocean,
    swatch: { light: '#0b7db0', dark: '#4fc3f7' },
    light: vars(
      '#d3ecf6',
      '#2d6a86',
      '#ffffff',
      '#5f7280',
      '#e3f2f8',
      'rgb(20 130 180 / 0.08)',
      '#d9eef7',
      '#0b7db0',
    ),
    dark: vars(
      '#0f4a63',
      '#b5e0f2',
      '#14202a',
      '#90a4b3',
      '#08151d',
      'rgb(80 180 230 / 0.06)',
      '#103a4c',
      '#4fc3f7',
    ),
  },
  forest: {
    label: CHAT_THEME_PRESET_LABELS.forest,
    swatch: { light: '#15803d', dark: '#4ade80' },
    light: vars(
      '#d5f0dc',
      '#2f6d45',
      '#ffffff',
      '#5f7466',
      '#e4f3e8',
      'rgb(30 140 80 / 0.08)',
      '#dcf1e2',
      '#15803d',
    ),
    dark: vars(
      '#17492c',
      '#b8e8c6',
      '#14211a',
      '#8fa896',
      '#08150d',
      'rgb(90 200 130 / 0.06)',
      '#123a24',
      '#4ade80',
    ),
  },
  sunset: {
    label: CHAT_THEME_PRESET_LABELS.sunset,
    swatch: { light: '#d9541e', dark: '#ff9a5c' },
    light: vars(
      '#ffe1cf',
      '#8a4a25',
      '#ffffff',
      '#7a6a60',
      '#fbe9dc',
      'rgb(230 120 50 / 0.09)',
      '#ffe6d6',
      '#d9541e',
    ),
    dark: vars(
      '#6a2f14',
      '#ffd2b8',
      '#241a15',
      '#b09a8c',
      '#170d08',
      'rgb(255 150 90 / 0.06)',
      '#4a2414',
      '#ff9a5c',
    ),
  },
  rose: {
    label: CHAT_THEME_PRESET_LABELS.rose,
    swatch: { light: '#d63a76', dark: '#ff7fb0' },
    light: vars(
      '#fbdbe6',
      '#8a3a58',
      '#ffffff',
      '#7a6570',
      '#f8e4ec',
      'rgb(220 80 140 / 0.08)',
      '#fbe0ea',
      '#d63a76',
    ),
    dark: vars(
      '#5f2440',
      '#ffc7dc',
      '#241620',
      '#b394a3',
      '#170810',
      'rgb(255 120 180 / 0.06)',
      '#4a1c32',
      '#ff7fb0',
    ),
  },
  mono: {
    label: CHAT_THEME_PRESET_LABELS.mono,
    swatch: { light: '#2e2e36', dark: '#d0d0d8' },
    light: vars(
      '#e4e4e8',
      '#4d4d55',
      '#ffffff',
      '#6c6c75',
      '#ededf0',
      'rgb(0 0 0 / 0.06)',
      '#e6e6ea',
      '#2e2e36',
    ),
    dark: vars(
      '#33333b',
      '#c8c8d0',
      '#1c1c21',
      '#9a9aa4',
      '#0c0c0f',
      'rgb(255 255 255 / 0.05)',
      '#26262d',
      '#d0d0d8',
    ),
  },
  lavender: {
    label: CHAT_THEME_PRESET_LABELS.lavender,
    swatch: { light: '#6d4ee0', dark: '#a58bff' },
    light: vars(
      '#e6dcff',
      '#5a4890',
      '#ffffff',
      '#6e6a80',
      '#ece6fb',
      'rgb(140 110 255 / 0.08)',
      '#e8e0ff',
      '#6d4ee0',
    ),
    dark: vars(
      '#3d2f7a',
      '#cfc3ff',
      '#1c1826',
      '#9d97b4',
      '#0e0a1c',
      'rgb(170 150 255 / 0.06)',
      '#2a2150',
      '#a58bff',
    ),
  },
};

// ---------------------------------------------------------------------------
// Wallpaper presets
// ---------------------------------------------------------------------------

export const WALLPAPER_PRESET_DEFS = {
  default: { label: 'Enbox', light: '#efedf5', dark: '#0d0d13', animated: false },
  lavender: { label: 'Lavender', light: '#e4ddff', dark: '#1a1631', animated: false },
  sky: { label: 'Sky', light: '#d9eaf7', dark: '#0e1b27', animated: false },
  mint: { label: 'Mint', light: '#dcf2e5', dark: '#0e1f17', animated: false },
  sand: { label: 'Sand', light: '#f2e8d6', dark: '#211b11', animated: false },
  rose: { label: 'Rose', light: '#f7dfe6', dark: '#281118', animated: false },
  slate: { label: 'Slate', light: '#dfe3ea', dark: '#15191f', animated: false },
  aurora: { label: 'Aurora', light: '#dfe7ff', dark: '#0a0f24', animated: true },
  drift: { label: 'Drift', light: '#e9e6f4', dark: '#0f0d18', animated: true },
  starfield: { label: 'Starfield', light: '#e2e6f0', dark: '#05070f', animated: true },
  waves: { label: 'Waves', light: '#d9ecf5', dark: '#07161f', animated: true },
};

// ---------------------------------------------------------------------------
// Accent colour
// ---------------------------------------------------------------------------

const HEX_RE = /^#[0-9a-f]{6}$/;

/** Text colour of each mode (index.css `--fg`), what an accent bubble must stay readable against. */
const FG = { light: '#15141c', dark: '#ececf2' };

/** Lowercase `#rrggbb`, the only accent form the schema accepts. */
export function isAccentHex(value) {
  return HEX_RE.test(value);
}

/** Loose user input ("#ABC", "abcdef") → canonical lowercase `#rrggbb`, or null. */
export function normalizeHex(input) {
  const raw = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(raw))
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')}`;
  return /^[0-9a-f]{6}$/.test(raw) ? `#${raw}` : null;
}

function luminance(hex) {
  const channel = (i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/** WCAG contrast ratio of two `#rrggbb` colours. */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Minimum contrast of message text on an accent bubble (WCAG large-text / UI threshold). */
export const ACCENT_MIN_CONTRAST = 3;

/** Whether `--fg` text stays readable on a bubble of this accent in the given mode. */
export function contrastOk(accent, resolvedTheme) {
  return isAccentHex(accent) && contrastRatio(accent, FG[resolvedTheme]) >= ACCENT_MIN_CONTRAST;
}

// ---------------------------------------------------------------------------
// Precedence
// ---------------------------------------------------------------------------

/** A private/shared theme with every field unset (falls through to the next layer). */
export const EMPTY_THEME = {
  preset: null,
  bubbleStyle: null,
  accent: null,
  wallpaper: null,
  dim: 0,
  blur: 0,
  messageAnimation: null,
};

/** True when every field of a theme is unset (saving it equals removing it). */
export function isEmptyTheme(theme) {
  return (
    theme.preset === null &&
    theme.bubbleStyle === null &&
    theme.accent === null &&
    theme.wallpaper === null &&
    theme.messageAnimation === null
  );
}

/** Info-panel summary of a chat's theme: the preset in force ("Custom" for a preset-less override). */
export function chatThemeLabel(chat) {
  const preset = chat.theme?.preset ?? chat.sharedTheme?.preset ?? null;
  if (preset) return CHAT_THEME_PRESET_LABELS[preset];
  const custom = (chat.theme && !isEmptyTheme(chat.theme)) || !!chat.sharedTheme;
  return custom ? 'Custom' : 'Default';
}

/** The device prefs as the bottom theme layer. */
export function deviceTheme(prefs) {
  return {
    preset: prefs.chatTheme,
    bubbleStyle: prefs.bubbleStyle,
    accent: null,
    wallpaper: { kind: 'preset', id: prefs.wallpaperPreset },
    dim: prefs.wallpaperDim,
    blur: prefs.wallpaperBlur,
    messageAnimation: prefs.messageAnimation,
  };
}

function clamp(n, max) {
  return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : 0;
}

/** The variables of a preset in a mode (empty for `default`, i.e. the tokens). */
export function presetVars(preset, resolvedTheme) {
  return { ...(CHAT_THEME_PRESET_DEFS[preset]?.[resolvedTheme] ?? {}) };
}

/**
 * Variables of the device layer alone, applied on `<html>` by `stores/ui.ts` so lists,
 * previews and anything outside a conversation root follow the device preset/wallpaper.
 */
export function devicePresetVars(prefs, resolvedTheme) {
  const out = presetVars(prefs.chatTheme, resolvedTheme);
  const wp = WALLPAPER_PRESET_DEFS[prefs.wallpaperPreset];
  if (wp && prefs.wallpaperPreset !== 'default') out['--wallpaper'] = wp[resolvedTheme];
  return out;
}

/**
 * Resolve the look of a chat field by field: override > shared > device > tokens (a `null`
 * field falls through); `dim`/`blur` come from the layer that supplies the wallpaper.
 */
export function resolveAppearance(input) {
  const layers = [];
  if (input.override) layers.push(input.override);
  if (input.shared) layers.push(input.shared);
  layers.push(deviceTheme(input.device));
  const pick = (key) => {
    for (const l of layers) if (l[key] !== null && l[key] !== undefined) return l[key];
    return null;
  };
  const preset = pick('preset') ?? 'default';
  const bubbleStyle = pick('bubbleStyle') ?? 'classic';
  const messageAnimation = pick('messageAnimation') ?? 'fade';
  const rawAccent = pick('accent');
  const accent = rawAccent && contrastOk(rawAccent, input.resolvedTheme) ? rawAccent : null;

  const wallpaperLayer = layers.find((l) => l.wallpaper !== null) ?? layers[layers.length - 1];
  const wallpaper = wallpaperLayer.wallpaper ?? { kind: 'preset', id: 'default' };
  const dim = clamp(wallpaperLayer.dim, WALLPAPER_DIM_MAX);
  const blur = clamp(wallpaperLayer.blur, WALLPAPER_BLUR_MAX);
  const media = wallpaper.kind === 'media' ? (input.media ?? null) : null;

  const style = { ...presetVars(preset, input.resolvedTheme) };
  if (wallpaper.kind === 'preset' && wallpaper.id !== 'default') {
    const wp = WALLPAPER_PRESET_DEFS[wallpaper.id];
    if (wp) style['--wallpaper'] = wp[input.resolvedTheme];
  } else if (wallpaper.kind === 'preset' && preset === 'default') {
    // Back to the token even when <html> carries a device wallpaper.
    style['--wallpaper'] = input.resolvedTheme === 'dark' ? '#0d0d13' : '#efedf5';
  }
  if (accent) {
    // Accent-only: the bubble takes the hex, its meta/ticks are mixes of `--fg` and the hex.
    style['--bubble-out'] = accent;
    style['--bubble-out-meta'] = `color-mix(in srgb, var(--fg) 62%, ${accent})`;
    style['--tick-read'] = `color-mix(in srgb, var(--fg) 55%, ${accent})`;
    style['--brand-soft'] = `color-mix(in srgb, ${accent} 24%, var(--surface))`;
  }

  return {
    preset,
    bubbleStyle,
    accent,
    wallpaper,
    media,
    dim,
    blur,
    messageAnimation,
    style: style,
    data: {
      'data-bubble-style': bubbleStyle,
      'data-msg-anim': messageAnimation,
      'data-wallpaper-preset': wallpaper.kind === 'media' ? 'media' : wallpaper.id,
    },
  };
}
