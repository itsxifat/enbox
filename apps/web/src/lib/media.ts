/**
 * Media helpers for composing/uploading attachments.
 *
 *   const { width, height } = await readImageDimensions(file);
 *   const { durationMs, width, height } = await readVideoMeta(file);
 *   const url = createObjectUrl(file); ... revokeObjectUrl(url);
 *   const meta = await probeMedia(file); // { kind, width?, height?, durationMs? } for api.upload
 *   const info = await probeImageFile(file); // header facts: { mime, width, height, animated… } | null
 *   const clean = await stripImageBlob(file); // EXIF/XMP/ICC/comments removed (best effort)
 *   const frame = await decodeAnimatedFrame(file); // ImageBitmap poster frame (ImageDecoder) | null
 */
import {
  IMAGE_PROBE_BYTES,
  MAX_BANNER_BYTES,
  readImageInfo,
  stripImageMetadata,
  type ImageInfo,
  type MediaKind,
} from '@enbox/shared';
import type { UploadMeta } from './api';
import { registerSessionReset } from './session';

export interface Dimensions {
  width: number;
  height: number;
}

export interface VideoMeta extends Dimensions {
  durationMs: number;
}

const objectUrls = new Set<string>();

/** `URL.createObjectURL` with tracking so `revokeAllObjectUrls()` can clean up. */
export function createObjectUrl(blob: Blob): string {
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  return url;
}

export function revokeObjectUrl(url: string | null | undefined): void {
  if (!url || !url.startsWith('blob:')) return;
  URL.revokeObjectURL(url);
  objectUrls.delete(url);
}

export function revokeAllObjectUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
}

// Logout: the previous account's local media must not stay readable (or pinned in memory).
registerSessionReset(revokeAllObjectUrls);

function withUrl<T>(src: Blob | string, fn: (url: string) => Promise<T>): Promise<T> {
  if (typeof src === 'string') return fn(src);
  const url = URL.createObjectURL(src);
  return fn(url).finally(() => URL.revokeObjectURL(url));
}

/** Natural size of an image file/URL. */
export function readImageDimensions(src: Blob | string): Promise<Dimensions> {
  return withUrl(
    src,
    (url) =>
      new Promise<Dimensions>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => reject(new Error('Could not read image'));
        img.src = url;
      }),
  );
}

function loadMediaElement<T>(
  tag: 'video' | 'audio',
  url: string,
  read: (el: HTMLVideoElement | HTMLAudioElement) => T,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const el = document.createElement(tag);
    el.preload = 'metadata';
    el.muted = true;
    const cleanup = () => {
      el.removeAttribute('src');
      el.load();
    };
    el.onloadedmetadata = () => {
      // Some browsers report Infinity for webm recordings until seeked.
      if (el.duration === Infinity) {
        el.currentTime = Number.MAX_SAFE_INTEGER;
        el.ontimeupdate = () => {
          el.ontimeupdate = null;
          const v = read(el);
          cleanup();
          resolve(v);
        };
        return;
      }
      const v = read(el);
      cleanup();
      resolve(v);
    };
    el.onerror = () => {
      cleanup();
      reject(new Error(`Could not read ${tag}`));
    };
    el.src = url;
  });
}

/** Duration and size of a video file/URL. */
export function readVideoMeta(src: Blob | string): Promise<VideoMeta> {
  return withUrl(src, (url) =>
    loadMediaElement('video', url, (el) => ({
      durationMs: Math.round((Number.isFinite(el.duration) ? el.duration : 0) * 1000),
      width: (el as HTMLVideoElement).videoWidth,
      height: (el as HTMLVideoElement).videoHeight,
    })),
  );
}

/** Duration (ms) of an audio file/URL. */
export function readAudioDuration(src: Blob | string): Promise<number> {
  return withUrl(src, (url) =>
    loadMediaElement('audio', url, (el) =>
      Math.round((Number.isFinite(el.duration) ? el.duration : 0) * 1000),
    ),
  );
}

/** Pick the upload kind for a file (voice notes are recorded, so never inferred). */
export function mediaKindForFile(file: Pick<File, 'type'>): Exclude<MediaKind, 'voice'> {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml') return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'file';
}

/** Build `api.upload` meta for a picked file (dimensions/duration best effort). */
export async function probeMedia(
  file: File,
  kind: MediaKind = mediaKindForFile(file),
): Promise<UploadMeta> {
  try {
    if (kind === 'image') return { kind, ...(await readImageDimensions(file)) };
    if (kind === 'video') return { kind, ...(await readVideoMeta(file)) };
    if (kind === 'audio' || kind === 'voice')
      return { kind, durationMs: await readAudioDuration(file) };
  } catch {
    /* metadata is optional */
  }
  return { kind };
}

