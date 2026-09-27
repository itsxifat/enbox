/**
 * Client-side media processing before upload — the phone version of the web's canvas
 * pipeline (docs/ARCHITECTURE.md "Media"):
 * - photos are re-encoded (strips EXIF/GPS, applies orientation, longest side ≤
 *   IMAGE_MAX_DIMENSION, JPEG q≈0.85) and get a JPEG thumbnail ≤ MAX_THUMBNAIL_BYTES;
 * - GIFs keep their bytes (re-encoding would drop the animation) with a JPEG poster;
 * - videos get a poster thumbnail, duration and dimensions;
 * - documents and audio are uploaded unchanged.
 *
 * Files are `{ uri, name, type, size, width?, height?, durationMs? }`.
 */
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { Platform } from 'react-native';
import { IMAGE_MAX_DIMENSION, MAX_THUMBNAIL_BYTES } from '@enbox/shared';
import { mimeFromName, nameFromUri } from '@/lib/media';
import { toast } from '@/stores/ui';

const THUMB_MAX = 320;

async function fileSize(uri) {
  if (Platform.OS === 'web') return undefined;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return info.exists ? info.size : undefined;
  } catch {
    return undefined;
  }
}

async function renderJpeg(uri, maxSide, width, height, quality) {
  const ctx = ImageManipulator.manipulate(uri);
  if (width && height && Math.max(width, height) > maxSide) {
    if (width >= height) ctx.resize({ width: maxSide });
    else ctx.resize({ height: maxSide });
  } else if (!width || !height) {
    ctx.resize({ width: Math.min(maxSide, width || maxSide) });
  }
  const img = await ctx.renderAsync();
  const out = await img.saveAsync({ compress: quality, format: SaveFormat.JPEG });
  return out; // { uri, width, height }
}

/** A JPEG thumbnail ≤ MAX_THUMBNAIL_BYTES, or null. */
export async function makeThumbnail(uri, width, height) {
  for (const [side, q] of [
    [THUMB_MAX, 0.72],
    [240, 0.6],
    [160, 0.5],
  ]) {
    try {
      const t = await renderJpeg(uri, side, width, height, q);
      const size = await fileSize(t.uri);
      if (size === undefined || size <= MAX_THUMBNAIL_BYTES)
        return { uri: t.uri, name: 'thumbnail.jpg', type: 'image/jpeg', size };
    } catch {
      return null;
    }
  }
  return null;
}

export function isVisualMedia(file) {
  const t = file.type ?? '';
  return t.startsWith('image/') || t.startsWith('video/');
}

/** Normalise an expo-image-picker asset into our file shape. */
export function fromPickerAsset(a) {
  const video = a.type === 'video' || (a.mimeType ?? '').startsWith('video/');
  const name = a.fileName || nameFromUri(a.uri, video ? 'video.mp4' : 'photo.jpg');
  return {
    uri: a.uri,
    name,
    type: a.mimeType || mimeFromName(name, video ? 'video/mp4' : 'image/jpeg'),
    size: a.fileSize,
    width: a.width,
    height: a.height,
    durationMs: a.duration ? Math.round(a.duration) : undefined,
  };
}

export async function prepareImage(file) {
  const animated = file.type === 'image/gif';
  if (animated) {
    const thumbnail = await makeThumbnail(file.uri, file.width, file.height);
    return {
      kind: 'image',
      blob: file,
      fileName: file.name,
      mimeType: file.type,
      width: file.width,
      height: file.height,
      thumbnail,
      animated: true,
    };
  }
  const out = await renderJpeg(file.uri, IMAGE_MAX_DIMENSION, file.width, file.height, 0.85);
  const size = await fileSize(out.uri);
  const name = file.name.replace(/\.[a-z0-9]+$/i, '') + '.jpg';
  const thumbnail = await makeThumbnail(out.uri, out.width, out.height);
  return {
    kind: 'image',
    blob: { uri: out.uri, name, type: 'image/jpeg', size },
    fileName: name,
    mimeType: 'image/jpeg',
    width: out.width,
    height: out.height,
    thumbnail,
  };
}

export async function prepareVideo(file) {
  let thumbnail = null;
  let width = file.width;
  let height = file.height;
  if (Platform.OS !== 'web') {
    try {
      const poster = await VideoThumbnails.getThumbnailAsync(file.uri, { time: 0, quality: 0.7 });
      width = width || poster.width;
      height = height || poster.height;
      thumbnail = await makeThumbnail(poster.uri, poster.width, poster.height);
    } catch {
      /* no poster */
    }
  }
  return {
    kind: 'video',
    blob: file,
    fileName: file.name,
    mimeType: file.type || 'video/mp4',
    width,
    height,
    durationMs: file.durationMs,
    thumbnail,
  };
}

export function prepareVisualMedia(file) {
  return (file.type ?? '').startsWith('video/') ? prepareVideo(file) : prepareImage(file);
}

/**
 * Prepare items one after another, calling `onReady` for each (so bubbles appear while the
 * next file is processed); failures go to `onError` and are skipped.
 */
export async function prepareEach(items, onReady, onError) {
  for (const [i, item] of items.entries()) {
    try {
      onReady(await prepareVisualMedia(item.file), item, i);
    } catch {
      onError?.(item);
    }
  }
}

// ---------------------------------------------------------------------------
// Pickers
// ---------------------------------------------------------------------------

/** Photos & videos from the library (multi-select). */
export async function pickMedia() {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    selectionLimit: 30,
    quality: 1,
    exif: false,
  });
  if (res.canceled) return [];
  return res.assets.map(fromPickerAsset);
}

/** Take a photo or record a video with the camera app. */
export async function takeWithCamera({ video = true } = {}) {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (!perm.granted) {
    toast.error('Allow camera access to take photos');
    return [];
  }
  const res = await ImagePicker.launchCameraAsync({
    mediaTypes: video ? ['images', 'videos'] : ['images'],
    quality: 1,
    exif: false,
    videoMaxDuration: 180,
  });
  if (res.canceled) return [];
  return res.assets.map(fromPickerAsset);
}

/** Documents (any type) or audio files. */
export async function pickDocuments({ audio = false } = {}) {
  const res = await DocumentPicker.getDocumentAsync({
    type: audio ? 'audio/*' : '*/*',
    multiple: true,
    copyToCacheDirectory: true,
  });
  if (res.canceled) return [];
  return res.assets.map((a) => ({
    uri: a.uri,
    name: a.name || nameFromUri(a.uri),
    type: a.mimeType || mimeFromName(a.name),
    size: a.size,
  }));
}
