/**
 * Client-side media processing before upload (docs/ARCHITECTURE.md "Media"):
 * - photos are re-encoded through a canvas (strips EXIF/GPS, applies orientation, longest
 *   side ≤ IMAGE_MAX_DIMENSION, JPEG q≈0.85) and get a JPEG thumbnail ≤ MAX_THUMBNAIL_BYTES;
 *   a renamed JPEG is still a photo — the file's bytes decide (`probeImageFile`), not its type;
 * - animated images (GIF, animated WebP, APNG) keep their bytes (re-encoding would drop the
 *   animation), metadata-stripped best effort, with a WebP poster frame as the thumbnail;
 * - videos get a poster thumbnail, duration and dimensions;
 * - documents are uploaded unchanged.
 */
import {
  IMAGE_MAX_DIMENSION,
  MAX_THUMBNAIL_BYTES,
  type ImageInfo,
  type MediaKind,
} from '@enbox/shared';
import { decodeAnimatedFrame, probeImageFile, readVideoMeta, stripImageBlob } from '@/lib/media';

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
  /** Animated image kept as-is; `thumbnail` is its poster. */
  animated?: boolean;
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
  background: string | null = '#ffffff',
): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas unsupported');
  // JPEG has no alpha: flatten transparent PNGs on white instead of black (WebP keeps alpha).
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, width, height);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return canvas;
}

export type ThumbnailFormat = 'jpeg' | 'webp';

/** Whether `canvas.toBlob('image/webp')` really produces WebP here (Safari answers with a PNG). */
let webpEncodable: boolean | null = null;

/**
 * Draw and encode, then release the canvas' backing store right away (browsers cap the total
 * canvas memory — iOS Safari at a few hundred MB — and GC reclaims canvases lazily).
 */
async function encode(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
  format: ThumbnailFormat = 'jpeg',
): Promise<Blob> {
  const webp = format === 'webp' && webpEncodable !== false;
  const canvas = draw(source, width, height, webp ? null : '#ffffff');
  try {
    if (!webp) return await canvasToBlob(canvas, 'image/jpeg', quality);
    const blob = await canvasToBlob(canvas, 'image/webp', quality);
    webpEncodable = blob.type === 'image/webp';
    if (webpEncodable) return blob;
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
  // No WebP encoder: a flattened JPEG (the server accepts both thumbnail types).
  return encode(source, width, height, quality, 'jpeg');
}

export interface ThumbnailOptions {
  /** JPEG (default, flattened on white) or WebP (keeps alpha; JPEG where WebP can't be encoded). */
  format?: ThumbnailFormat;
  /** Longest side of the first attempt: 480 for chat thumbnails, 960 for banner posters. */
  max?: number;
}

/** Thumbnail ≤ MAX_THUMBNAIL_BYTES (shrinks quality/size until it fits). */
export async function makeThumbnail(
  source: CanvasImageSource,
  width: number,
  height: number,
  opts: ThumbnailOptions = {},
): Promise<Blob | null> {
  const max = opts.max ?? 480;
  // 480 → 480, 360, 240, 160.
  for (const [side, q] of [
    [max, 0.72],
    [max * 0.75, 0.62],
    [max * 0.5, 0.55],
    [max / 3, 0.5],
  ] as const) {
    const size = scaled(width, height, Math.round(side));
    const blob = await encode(source, size.width, size.height, q, opts.format);
    if (blob.size <= MAX_THUMBNAIL_BYTES) return blob;
  }
  return null;
}

/** Decode with the browser (EXIF orientation applied; the first frame of an animation). */
export async function decodeImage(
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

/**
 * Poster of an animated image (its `thumbnail` part): a representative frame from
 * `ImageDecoder` where available, else the first frame the browser decodes; WebP so
 * transparent stickers keep their alpha. `max` 960 for banners (the poster is what most
 * viewers see). Rejects when the image cannot be decoded; null when no size fits.
 */
export async function animatedPoster(
  file: Blob,
  opts: Pick<ThumbnailOptions, 'max'> = {},
): Promise<Blob | null> {
  const frame = await decodeAnimatedFrame(file);
  const img = frame
    ? { source: frame, width: frame.width, height: frame.height, close: () => frame.close() }
    : await decodeImage(file);
  try {
    return await makeThumbnail(img.source, img.width, img.height, {
      format: 'webp',
      max: opts.max,
    });
  } finally {
    img.close();
  }
}

/**
 * Animated GIF / WebP / APNG: re-encoding would drop the animation, so the bytes are kept
 * (metadata stripped, best effort) with a poster frame as the thumbnail; the dimensions come
 * from the header (the server verifies them again).
 */
async function prepareAnimatedImage(file: File, info: ImageInfo): Promise<PreparedMedia> {
  const [blob, thumbnail] = await Promise.all([
    stripImageBlob(file),
    animatedPoster(file).catch(() => null),
  ]);
  return {
    kind: 'image',
    blob,
    fileName: file.name,
    mimeType: info.mime,
    width: info.width,
    height: info.height,
    thumbnail,
    animated: true,
  };
}

export async function prepareImage(file: File): Promise<PreparedMedia> {
  const info = await probeImageFile(file);
  if (info?.animated) return prepareAnimatedImage(file, info);
  const img = await decodeImage(file);
  try {
    const thumbnail = await makeThumbnail(img.source, img.width, img.height).catch(() => null);
    const size = scaled(img.width, img.height, IMAGE_MAX_DIMENSION);
    const blob = await encode(img.source, size.width, size.height, 0.85);
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

/**
 * Photos & videos picker entries → upload-ready media. Decoding is memory-heavy (a 12 MP
 * photo is ~48 MB of pixels): process several files one after the other, never all at once
 * (see `prepareEach`).
 */
export function prepareVisualMedia(file: File): Promise<PreparedMedia> {
  if (file.type.startsWith('video/')) return prepareVideo(file);
  return prepareImage(file);
}

/**
 * Prepare files sequentially, handing each result to `onReady` as soon as it is done (so its
 * bubble can appear and its upload start while the next file is processed). `onError` gets
 * the files that couldn't be processed.
 */
export async function prepareEach<T extends { file: File }>(
  items: T[],
  onReady: (prepared: PreparedMedia, item: T, index: number) => void,
  onError: (item: T, index: number) => void,
  prepare: (file: File) => Promise<PreparedMedia> = prepareVisualMedia,
): Promise<void> {
  for (const [i, item] of items.entries()) {
    let prepared: PreparedMedia;
    try {
      prepared = await prepare(item.file);
    } catch {
      onError(item, i);
      continue;
    }
    onReady(prepared, item, i);
  }
}

export function isVisualMedia(file: Pick<File, 'type'>): boolean {
  return (
    (file.type.startsWith('image/') && file.type !== 'image/svg+xml') ||
    file.type.startsWith('video/')
  );
}
