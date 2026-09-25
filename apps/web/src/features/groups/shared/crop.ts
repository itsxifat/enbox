/**
 * Pure math for the square avatar cropper (group/community/channel icons).
 *
 * Model: the image is drawn centered in a square viewport of `view` px, scaled so it covers
 * the viewport at zoom 1 ("cover"), multiplied by `zoom` (≥ 1), then moved by `offset`
 * (viewport px, image center relative to viewport center). The offset is clamped so the
 * image always covers the viewport (no empty corners in the crop).
 */
import { AVATAR_MAX_DIMENSION } from '@enbox/shared';

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

/** Scale at which the image exactly covers a `view`×`view` square. */
export function coverScale(img: Size, view: number): number {
  if (!img.width || !img.height) return 1;
  return view / Math.min(img.width, img.height);
}

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/** Keep the image covering the viewport for this zoom. */
export function clampOffset(offset: Point, img: Size, view: number, zoom: number): Point {
  const s = coverScale(img, view) * clampZoom(zoom);
  const maxX = Math.max(0, (img.width * s - view) / 2);
  const maxY = Math.max(0, (img.height * s - view) / 2);
  const clamp = (v: number, m: number) => {
    const c = Math.min(m, Math.max(-m, v));
    return Math.abs(c) < 1e-9 ? 0 : c; // also normalizes -0
  };
  return { x: clamp(offset.x, maxX), y: clamp(offset.y, maxY) };
}

/**
 * Zoom around a viewport point (e.g. the wheel cursor), keeping the image point under it
 * fixed, then clamp. `anchor` is relative to the viewport center.
 */
export function zoomAt(
  offset: Point,
  img: Size,
  view: number,
  fromZoom: number,
  toZoom: number,
  anchor: Point = { x: 0, y: 0 },
): Point {
  const z0 = clampZoom(fromZoom);
  const z1 = clampZoom(toZoom);
  const k = z1 / z0;
  const next = { x: anchor.x - (anchor.x - offset.x) * k, y: anchor.y - (anchor.y - offset.y) * k };
  return clampOffset(next, img, view, z1);
}

export interface CropRect {
  /** Source square in image pixels. */
  sx: number;
  sy: number;
  size: number;
  /** Output edge in px (source size capped at AVATAR_MAX_DIMENSION). */
  out: number;
}

/** The source square of the image currently visible in the viewport. */
export function cropRect(
  img: Size,
  view: number,
  zoom: number,
  offset: Point,
  maxOut: number = AVATAR_MAX_DIMENSION,
): CropRect {
  const z = clampZoom(zoom);
  const o = clampOffset(offset, img, view, z);
  const s = coverScale(img, view) * z;
  const size = view / s;
  const cx = img.width / 2 - o.x / s;
  const cy = img.height / 2 - o.y / s;
  const sx = Math.max(0, Math.min(img.width - size, cx - size / 2));
  const sy = Math.max(0, Math.min(img.height - size, cy - size / 2));
  return { sx, sy, size, out: Math.max(1, Math.round(Math.min(size, maxOut))) };
}
