/**
 * Client-side media processing before upload (docs/ARCHITECTURE.md "Media"):
 * - photos are re-encoded through a canvas (strips EXIF/GPS, applies orientation, longest
 *   side ≤ IMAGE_MAX_DIMENSION, JPEG q≈0.85) and get a JPEG thumbnail ≤ MAX_THUMBNAIL_BYTES;
 *   animated GIFs are sent as-is (re-encoding would drop the animation);
 * - videos get a poster thumbnail, duration and dimensions;
 * - documents are uploaded unchanged.
 */
import { IMAGE_MAX_DIMENSION, MAX_THUMBNAIL_BYTES, type MediaKind } from '@enbox/shared';
import { readVideoMeta } from '@/lib/media';

export interface PreparedMedia {
  kind: Exclude<MediaKind, 'voice'>;
  /** Bytes to upload. */
  blob: Blob;
  fileName: string;
  mimeType: string;
  width?: number;
  height?: number;
  durationMs?: number;
  thumbnail: Blob | null;
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Could not encode image'))),
      type,
      quality,
    ),
  );
}

function scaled(width: number, height: number, max: number): { width: number; height: number } {
  const scale = Math.min(1, max / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function draw(
  source: CanvasImageSource,
  width: number,
  height: number,
  background = '#ffffff',
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');
  // JPEG has no alpha: flatten transparent PNGs on white instead of black.
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

/** JPEG thumbnail ≤ MAX_THUMBNAIL_BYTES (shrinks quality/size until it fits). */
export async function makeThumbnail(
  source: CanvasImageSource,
  width: number,
  height: number,
): Promise<Blob | null> {
  for (const [max, q] of [
    [480, 0.72],
    [360, 0.62],
    [240, 0.55],
    [160, 0.5],
  ] as const) {
    const size = scaled(width, height, max);
    const blob = await canvasToBlob(draw(source, size.width, size.height), 'image/jpeg', q);
    if (blob.size <= MAX_THUMBNAIL_BYTES) return blob;
  }
  return null;
}

async function decodeImage(
  file: Blob,
): Promise<{ source: CanvasImageSource; width: number; height: number; close(): void }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
      return { source: bmp, width: bmp.width, height: bmp.height, close: () => bmp.close() };
    } catch {
      /* fall back to <img> */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    return {
      source: img,
      width: img.naturalWidth,
      height: img.naturalHeight,
      close: () => undefined,
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function jpegName(name: string): string {
  const base = name.replace(/\.[^./\\]+$/, '') || 'photo';
  return `${base}.jpg`;
}

export async function prepareImage(file: File): Promise<PreparedMedia> {
  const img = await decodeImage(file);
  try {
    const thumbnail = await makeThumbnail(img.source, img.width, img.height).catch(() => null);
    if (file.type === 'image/gif') {
      return {
        kind: 'image',
        blob: file,
        fileName: file.name,
        mimeType: file.type,
        width: img.width,
        height: img.height,
        thumbnail,
      };
    }
    const size = scaled(img.width, img.height, IMAGE_MAX_DIMENSION);
    const blob = await canvasToBlob(draw(img.source, size.width, size.height), 'image/jpeg', 0.85);
    return {
      kind: 'image',
      blob,
      fileName: jpegName(file.name),
      mimeType: 'image/jpeg',
      width: size.width,
      height: size.height,
      thumbnail,
    };
  } finally {
    img.close();
  }
}

/** Grab a frame of a video as a poster thumbnail. */
export function videoPoster(
  file: Blob,
): Promise<{ thumbnail: Blob | null; width: number; height: number }> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'auto';
    video.muted = true;
    video.playsInline = true;
    let done = false;
    const finish = (v: { thumbnail: Blob | null; width: number; height: number }) => {
      if (done) return;
      done = true;
      URL.revokeObjectURL(url);
      video.removeAttribute('src');
      video.load();
      resolve(v);
    };
    const timer = setTimeout(() => finish({ thumbnail: null, width: 0, height: 0 }), 8000);
    video.onloadeddata = () => {
      video.currentTime = Math.min(0.5, (video.duration || 1) / 3);
    };
    video.onseeked = () => {
      clearTimeout(timer);
      const width = video.videoWidth;
      const height = video.videoHeight;
      makeThumbnail(video, width, height)
        .then((thumbnail) => finish({ thumbnail, width, height }))
        .catch(() => finish({ thumbnail: null, width, height }));
    };
    video.onerror = () => {
      clearTimeout(timer);
      finish({ thumbnail: null, width: 0, height: 0 });
    };
    video.src = url;
  });
}

export async function prepareVideo(file: File): Promise<PreparedMedia> {
  const [meta, poster] = await Promise.all([
    readVideoMeta(file).catch(() => null),
    videoPoster(file).catch(() => null),
  ]);
  return {
    kind: 'video',
    blob: file,
    fileName: file.name,
    mimeType: file.type,
    width: meta?.width || poster?.width || undefined,
    height: meta?.height || poster?.height || undefined,
    durationMs: meta?.durationMs || undefined,
    thumbnail: poster?.thumbnail ?? null,
  };
}

/** Photos & videos picker entries → upload-ready media. */
export function prepareVisualMedia(file: File): Promise<PreparedMedia> {
  if (file.type.startsWith('video/')) return prepareVideo(file);
  return prepareImage(file);
}

export function isVisualMedia(file: Pick<File, 'type'>): boolean {
  return (
    (file.type.startsWith('image/') && file.type !== 'image/svg+xml') ||
    file.type.startsWith('video/')
  );
}
