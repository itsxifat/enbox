/**
 * Media helpers for composing/uploading attachments.
 *
 *   const { width, height } = await readImageDimensions(file);
 *   const { durationMs, width, height } = await readVideoMeta(file);
 *   const url = createObjectUrl(file); ... revokeObjectUrl(url);
 *   const meta = await probeMedia(file); // { kind, width?, height?, durationMs? } for api.upload
 */
import type { MediaKind } from '@enbox/shared';
import type { UploadMeta } from './api';

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
