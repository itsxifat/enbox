/**
 * Profile photo pipeline (agent 1): square crop → canvas re-encode (JPEG, longest side ≤
 * AVATAR_MAX_DIMENSION, strips EXIF/GPS) → `api.upload(kind: 'image')` → `PATCH /api/me`.
 *
 * Crop geometry: the image is drawn inside a square viewport of `viewport` px at
 * `scale = coverScale × zoom`; `x`/`y` are the image's top-left offset relative to the
 * viewport (always ≤ 0 so the viewport stays covered).
 */
import {
  AVATAR_MAX_DIMENSION,
  AVATAR_MIME_TYPES,
  MAX_AVATAR_BYTES,
  type UserSelf,
} from '@enbox/shared';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface ImageSize {
  width: number;
  height: number;
}

export interface CropState {
  zoom: number;
  /** Image top-left relative to the viewport (px, ≤ 0). */
  x: number;
  y: number;
}

/** Scale at which the image's short side exactly covers the viewport. */
export function coverScale(img: ImageSize, viewport: number): number {
  return viewport / Math.min(img.width, img.height);
}

/** Keep the viewport fully covered: clamp offsets to [viewport − displayed size, 0]. */
export function clampCrop(state: CropState, img: ImageSize, viewport: number): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom));
  const scale = coverScale(img, viewport) * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  return {
    zoom,
    x: Math.min(0, Math.max(viewport - w, state.x)),
    y: Math.min(0, Math.max(viewport - h, state.y)),
  };
}

/** Initial state: zoom 1, image centered. */
export function initialCrop(img: ImageSize, viewport: number): CropState {
  const scale = coverScale(img, viewport);
  return clampCrop(
    {
      zoom: 1,
      x: (viewport - img.width * scale) / 2,
      y: (viewport - img.height * scale) / 2,
    },
    img,
    viewport,
  );
}

/** Change zoom keeping the image point under `anchor` (default: viewport center) fixed. */
export function zoomCrop(
  state: CropState,
  zoom: number,
  img: ImageSize,
  viewport: number,
  anchor: { x: number; y: number } = { x: viewport / 2, y: viewport / 2 },
): CropState {
  const base = coverScale(img, viewport);
  const from = base * state.zoom;
  const nextZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const to = base * nextZoom;
  // Image coordinates of the anchor stay put.
  const ix = (anchor.x - state.x) / from;
  const iy = (anchor.y - state.y) / from;
  return clampCrop({ zoom: nextZoom, x: anchor.x - ix * to, y: anchor.y - iy * to }, img, viewport);
}

/** The square source rectangle (image pixels) currently shown in the viewport. */
export function cropRect(
  state: CropState,
  img: ImageSize,
  viewport: number,
): { sx: number; sy: number; size: number } {
  const scale = coverScale(img, viewport) * state.zoom;
  const size = Math.min(viewport / scale, img.width, img.height);
  const sx = Math.min(Math.max(0, -state.x / scale), img.width - size);
  const sy = Math.min(Math.max(0, -state.y / scale), img.height - size);
  return { sx, sy, size };
}

/** Output edge length: the crop's own resolution, capped at AVATAR_MAX_DIMENSION. */
export function outputSize(cropSize: number, max = AVATAR_MAX_DIMENSION): number {
  return Math.max(1, Math.min(max, Math.round(cropSize)));
}

export function isAcceptedImage(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

/** Decode an image file (object URL + HTMLImageElement; EXIF orientation is applied by browsers). */
export async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.decoding = 'async';
  img.src = src;
  try {
    await img.decode();
  } catch {
    throw new Error("This image can't be opened. Try a JPEG or PNG.");
  }
  return img;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the photo'))),
      type,
      quality,
    ),
  );
}

/** Render the crop to a square JPEG (white background for transparent PNGs). */
export async function renderAvatar(
  image: CanvasImageSource,
  rect: { sx: number; sy: number; size: number },
): Promise<{ blob: Blob; size: number }> {
  const size = outputSize(rect.size);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the photo');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, size, size);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, rect.sx, rect.sy, rect.size, rect.size, 0, 0, size, size);
  let quality = 0.9;
  let blob = await canvasToBlob(canvas, AVATAR_MIME_TYPES[0], quality);
  while (blob.size > MAX_AVATAR_BYTES && quality > 0.5) {
    quality -= 0.15;
    blob = await canvasToBlob(canvas, AVATAR_MIME_TYPES[0], quality);
  }
  return { blob, size };
}

/** Upload a rendered avatar and set it as my profile photo. */
export async function uploadAvatar(
  blob: Blob,
  size: number,
  onProgress?: (fraction: number) => void,
): Promise<UserSelf> {
  const media = await api.upload(blob, { kind: 'image', width: size, height: size }, onProgress, {
    fileName: 'avatar.jpg',
  });
  const user = await api.patch<UserSelf>('/api/me', { avatarMediaId: media.id });
  useAuth.getState().setUser(user);
  return user;
}

export async function removeAvatar(): Promise<UserSelf> {
  const user = await api.patch<UserSelf>('/api/me', { avatarMediaId: null });
  useAuth.getState().setUser(user);
  return user;
}
