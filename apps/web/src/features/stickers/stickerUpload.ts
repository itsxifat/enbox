/**
 * Sticker uploads for Space Settings ▸ Stickers: the emoji upload path
 * (features/spaces/settings/emojiImage.ts) at sticker size, for PNG, APNG, WebP and GIF only.
 * A still larger than STICKER_MAX_DIMENSION px is drawn into it (aspect and transparency kept)
 * as a PNG — a WebP when the PNG would not fit MAX_STICKER_BYTES — and a smaller one keeps
 * its bytes, metadata stripped. An animated one (GIF, animated WebP, APNG) keeps its bytes
 * when it fits, with a WebP poster: the server requires one (renderers show it until the
 * sticker may play). Names come from the file name.
 */
import { MAX_STICKER_BYTES, STICKER_NAME_MAX_LENGTH, formatBytes } from '@enbox/shared';
import { animatedPoster, decodeImage } from '@/features/conversation/lib/mediaProcessing';
import { probeImageFile, stripImageBlob } from '@/lib/media';

/** Longest side of an uploaded still (Discord's sticker size). */
export const STICKER_MAX_DIMENSION = 320;
/** What the server takes (APNG is a PNG on the wire). */
const STICKER_MIME_TYPES = ['image/png', 'image/webp', 'image/gif'];
export const STICKER_ACCEPT = 'image/png,image/apng,image/webp,image/gif,.png,.apng,.webp,.gif';

export interface PreparedSticker {
  file: Blob;
  fileName: string;
  /** The poster of an animated sticker. */
  thumbnail: Blob | null;
  animated: boolean;
  width: number;
  height: number;
}

/** `party_parrot-2.gif` → `party parrot 2` (a starting point for the name field). */
export function stickerNameFromFile(fileName: string): string {
  const name = fileName
    .replace(/\.[^.]*$/, '')
    .replace(/[_\-.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, STICKER_NAME_MAX_LENGTH)
    .trim();
  return name.length >= 2 ? name : '';
}

function canvasBlob(
  source: CanvasImageSource,
  width: number,
  height: number,
  type: 'image/png' | 'image/webp',
): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.reject(new Error('Could not process the image'));
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (b) => {
        canvas.width = 0;
        canvas.height = 0;
        if (b) resolve(b);
        else reject(new Error('Could not encode the image'));
      },
      type,
      0.92,
    ),
  );
}

const tooBig = () => new Error(`Stickers can be at most ${formatBytes(MAX_STICKER_BYTES)}.`);

/** The bytes to upload for a sticker file (throws a readable Error when it can't be one). */
export async function prepareStickerImage(file: File): Promise<PreparedSticker> {
  const info = await probeImageFile(file);
  const mime = info?.mime ?? (file.type === 'image/apng' ? 'image/png' : file.type);
  if (!STICKER_MIME_TYPES.includes(mime)) throw new Error('Use a PNG, APNG, WebP or GIF image.');
  if (info?.animated) {
    if (file.size > MAX_STICKER_BYTES) throw tooBig();
    const [clean, poster] = await Promise.all([
      stripImageBlob(file),
      animatedPoster(file, { max: STICKER_MAX_DIMENSION }).catch(() => null),
    ]);
    if (!poster) throw new Error("This animation can't be read. Try another file.");
    return {
      file: clean,
      fileName: file.name,
      thumbnail: poster,
      animated: true,
      width: info.width,
      height: info.height,
    };
  }
  const img = await decodeImage(file).catch(() => {
    throw new Error("This image can't be opened. Try a PNG.");
  });
  try {
    const scale = Math.min(1, STICKER_MAX_DIMENSION / Math.max(img.width, img.height));
    const width = Math.max(1, Math.round(img.width * scale));
    const height = Math.max(1, Math.round(img.height * scale));
    if (scale === 1 && file.size <= MAX_STICKER_BYTES) {
      const clean = await stripImageBlob(file);
      return { file: clean, fileName: file.name, thumbnail: null, animated: false, width, height };
    }
    let out = await canvasBlob(img.source, width, height, 'image/png');
    if (out.size > MAX_STICKER_BYTES)
      out = await canvasBlob(img.source, width, height, 'image/webp');
    if (out.size > MAX_STICKER_BYTES || !STICKER_MIME_TYPES.includes(out.type)) throw tooBig();
    const base = file.name.replace(/\.[^.]*$/, '') || 'sticker';
    const fileName = `${base}.${out.type === 'image/webp' ? 'webp' : 'png'}`;
    return { file: out, fileName, thumbnail: null, animated: false, width, height };
  } finally {
    img.close();
  }
}
