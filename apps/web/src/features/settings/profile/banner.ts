/**
 * Profile banner pipeline: crop to BANNER_ASPECT (5:2) → canvas re-encode (JPEG, longest side
 * ≤ BANNER_MAX_DIMENSION, strips EXIF/GPS, ≤ MAX_BANNER_BYTES) → `api.upload(kind: 'image')`
 * → `PATCH /api/me { bannerMediaId }`. Animated input (GIF / animated WebP / APNG by its bytes)
 * skips the re-encode like avatar.ts: the stripped original goes up with the cropped still as
 * its poster (`thumbnail` part), and the server keeps `bannerUrl` static.
 *
 * Crop geometry generalises avatar.ts to a `viewport: { width, height }` of any aspect ratio:
 * the image is drawn at `scale = coverScale × zoom`; `x`/`y` are its top-left offset relative
 * to the viewport (always ≤ 0 so the viewport stays covered).
 */
import {
  ANIMATED_IMAGE_MIME_TYPES,
  BANNER_ASPECT,
  BANNER_MIME_TYPES,
  MAX_BANNER_BYTES,
  formatBytes,
  type ImageInfo,
  type UserSelf,
} from '@enbox/shared';
import { makeThumbnail } from '@/features/conversation/lib/mediaProcessing';
import { api } from '@/lib/api';
import { stripImageBlob } from '@/lib/media';
import { useAuth } from '@/stores/auth';

/** Longest side of a re-encoded banner. */
export const BANNER_MAX_DIMENSION = 1600;
/** Longest side of an animated banner's poster (the still most viewers see). */
export const BANNER_POSTER_MAX = 960;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;

export interface ImageSize {
  width: number;
  height: number;
}

export type Viewport = ImageSize;

export interface CropState {
  zoom: number;
  /** Image top-left relative to the viewport (px, ≤ 0). */
  x: number;
  y: number;
}

/** The crop viewport for a given width: BANNER_ASPECT tall. */
export function bannerViewport(width: number): Viewport {
  const [w, h] = BANNER_ASPECT;
  return { width, height: Math.round((width * h) / w) };
}

/** Scale at which the image exactly covers the viewport (its tighter side fits). */
export function coverScale(img: ImageSize, viewport: Viewport): number {
  return Math.max(viewport.width / img.width, viewport.height / img.height);
}

/** Keep the viewport fully covered: clamp offsets to [viewport − displayed size, 0]. */
export function clampCrop(state: CropState, img: ImageSize, viewport: Viewport): CropState {
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, state.zoom));
  const scale = coverScale(img, viewport) * zoom;
  const w = img.width * scale;
  const h = img.height * scale;
  return {
    zoom,
    x: Math.min(0, Math.max(viewport.width - w, state.x)),
    y: Math.min(0, Math.max(viewport.height - h, state.y)),
  };
}