/** Fit (w,h) inside a box preserving aspect ratio — for sizing media bubbles before load. */
export function fitWithin(width: number, height: number, maxW: number, maxH: number): Dimensions {
  if (!width || !height) return { width: maxW, height: Math.round(maxW * 0.75) };
  const scale = Math.min(maxW / width, maxH / height, 1);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

// ---------------------------------------------------------------------------
// Image headers (shared parser): animation detection and metadata stripping
// ---------------------------------------------------------------------------

/**
 * Largest file `probeImageFile` reads in full to settle a GIF's frame count (the biggest
 * animated profile media). A longer GIF whose head is inconclusive counts as animated: it is
 * then uploaded as-is, which is what every GIF got before the header parse existed.
 */
export const FULL_PROBE_MAX_BYTES = MAX_BANNER_BYTES;

/** Blob → bytes; `FileReader` for runtimes without `Blob.arrayBuffer` (old Safari, jsdom). */
async function bytesOf(blob: Blob): Promise<Uint8Array<ArrayBuffer>> {
  if (typeof blob.arrayBuffer === 'function') return new Uint8Array(await blob.arrayBuffer());
  const buffer = await new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error ?? new Error('Could not read file'));
    reader.readAsArrayBuffer(blob);
  });
  return new Uint8Array(buffer);
}

/**
 * Header facts about an image file from the shared `readImageInfo` (type by magic bytes, not
 * `file.type`; declared size; animation). The first IMAGE_PROBE_BYTES settle WebP (VP8X
 * flag), PNG/APNG (`acTL` before `IDAT`) and a GIF whose head already holds two frames; a
 * longer GIF is read in full up to FULL_PROBE_MAX_BYTES. `null` for anything the parser does
 * not know (AVIF, HEIC, SVG, not an image): callers fall back to the browser decoder. Never
 * throws.
 */
export async function probeImageFile(file: Blob): Promise<ImageInfo | null> {
  try {
    const head = await bytesOf(file.slice(0, IMAGE_PROBE_BYTES));
    const info = readImageInfo(head);
    if (!info) return null;
    if (info.mime !== 'image/gif' || info.animated || file.size <= head.length) return info;
    if (file.size <= FULL_PROBE_MAX_BYTES) return readImageInfo(await bytesOf(file)) ?? info;
    return { ...info, animated: true };
  } catch {
    return null;
  }
}

/**
 * Copy of an image without its metadata blocks (EXIF, XMP, ICC, comments, text) — pixels,
 * frames and timing untouched (shared `stripImageMetadata`). Best effort: the same blob when
 * there is nothing to strip, the format is unknown or the bytes cannot be read. The server
 * strips again on upload; this keeps the location data off the wire in the first place.
 */
export async function stripImageBlob(file: Blob): Promise<Blob> {
  try {
    const bytes = await bytesOf(file);
    const out = stripImageMetadata(bytes);
    return out === bytes ? file : new Blob([new Uint8Array(out)], { type: file.type });
  } catch {
    return file;
  }
}

/** The WebCodecs `ImageDecoder` (Chromium); absent in Safari and Firefox. */
interface ImageDecoderLike {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null };
  decode(opts: { frameIndex: number }): Promise<{ image: ImageBitmapSource & { close(): void } }>;
  close(): void;
}

/**
 * A still frame of an animated image for its poster, or `null` when `ImageDecoder` is
 * unavailable or fails (callers then use `createImageBitmap`, i.e. the first frame). Picks the
 * frame a third of the way in, like `videoPoster`: first frames are often blank or a fade-in.
 * The caller closes the bitmap.
 */
export async function decodeAnimatedFrame(file: Blob): Promise<ImageBitmap | null> {
  const Decoder = (
    globalThis as {
      ImageDecoder?: new (init: { data: ArrayBuffer; type: string }) => ImageDecoderLike;
    }
  ).ImageDecoder;
  if (!Decoder) return null;
  let decoder: ImageDecoderLike | null = null;
  try {
    decoder = new Decoder({ data: await file.arrayBuffer(), type: file.type });
    await decoder.tracks.ready;
    const frames = decoder.tracks.selectedTrack?.frameCount ?? 1;
    const { image } = await decoder.decode({ frameIndex: Math.floor(Math.max(0, frames - 1) / 3) });
    try {
      return await createImageBitmap(image);
    } finally {
      image.close();
    }
  } catch {
    return null;
  } finally {
    decoder?.close();
  }
}
