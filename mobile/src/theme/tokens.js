/**
 * Enbox design tokens — the same values as the web client's index.css (`:root` / `.dark`).
 * Semantic names match the web's Tailwind colors, so `bg-surface`, `text-muted`,
 * `border-line`, `bg-bubble-out`, `bg-brand/10` … mean the same thing in both apps.
 *
 *   app          window background behind panes
 *   surface      panes, lists, headers           surface-2   inputs, chips, subtle fills
 *   elevated     menus, dialogs, popovers        hover / selected   row states
 *   line         borders & dividers
 *   fg / muted / subtle   primary / secondary / tertiary text
 *   brand        filled brand surfaces (buttons, badges) — text on it: on-brand
 *   brand-ink    brand-colored TEXT/ICONS on surfaces (contrast-safe in both themes)
 *   brand-soft   tinted brand background (selected chip, unread row accent)
 *   bubble-out / bubble-in (+ -meta)   message bubbles (own / others) and their timestamps
 *   wallpaper    conversation background
 */
export const LIGHT = {
  app: '#f4f3f8',
  surface: '#ffffff',
  'surface-2': '#f1f0f6',
  elevated: '#ffffff',
  hover: 'rgba(20, 18, 40, 0.045)',
  selected: '#efedf8',
  line: '#e7e5ef',
  'line-strong': '#d6d3e3',

  fg: '#15141c',
  muted: '#676577',
  subtle: '#6b6979',

  brand: '#6d5dfc',
  'brand-strong': '#5a48e8',
  'brand-ink': '#5646e6',
  'brand-soft': '#eeebff',
  'on-brand': '#ffffff',

  'bubble-out': '#e7e2ff',
  'bubble-out-meta': '#5f5a7c',
  'bubble-in': '#ffffff',
  'bubble-in-meta': '#6e6c7d',
  wallpaper: '#efedf5',
  'wallpaper-ink': 'rgba(109, 93, 252, 0.07)',

  danger: '#e0393e',
  'danger-soft': '#fdecec',
  success: '#16a34a',
  'success-soft': '#e7f7ed',
  warning: '#d97706',
  'warning-soft': '#fdf3e2',
  'warning-ink': '#92400e',
  'danger-fill': '#d93a40',
  unread: '#6d5dfc',
  'unread-muted': '#737184',
  'tick-read': '#1a73c8',
  online: '#22c55e',
  overlay: 'rgba(12, 10, 28, 0.45)',
};

export const DARK = {
  app: '#0b0b10',
  surface: '#111117',
  'surface-2': '#1c1c25',
  elevated: '#1d1d26',
  hover: 'rgba(255, 255, 255, 0.05)',
  selected: '#22212e',
  line: '#24232e',
  'line-strong': '#34333f',

  fg: '#ececf2',
  muted: '#a09fb0',
  subtle: '#88879a',

  brand: '#6d5dfc',
  'brand-strong': '#7f71ff',
  'brand-ink': '#a89eff',
  'brand-soft': '#25214a',
  'on-brand': '#ffffff',

  'bubble-out': '#3b3192',
  'bubble-out-meta': '#c3bdf0',
  'bubble-in': '#1f1f29',
  'bubble-in-meta': '#9594a6',
  wallpaper: '#0d0d13',
  'wallpaper-ink': 'rgba(168, 158, 255, 0.05)',

  danger: '#f2555a',
  'danger-soft': '#3a1a1e',
  success: '#22c55e',
  'success-soft': '#16301f',
  warning: '#f59e0b',
  'warning-soft': '#33260d',
  'warning-ink': '#f59e0b',
  'danger-fill': '#d93a40',
  unread: '#6d5dfc',
  'unread-muted': '#5b5a6a',
  'tick-read': '#53bdeb',
  online: '#22c55e',
  overlay: 'rgba(0, 0, 0, 0.6)',
};

/** Static brand scale (index.css `--color-violet-*`). */
export const VIOLET = {
  50: '#f3f1ff',
  100: '#e7e3ff',
  200: '#d0c9ff',
  300: '#afa3fe',
  400: '#8e80fd',
  500: '#6d5dfc',
  600: '#5a48e8',
  700: '#4a39c7',
  800: '#3c2fa0',
  900: '#2f267d',
  950: '#1d1650',
};

/** `--shadow-color` per theme (hsl h s% l%), for the shadow helpers below. */
const SHADOW_HSL = { light: [250, 30, 20], dark: [240, 30, 2] };

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function shadowColor(theme, a) {
  const [r, g, b] = hslToRgb(...SHADOW_HSL[theme]);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** The web's shadow utilities as React Native `boxShadow` styles (new architecture). */
export function shadowsFor(theme) {
  const dark = theme === 'dark';
  return {
    /** `shadow-bubble`: message bubbles, pills. */
    bubble: { boxShadow: `0px 1px 0.5px ${shadowColor(theme, 0.13)}` },
    /** `shadow-elevated`: menus, dialogs, the floating tab bar, FABs. */
    elevated: {
      boxShadow: `0px 1px 2px ${shadowColor(theme, 0.08)}, 0px 8px 24px -4px ${shadowColor(theme, 0.18)}`,
    },
    /** `--card-shadow`: pane cards. */
    card: {
      boxShadow: dark
        ? `0px 1px 2px ${shadowColor(theme, 0.5)}, 0px 6px 20px -6px ${shadowColor(theme, 0.6)}`
        : `0px 1px 2px ${shadowColor(theme, 0.06)}, 0px 6px 20px -6px ${shadowColor(theme, 0.12)}`,
    },
    /** Tailwind `shadow-sm` (filled buttons). */
    sm: { boxShadow: '0px 1px 3px 0px rgba(0, 0, 0, 0.1), 0px 1px 2px -1px rgba(0, 0, 0, 0.1)' },
  };
}

// ---------------------------------------------------------------------------
// Colour maths (the web uses CSS `color-mix()` for chat accents)
// ---------------------------------------------------------------------------

export function parseColor(c) {
  if (!c) return [0, 0, 0, 1];
  const s = String(c).trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const [r, g, b] = m[1].split('').map((x) => parseInt(x + x, 16));
    return [r, g, b, 1];
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255, m[2] ? parseInt(m[2], 16) / 255 : 1];
  }
  m = /^rgba?\(([^)]+)\)$/i.exec(s);
  if (m) {
    const parts = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number);
    return [parts[0], parts[1], parts[2], parts[3] ?? 1];
  }
  return [0, 0, 0, 1];
}

export function rgba([r, g, b, a]) {
  return `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${Math.round(a * 1000) / 1000})`;
}

/** `color-mix(in srgb, a pct%, b)` */
export function mix(a, pct, b) {
  const x = parseColor(a);
  const y = parseColor(b);
  const p = pct / 100;
  return rgba(x.map((v, i) => v * p + y[i] * (1 - p)));
}

/** A colour at an opacity (`bg-brand/10`). */
export function alpha(c, a) {
  const [r, g, b, a0] = parseColor(c);
  return rgba([r, g, b, a0 * a]);
}
