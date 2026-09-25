/**
 * Status media preparation: photos are re-encoded through a canvas (strips EXIF/GPS, longest
 * side ≤ IMAGE_MAX_DIMENSION, orientation applied); videos are checked for length.
 */
import { IMAGE_MAX_DIMENSION, MAX_UPLOAD_BYTES, formatBytes } from '@enbox/shared';
import type { UploadMeta } from '@/lib/api';
import { readVideoMeta } from '@/lib/media';
import { MAX_STATUS_VIDEO_MS } from './logic';

export interface PreparedMedia {
  blob: Blob;
  meta: UploadMeta & { kind: 'image' | 'video' };
  fileName: string;
}

export class StatusMediaError extends Error {}

function baseName(name: string): string {
  return name.replace(/\.[^.]+$/, '') || 'status';
}

async function decode(
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
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new StatusMediaError("This photo couldn't be opened"));
      el.src = url;
    });
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

/** Re-encode a photo as JPEG (GIFs keep their animation and are uploaded as-is). */
export async function prepareStatusImage(file: File): Promise<PreparedMedia> {
  if (file.type === 'image/gif') {
    return { blob: file, meta: { kind: 'image' }, fileName: file.name };
  }
  const img = await decode(file);
  try {
    const scale = Math.min(1, IMAGE_MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new StatusMediaError("This photo couldn't be processed");
    ctx.drawImage(img.source, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', 0.88),
    );
    if (!blob) throw new StatusMediaError("This photo couldn't be processed");
    return { blob, meta: { kind: 'image', width, height }, fileName: `${baseName(file.name)}.jpg` };
  } finally {
    img.close();
  }
}

export async function prepareStatusVideo(file: File): Promise<PreparedMedia> {
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new StatusMediaError(`Videos can be up to ${formatBytes(MAX_UPLOAD_BYTES)}`);
  }
  const meta = await readVideoMeta(file).catch(() => {
    throw new StatusMediaError("This video couldn't be played");
  });
  if (meta.durationMs > MAX_STATUS_VIDEO_MS + 500) {
    throw new StatusMediaError('Status videos can be up to 60 seconds long');
  }
  return {
    blob: file,
    meta: {
      kind: 'video',
      width: meta.width || undefined,
      height: meta.height || undefined,
      durationMs: meta.durationMs || undefined,
    },
    fileName: file.name,
  };
}

export function prepareStatusMedia(file: File): Promise<PreparedMedia> {
  if (file.type.startsWith('image/') && file.type !== 'image/svg+xml')
    return prepareStatusImage(file);
  if (file.type.startsWith('video/')) return prepareStatusVideo(file);
  return Promise.reject(new StatusMediaError('Choose a photo or a video'));
}
