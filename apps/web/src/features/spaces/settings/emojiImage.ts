/**
 * Emoji uploads for Space Settings → Emoji. A still image is drawn into at most
 * EMOJI_MAX_DIMENSION px (aspect and transparency kept) as a PNG; an animated one (GIF,
 * animated WebP, APNG) keeps its bytes — metadata stripped — when it fits MAX_EMOJI_BYTES,
 * with a WebP poster (the server requires one: renderers show it until hovered). Names come
 * from the file name, sanitised to CUSTOM_EMOJI_NAME_REGEX.
 */
import { CUSTOM_EMOJI_NAME_REGEX, MAX_EMOJI_BYTES, formatBytes } from '@enbox/shared';
import { animatedPoster, decodeImage } from '@/features/conversation/lib/mediaProcessing';
import { probeImageFile, stripImageBlob } from '@/lib/media';

/** Longest side of an uploaded still (Discord's emoji size). */
export const EMOJI_MAX_DIMENSION = 128;
export const EMOJI_FILE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const EMOJI_ACCEPT = EMOJI_FILE_TYPES.join(',');

export interface PreparedEmoji {
  file: Blob;
  fileName: string;
  /** The poster of an animated emoji. */
  thumbnail: Blob | null;
  animated: boolean;
  width: number;
  height: number;
}

/** `Party Parrot!.gif` → `Party_Parrot` (2-32 of [A-Za-z0-9_]; accents folded). */
export function emojiNameFromFile(fileName: string): string {
  const base = fileName.replace(/\.[^.]*$/, '');
  let name = base
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 32)
    .replace(/_+$/, '');
  if (!name) name = 'emoji';
  return name.length < 2 ? `${name}_` : name;
}

/** `name`, or `name_2`, `name_3`… when taken (case-insensitively), within 32 characters. */
export function uniqueEmojiName(name: string, taken: Iterable<string>): string {
  const lower = new Set([...taken].map((n) => n.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  for (let i = 2; ; i++) {
    const suffix = `_${i}`;
    const next = `${name.slice(0, 32 - suffix.length)}${suffix}`;
    if (!lower.has(next.toLowerCase())) return next;
  }
}

export function isValidEmojiName(name: string): boolean {
  return CUSTOM_EMOJI_NAME_REGEX.test(name);
}

function canvasPng(source: CanvasImageSource, width: number, height: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not process the image'));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => {
      canvas.width = 0;
      canvas.height = 0;
      if (b) resolve(b);
      else reject(new Error('Could not encode the image'));
    }, 'image/png'),
  );
}

/** The bytes to upload for an emoji file (throws a readable Error when it can't be one). */
export async function prepareEmojiImage(file: File): Promise<PreparedEmoji> {
  if (!(EMOJI_FILE_TYPES as readonly string[]).includes(file.type))
    throw new Error('Use a PNG, JPEG, WebP or GIF image.');
  const info = await probeImageFile(file);
  if (info?.animated) {
    if (file.size > MAX_EMOJI_BYTES)
      throw new Error(`Animated emoji can be at most ${formatBytes(MAX_EMOJI_BYTES)}.`);
    const [clean, poster] = await Promise.all([
      stripImageBlob(file),
      animatedPoster(file, { max: EMOJI_MAX_DIMENSION }).catch(() => null),
    ]);
    if (!poster) throw new Error("This animation can't be read. Try another GIF.");
    return { file: clean, fileName: file.name, thumbnail: poster, animated: true, width: info.width, height: info.height };
  }
  const img = await decodeImage(file).catch(() => {
    throw new Error("This image can't be opened. Try a PNG or JPEG.");
  });
  try {
    const scale = Math.min(1, EMOJI_MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    const png = await canvasPng(img.source, width, height);
    if (png.size > MAX_EMOJI_BYTES) throw new Error(`Emoji can be at most ${formatBytes(MAX_EMOJI_BYTES)}.`);
    return { file: png, fileName: `${emojiNameFromFile(file.name)}.png`, thumbnail: null, animated: false, width, height };
  } finally {
    img.close();
  }
}
