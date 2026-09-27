/**
 * Local media helpers for React Native. A picked/recorded file is a plain object
 * `{ uri, name, type, size, width?, height?, durationMs? }` (see features/conversation/lib/
 * mediaProcessing.js); its `uri` doubles as the "object URL" the web client makes for blobs.
 */
import { Platform } from 'react-native';

/** Preview URL of a local file (the web's `URL.createObjectURL`). */
export function createObjectUrl(file) {
  if (!file) return null;
  if (typeof file === 'string') return file;
  if (file.uri) return file.uri;
  if (Platform.OS === 'web' && typeof Blob !== 'undefined' && file instanceof Blob)
    return URL.createObjectURL(file);
  return null;
}

/** Release a preview URL (only `blob:` URLs on the web preview hold memory). */
export function revokeObjectUrl(url) {
  if (url && Platform.OS === 'web' && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      /* already revoked */
    }
  }
}

export function revokeAllObjectUrls() {}

/** Scale (width, height) to fit inside (maxW, maxH), never upscaling. */
export function fitWithin(width, height, maxW, maxH) {
  if (!width || !height) return { width: maxW, height: maxH };
  const scale = Math.min(1, maxW / width, maxH / height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** Upload kind for a MIME type. */
export function mediaKindForFile(file) {
  const t = file?.type ?? '';
  if (t.startsWith('image/')) return 'image';
  if (t.startsWith('video/')) return 'video';
  if (t.startsWith('audio/')) return 'audio';
  return 'file';
}

const EXT_MIME = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  heic: 'image/heic',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  '3gp': 'video/3gpp',
  m4a: 'audio/mp4',
  mp3: 'audio/mpeg',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  wav: 'audio/wav',
  pdf: 'application/pdf',
};

/** Best-effort MIME type from a file name. */
export function mimeFromName(name, fallback = 'application/octet-stream') {
  const ext = /\.([a-z0-9]+)$/i.exec(name ?? '')?.[1]?.toLowerCase();
  return (ext && EXT_MIME[ext]) || fallback;
}

/** A file name from a local uri (`file:///…/IMG_0001.jpg` → `IMG_0001.jpg`). */
export function nameFromUri(uri, fallback = 'file') {
  const last = decodeURIComponent(
    String(uri ?? '')
      .split(/[/?#]/)
      .filter(Boolean)
      .pop() ?? '',
  );
  return last || fallback;
}