/** Initial state: zoom 1, image centered. */
export function initialCrop(img: ImageSize, viewport: Viewport): CropState {
  const scale = coverScale(img, viewport);
  return clampCrop(
    {
      zoom: 1,
      x: (viewport.width - img.width * scale) / 2,
      y: (viewport.height - img.height * scale) / 2,
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
  viewport: Viewport,
  anchor: { x: number; y: number } = { x: viewport.width / 2, y: viewport.height / 2 },
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

export interface CropRect {
  sx: number;
  sy: number;
  width: number;
  height: number;
}

/** The source rectangle (image pixels, the viewport's aspect ratio) currently shown. */
export function cropRect(state: CropState, img: ImageSize, viewport: Viewport): CropRect {
  const scale = coverScale(img, viewport) * state.zoom;
  const width = Math.min(viewport.width / scale, img.width);
  const height = Math.min(viewport.height / scale, img.height);
  const sx = Math.min(Math.max(0, -state.x / scale), img.width - width);
  const sy = Math.min(Math.max(0, -state.y / scale), img.height - height);
  return { sx, sy, width, height };
}

/** Output size: the crop's own resolution, longest side capped at `max`, aspect kept. */
export function outputSize(rect: ImageSize, max = BANNER_MAX_DIMENSION): ImageSize {
  const scale = Math.min(1, max / Math.max(rect.width, rect.height));
  return {
    width: Math.max(1, Math.round(rect.width * scale)),
    height: Math.max(1, Math.round(rect.height * scale)),
  };
}

export function isAcceptedBanner(file: File): boolean {
  return file.type.startsWith('image/') && file.type !== 'image/svg+xml';
}

/** Why an animated file cannot be a banner (null when it can). */
export function animatedBannerIssue(file: Blob, info: ImageInfo): string | null {
  if (
    !(ANIMATED_IMAGE_MIME_TYPES as readonly string[]).includes(info.mime) ||
    !(BANNER_MIME_TYPES as readonly string[]).includes(info.mime)
  )
    return 'Animated banners must be a GIF, WebP or PNG.';
  if (file.size > MAX_BANNER_BYTES)
    return `Banners can be up to ${formatBytes(MAX_BANNER_BYTES)}. Choose a smaller one or a still image.`;
  return null;
}

function drawCrop(image: CanvasImageSource, rect: CropRect, out: ImageSize, flatten: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = out.width;
  canvas.height = out.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image');
  if (flatten) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, out.width, out.height);
  }
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(image, rect.sx, rect.sy, rect.width, rect.height, 0, 0, out.width, out.height);
  return canvas;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode the image'))),
      type,
      quality,
    ),
  );
}

/** Render the crop as a JPEG ≤ MAX_BANNER_BYTES (white background for transparent PNGs). */
export async function renderBanner(
  image: CanvasImageSource,
  rect: CropRect,
): Promise<{ blob: Blob } & ImageSize> {
  const out = outputSize(rect);
  const canvas = drawCrop(image, rect, out, true);
  try {
    let quality = 0.9;
    let blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    while (blob.size > MAX_BANNER_BYTES && quality > 0.5) {
      quality -= 0.15;
      blob = await canvasToBlob(canvas, 'image/jpeg', quality);
    }
    return { blob, ...out };
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/**
 * The cropped still of an animated banner — its poster (WebP, alpha kept, ≤ MAX_THUMBNAIL_BYTES,
 * longest side ≤ BANNER_POSTER_MAX). `image` is the animating <img>, so the frame on screen
 * when the user confirms becomes the still.
 */
export async function renderBannerPoster(image: CanvasImageSource, rect: CropRect): Promise<Blob> {
  const out = outputSize(rect, BANNER_POSTER_MAX);
  const canvas = drawCrop(image, rect, out, false);
  try {
    const poster = await makeThumbnail(canvas, out.width, out.height, {
      format: 'webp',
      max: BANNER_POSTER_MAX,
    });
    if (!poster) throw new Error('Could not make a still image for this animation');
    return poster;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}

async function setBanner(bannerMediaId: string | null): Promise<UserSelf> {
  const user = await api.patch<UserSelf>('/api/me', { bannerMediaId });
  useAuth.getState().setUser(user);
  return user;
}

/** Upload a rendered banner and set it as my profile banner. */
export async function uploadBanner(
  blob: Blob,
  size: ImageSize,
  onProgress?: (fraction: number) => void,
): Promise<UserSelf> {
  const media = await api.upload(blob, { kind: 'image', ...size }, onProgress, {
    fileName: 'banner.jpg',
  });
  return setBanner(media.id);
}

/** Upload an animated banner as-is (metadata stripped) with its cropped poster. */
export async function uploadAnimatedBanner(
  file: File,
  info: ImageInfo,
  poster: Blob,
  onProgress?: (fraction: number) => void,
): Promise<UserSelf> {
  const issue = animatedBannerIssue(file, info);
  if (issue) throw new Error(issue);
  const blob = await stripImageBlob(file);
  const media = await api.upload(
    blob,
    { kind: 'image', width: info.width, height: info.height },
    onProgress,
    { fileName: file.name, thumbnail: poster },
  );
  return setBanner(media.id);
}

export function removeBanner(): Promise<UserSelf> {
  return setBanner(null);
}
