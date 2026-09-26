/**
 * Image verification for `POST /api/media` (docs "Media": images are parsed, not trusted).
 * The shared `readImageInfo` parses the header and block structure of a GIF, WebP, PNG/APNG
 * or JPEG; this module feeds it a file, decides how much of the file it has to read,
 * applies the decode caps (IMAGE_HEADER_MAX_DIMENSION, ANIMATED_MAX_FRAMES,
 * ANIMATED_DECODED_PIXEL_BUDGET) and refuses a frame outside the canvas (the budget would
 * not cover what a decoder grows it to). `stripImageFileMetadata` then rewrites the temp file
 * without EXIF/XMP/ICC/comments (shared `stripImageMetadata`) before it enters the store.
 *
 * Neither function throws on hostile content: the shared parsers are total and nothing is
 * allocated in proportion to a size the file claims (only to bytes actually read, bounded by
 * IMAGE_WALK_LIMIT_BYTES). Filesystem errors propagate like everywhere else (500).
 */
import fs, { type FileHandle } from 'node:fs/promises';
import {
  ANIMATED_DECODED_PIXEL_BUDGET,
  ANIMATED_MAX_FRAMES,
  IMAGE_HEADER_MAX_DIMENSION,
  IMAGE_PROBE_BYTES,
  readImageInfo,
  stripImageMetadata,
  type ImageInfo,
  type ImageMime,
} from '@enbox/shared';

/** Sniffed types the parser understands; other images (AVIF) are stored with the client's dimensions, unprobed and unstripped. */
export const PROBED_IMAGE_MIME_TYPES: readonly ImageMime[] = [
  'image/gif',
  'image/webp',
  'image/png',
  'image/jpeg',
];

export function isProbedImageMime(mime: string): mime is ImageMime {
  return (PROBED_IMAGE_MIME_TYPES as readonly string[]).includes(mime);
}

/**
 * Files that have to be walked whole — every GIF (animated iff a second image descriptor
 * exists anywhere), animated WebP/APNG (exact frame count) and a JPEG whose frame header
 * sits behind more than IMAGE_PROBE_BYTES of metadata — are read up to this size. Beyond it
 * an animated image is rejected; a static WebP/PNG/JPEG keeps what its head said and is
 * stored unstripped.
 */
export const IMAGE_WALK_LIMIT_BYTES = 32 * 1024 * 1024;

export interface ImageFileOptions {
  /** Override of IMAGE_WALK_LIMIT_BYTES (tests). */
  walkLimit?: number;
}

export type ImageProbeResult =
  | { ok: true; info: ImageInfo }
  | {
      ok: false;
      /**
       * `unreadable`: not a valid image of the sniffed type (no pixels, no frames, a frame
       * outside the canvas); `oversize`: needs a full walk but exceeds the walk limit;
       * `cap`: over a decode cap.
       */
      code: 'unreadable' | 'oversize' | 'cap';
      /** Human-readable, phrased to follow the multipart field name (`file: …`). */
      reason: string;
    };

const fail = (code: 'unreadable' | 'oversize' | 'cap', reason: string): ImageProbeResult => ({
  ok: false,
  code,
  reason,
});

/** Reads `length` bytes at `position` (fewer at the end of the file). */
async function readAt(fh: FileHandle, position: number, length: number): Promise<Buffer> {
  const buf = Buffer.allocUnsafe(length);
  let done = 0;
  while (done < length) {
    const { bytesRead } = await fh.read(buf, done, length - done, position + done);
    if (bytesRead === 0) break;
    done += bytesRead;
  }
  return done < length ? buf.subarray(0, done) : buf;
}

/** The decode cap `info` breaks, as a reason, or null. */
export function imageCapViolation(info: ImageInfo): string | null {
  if (info.width > IMAGE_HEADER_MAX_DIMENSION || info.height > IMAGE_HEADER_MAX_DIMENSION)
    return `Image is larger than ${IMAGE_HEADER_MAX_DIMENSION} px on a side`;
  if (info.frameCount > ANIMATED_MAX_FRAMES)
    return `Animated images may have at most ${ANIMATED_MAX_FRAMES} frames`;
  if (info.width * info.height * info.frameCount > ANIMATED_DECODED_PIXEL_BUDGET)
    return 'Image is too large to decode';
  return null;
}

/**
 * Parses an image file the sniffer typed `mime` (one of PROBED_IMAGE_MIME_TYPES): the first
 * IMAGE_PROBE_BYTES settle a static WebP/PNG and a JPEG whose frame header comes first; a
 * GIF, an animated WebP/APNG and a JPEG without a frame header in its head are walked whole
 * (within `walkLimit`) so frame counts are exact. Never throws on hostile content.
 */
export async function probeImageFile(
  filePath: string,
  mime: string,
  opts: ImageFileOptions = {},
): Promise<ImageProbeResult> {
  const walkLimit = opts.walkLimit ?? IMAGE_WALK_LIMIT_BYTES;
  if (!isProbedImageMime(mime)) return fail('unreadable', `${mime} images cannot be verified`);
  const fh = await fs.open(filePath, 'r');
  try {
    const { size } = await fh.stat();
    let bytes = await readAt(fh, 0, Math.min(size, IMAGE_PROBE_BYTES));
    let info = readImageInfo(bytes);
    if (bytes.length < size && (!info || mime === 'image/gif' || info.animated)) {
      if (size > walkLimit) {
        const mib = Math.floor(walkLimit / (1024 * 1024));
        return fail(
          'oversize',
          info
            ? `Animated images may be at most ${mib} MiB`
            : `Images above ${mib} MiB must start with their header`,
        );
      }
      bytes = Buffer.concat([bytes, await readAt(fh, bytes.length, size - bytes.length)]);
      info = readImageInfo(bytes);
    }
    if (!info || info.mime !== mime) return fail('unreadable', 'Not a readable image');
    if (info.width < 1 || info.height < 1) return fail('unreadable', 'Image has no pixels');
    if (info.frameCount < 1) return fail('unreadable', 'Image has no frames');
    if (!info.framesInCanvas) return fail('unreadable', 'A frame lies outside the image canvas');
    const cap = imageCapViolation(info);
    if (cap) return fail('cap', cap);
    return { ok: true, info };
  } finally {
    await fh.close();
  }
}

/**
 * Rewrites a GIF/WebP/PNG/JPEG file without its metadata blocks (shared
 * `stripImageMetadata`: EXIF, XMP, ICC, comments, text; pixels, frames and timing
 * untouched) and returns its size afterwards. A file beyond `walkLimit` is left as it is
 * (`stripped: false`); an unchanged file is not rewritten.
 */
export async function stripImageFileMetadata(
  filePath: string,
  opts: ImageFileOptions = {},
): Promise<{ size: number; stripped: boolean }> {
  const walkLimit = opts.walkLimit ?? IMAGE_WALK_LIMIT_BYTES;
  const { size } = await fs.stat(filePath);
  if (size > walkLimit) return { size, stripped: false };
  const bytes = await fs.readFile(filePath);
  const out = stripImageMetadata(bytes);
  if (out !== bytes) await fs.writeFile(filePath, out);
  return { size: out.length, stripped: true };
}
