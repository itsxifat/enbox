/**
 * The tab's favicon and the installed app's badge (Discord):
 * - `setFaviconBadge('3')` redraws the app icon on a canvas with a red badge in the corner;
 *   `setFaviconBadge('')` puts the original icon back. Best effort: without a 2D canvas (old
 *   browsers, tests) the icon stays as it is.
 * - `setAppBadge(3)` / `setAppBadge(0)`: `navigator.setAppBadge` / `clearAppBadge` where the
 *   Badging API exists (installed PWAs).
 */

/** Raster art of the icon (an SVG without intrinsic size can't be drawn everywhere). */
const ICON_SOURCE = '/icons/icon-192.png';
const SIZE = 64;
/** Fallback for the `--danger-fill` token (Discord's red). */
const BADGE_RED = '#da373c';

let original: { href: string; type: string } | null = null;
let image: Promise<HTMLImageElement | null> | null = null;
/** The latest request: a slower earlier draw must not overwrite it. */
let current = '';

function iconLink(): HTMLLinkElement | null {
  return document.querySelector<HTMLLinkElement>('link[rel~="icon"]');
}

function loadIcon(): Promise<HTMLImageElement | null> {
  image ??= new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      image = null;
      resolve(null);
    };
    img.src = ICON_SOURCE;
  });
  return image;
}

function badgeRed(): string {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--danger-fill').trim();
    return v || BADGE_RED;
  } catch {
    return BADGE_RED;
  }
}

/** The icon with `label` in a red circle (a pill for "9+") at the bottom right, as a PNG data URL. */
function draw(img: HTMLImageElement, label: string): string | null {
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  let ctx: CanvasRenderingContext2D | null;
  try {
    ctx = canvas.getContext('2d');
  } catch {
    return null;
  }
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0, SIZE, SIZE);
  const h = 38;
  ctx.font = `bold ${label.length > 1 ? 28 : 32}px system-ui, -apple-system, "Segoe UI", sans-serif`;
  const w = Math.max(h, Math.ceil(ctx.measureText(label).width) + 14);
  const x = SIZE - w;
  const y = SIZE - h;
  const r = h / 2;
  ctx.fillStyle = badgeRed();
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, Math.PI / 2);
  ctx.lineTo(x + r, y + h);
  ctx.arc(x + r, y + r, r, Math.PI / 2, (3 * Math.PI) / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, x + w / 2, y + r + 1);
  try {
    return canvas.toDataURL('image/png');
  } catch {
    return null;
  }
}

function restore(link: HTMLLinkElement): void {
  if (!original) return;
  link.type = original.type;
  link.href = original.href;
  original = null;
}

/** Show `label` ("1"…"9", "9+") on the favicon; '' restores the original icon. */
export function setFaviconBadge(label: string): void {
  if (typeof document === 'undefined') return;
  current = label;
  const link = iconLink();
  if (!link) return;
  if (!label) {
    restore(link);
    return;
  }
  void loadIcon().then((img) => {
    if (!img || current !== label) return;
    const url = draw(img, label);
    if (!url) return;
    const live = iconLink();
    if (!live) return;
    original ??= { href: live.getAttribute('href') ?? '', type: live.type };
    live.type = 'image/png';
    live.href = url;
  });
}

type BadgingNavigator = Navigator & {
  setAppBadge?: (contents?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
};

/** The installed app's badge: the count, or cleared at 0 (no-op where unsupported). */
export function setAppBadge(count: number): void {
  if (typeof navigator === 'undefined') return;
  const nav = navigator as BadgingNavigator;
  try {
    const p = count > 0 ? nav.setAppBadge?.(count) : nav.clearAppBadge?.();
    void p?.catch(() => undefined);
  } catch {
    /* not allowed (e.g. not installed) */
  }
}
