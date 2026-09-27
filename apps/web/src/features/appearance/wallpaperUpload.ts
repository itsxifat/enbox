/**
 * Private wallpaper uploads (README "Chat themes & animations" → Editing): an image
 * (WALLPAPER_IMAGE_MIME_TYPES ≤ MAX_WALLPAPER_BYTES; a GIF/animated image gets a poster
 * frame) or a short muted video (WALLPAPER_VIDEO_MIME_TYPES ≤ MAX_WALLPAPER_VIDEO_BYTES /
 * MAX_WALLPAPER_VIDEO_MS; poster = a captured frame). Checked client-side first so the
 * common mistakes never leave the device; the server re-validates and answers 400.
 *
 *   const media = await uploadWallpaper(file, setProgress);
 *   await patchPrefs(chat, { wallpaperMediaId: media.id, theme: { …, wallpaper: { kind: 'media' } } });
 */
import {
  MAX_WALLPAPER_BYTES,
  MAX_WALLPAPER_VIDEO_BYTES,
  MAX_WALLPAPER_VIDEO_MS,
  WALLPAPER_IMAGE_MIME_TYPES,
  WALLPAPER_VIDEO_MIME_TYPES,
  formatBytes,
  type MediaAttachment,
} from '@enbox/shared';
import {
  decodeImage,
  makeThumbnail,
  videoPoster,
} from '@/features/conversation/lib/mediaProcessing';
import { api } from '@/lib/api';
import {
  decodeAnimatedFrame,
  probeImageFile,
  readImageDimensions,
  readVideoMeta,
  stripImageBlob,
} from '@/lib/media';

export const WALLPAPER_ACCEPT = [...WALLPAPER_IMAGE_MIME_TYPES, ...WALLPAPER_VIDEO_MIME_TYPES].join(
  ',',
);

/** Why a file cannot be a wallpaper (null when it can), before any bytes are read. */
export function wallpaperFileIssue(file: Pick<File, 'type' | 'size'>): string | null {
  if ((WALLPAPER_VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
    if (file.size > MAX_WALLPAPER_VIDEO_BYTES)
      return `Video wallpapers can be up to ${formatBytes(MAX_WALLPAPER_VIDEO_BYTES)}.`;
    return null;
  }
  if (!(WALLPAPER_IMAGE_MIME_TYPES as readonly string[]).includes(file.type))
    return 'Choose a JPEG, PNG, WebP or GIF image, or an MP4/WebM video.';
  if (file.size > MAX_WALLPAPER_BYTES)
    return `Wallpaper images can be up to ${formatBytes(MAX_WALLPAPER_BYTES)}.`;
  return null;
}

async function imagePoster(file: Blob): Promise<Blob | null> {
  const frame = await decodeAnimatedFrame(file);
  if (frame) {
    try {
      return await makeThumbnail(frame, frame.width, frame.height, { max: 960 });
    } finally {
      frame.close();
    }
  }
  const decoded = await decodeImage(file);
  try {
    return await makeThumbnail(decoded.source, decoded.width, decoded.height, { max: 960 });
  } finally {
    decoded.close();
  }
}

/** Validate, probe, make the poster and upload. Throws an Error with a user-facing message. */
export async function uploadWallpaper(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<MediaAttachment> {
  const issue = wallpaperFileIssue(file);
  if (issue) throw new Error(issue);

  if ((WALLPAPER_VIDEO_MIME_TYPES as readonly string[]).includes(file.type)) {
    const meta = await readVideoMeta(file);
    if (meta.durationMs > MAX_WALLPAPER_VIDEO_MS)
      throw new Error(`Video wallpapers can be up to ${MAX_WALLPAPER_VIDEO_MS / 1000} seconds.`);
    const { thumbnail } = await videoPoster(file);
    if (!thumbnail) throw new Error('Could not make a still image for this video');
    return api.upload(
      file,
      { kind: 'video', width: meta.width, height: meta.height, durationMs: meta.durationMs },
      onProgress,
      { fileName: file.name, thumbnail },
    );
  }

  const info = await probeImageFile(file);
  const size = info ?? (await readImageDimensions(file));
  const animated = !!info?.animated;
  const blob = await stripImageBlob(file);
  const thumbnail = animated ? await imagePoster(file) : null;
  if (animated && !thumbnail) throw new Error('Could not make a still image for this animation');
  return api.upload(blob, { kind: 'image', width: size.width, height: size.height }, onProgress, {
    fileName: file.name,
    thumbnail,
  });
}
