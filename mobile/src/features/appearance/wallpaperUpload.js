/**
 * Private wallpaper uploads (web features/appearance/wallpaperUpload.ts): an image
 * (≤ MAX_WALLPAPER_BYTES; a GIF gets a poster frame) or a short muted video
 * (≤ MAX_WALLPAPER_VIDEO_BYTES / MAX_WALLPAPER_VIDEO_MS; poster = its first frame). Checked
 * here first; the server re-validates.
 */
import {
  IMAGE_MAX_DIMENSION,
  MAX_WALLPAPER_BYTES,
  MAX_WALLPAPER_VIDEO_BYTES,
  MAX_WALLPAPER_VIDEO_MS,
  WALLPAPER_IMAGE_MIME_TYPES,
  WALLPAPER_VIDEO_MIME_TYPES,
  formatBytes,
} from '@enbox/shared';
import { prepareVideo } from '@/features/conversation/lib/mediaProcessing';
import { api } from '@/lib/api';
import { encodeJpeg, isAnimatedImage, posterOf } from '@/lib/imagePick';

/** Why a file cannot be a wallpaper (null when it can). */
export function wallpaperFileIssue(file) {
  if (WALLPAPER_VIDEO_MIME_TYPES.includes(file.type)) {
    if (file.size && file.size > MAX_WALLPAPER_VIDEO_BYTES)
      return `Video wallpapers can be up to ${formatBytes(MAX_WALLPAPER_VIDEO_BYTES)}.`;
    return null;
  }
  if (!file.type?.startsWith('image/') || file.type === 'image/svg+xml')
    return 'Choose a JPEG, PNG, WebP or GIF image, or an MP4/WebM video.';
  if (isAnimatedImage(file) && file.size && file.size > MAX_WALLPAPER_BYTES)
    return `Wallpaper images can be up to ${formatBytes(MAX_WALLPAPER_BYTES)}.`;
  return null;
}

/** Validate, make the poster and upload. Throws an Error with a user-facing message. */
export async function uploadWallpaper(file, onProgress) {
  const issue = wallpaperFileIssue(file);
  if (issue) throw new Error(issue);

  if (WALLPAPER_VIDEO_MIME_TYPES.includes(file.type) || file.type?.startsWith('video/')) {
    if (file.durationMs && file.durationMs > MAX_WALLPAPER_VIDEO_MS)
      throw new Error(`Video wallpapers can be up to ${MAX_WALLPAPER_VIDEO_MS / 1000} seconds.`);
    const v = await prepareVideo(file);
    if (!v.thumbnail) throw new Error('Could not make a still image for this video');
    return api.upload(
      file,
      { kind: 'video', width: v.width, height: v.height, durationMs: v.durationMs },
      onProgress,
      { fileName: file.name, thumbnail: v.thumbnail },
    );
  }

  if (isAnimatedImage(file)) {
    const thumbnail = await posterOf(file);
    if (!thumbnail) throw new Error('Could not make a still image for this animation');
    return api.upload(file, { kind: 'image', width: file.width, height: file.height }, onProgress, {
      fileName: file.name,
      thumbnail,
    });
  }
  const still = await encodeJpeg(file, IMAGE_MAX_DIMENSION, 0.88);
  if (still.size && still.size > MAX_WALLPAPER_BYTES)
    throw new Error(`Wallpaper images can be up to ${formatBytes(MAX_WALLPAPER_BYTES)}.`);
  const accepted = WALLPAPER_IMAGE_MIME_TYPES.includes(still.type);
  if (!accepted) throw new Error('Choose a JPEG, PNG, WebP or GIF image.');
  return api.upload(
    still,
    { kind: 'image', width: still.width, height: still.height },
    onProgress,
    {
      fileName: still.name,
    },
  );
}
