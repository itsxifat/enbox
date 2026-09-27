/**
 * Status media (web features/status/media.ts): photos are re-encoded (strips EXIF/GPS,
 * longest side ≤ IMAGE_MAX_DIMENSION); GIFs keep their animation and get a poster; videos are
 * checked for length (≤ 60 s). Also the hand-off of a picked file to the composer route.
 */
import { IMAGE_MAX_DIMENSION, MAX_UPLOAD_BYTES, formatBytes } from '@enbox/shared';
import { encodeJpeg, isAnimatedImage, posterOf } from '@/lib/imagePick';
import { MAX_STATUS_VIDEO_MS } from './logic';

export class StatusMediaError extends Error {}

export async function prepareStatusMedia(file) {
  const type = file.type ?? '';
  if (type.startsWith('image/') && type !== 'image/svg+xml') {
    if (isAnimatedImage(file)) {
      const thumbnail = await posterOf(file).catch(() => null);
      if (thumbnail)
        return {
          blob: file,
          meta: { kind: 'image', width: file.width, height: file.height },
          fileName: file.name,
          thumbnail,
        };
    }
    const out = await encodeJpeg(file, IMAGE_MAX_DIMENSION, 0.88).catch(() => {
      throw new StatusMediaError("This photo couldn't be processed");
    });
    return {
      blob: out,
      meta: { kind: 'image', width: out.width, height: out.height },
      fileName: out.name,
    };
  }
  if (type.startsWith('video/')) {
    if (file.size && file.size > MAX_UPLOAD_BYTES)
      throw new StatusMediaError(`Videos can be up to ${formatBytes(MAX_UPLOAD_BYTES)}`);
    if (file.durationMs && file.durationMs > MAX_STATUS_VIDEO_MS + 500)
      throw new StatusMediaError('Status videos can be up to 60 seconds long');
    return {
      blob: file,
      meta: {
        kind: 'video',
        width: file.width || undefined,
        height: file.height || undefined,
        durationMs: file.durationMs || undefined,
      },
      fileName: file.name,
    };
  }
  throw new StatusMediaError('Choose a photo or a video');
}

let pending = null;

/** Hand a picked file to the composer route (the web passes it in the location state). */
export function setPendingStatusFile(file) {
  pending = file;
}

export function takePendingStatusFile() {
  const f = pending;
  pending = null;
  return f;
}
