/**
 * Image verification for `POST /api/media` (docs "Media": images are parsed, not trusted).
 * The shared `readImageInfo` parses the header and block structure of a GIF, WebP, PNG/APNG
 * or JPEG; this module feeds it a file, decides how much of the file it has to read
 * (`ImageInfo.settled`), applies the decode caps (IMAGE_HEADER_MAX_DIMENSION,
 * ANIMATED_MAX_FRAMES, ANIMATED_DECODED_PIXEL_BUDGET) and refuses a frame outside the canvas
 * (the budget would not cover what a decoder grows it to). `stripImageFileMetadata` then
 * rewrites the temp file without EXIF/XMP/ICC/comments/trailers (shared `stripImageMetadata`)
 * before it enters the store.
 *
 * Neither function throws on hostile content: the shared parsers are total and nothing is
 * allocated in proportion to a size the file claims (only to bytes actually read, bounded by
 * MAX_IMAGE_BYTES — a larger image is refused before any of it is read). Filesystem errors
 * propagate like everywhere else (500).
 */
import fs, { type FileHandle } from 'node:fs/promises';
import {
  ANIMATED_DECODED_PIXEL_BUDGET,
  ANIMATED_MAX_FRAMES,
  IMAGE_HEADER_MAX_DIMENSION,
  IMAGE_PROBE_BYTES,
  MAX_IMAGE_BYTES,
  readImageInfo,
  stripImageMetadata,
  type ImageInfo,
  type ImageMime,
} from '@enbox/shared';

/** The types the parser understands — exactly MEDIA_MIME_ALLOWLIST.image, so every image upload is probed and stripped. */
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
 * Largest image accepted (MAX_IMAGE_BYTES). A file whose head does not settle it — every
 * GIF (animated iff a second image descriptor exists anywhere before the trailer), an
 * animated WebP/APNG (exact frame count), a PNG whose first IDAT or a JPEG whose frame header
 * sits behind more than IMAGE_PROBE_BYTES of other chunks — is read whole, and every image
 * is rewritten whole for stripping, so this bounds what is read into memory. Beyond it an
 * image is refused unread (`oversize`).
 */
export const IMAGE_WALK_LIMIT_BYTES = MAX_IMAGE_BYTES;

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
       * outside the canvas); `oversize`: larger than the walk limit (MAX_IMAGE_BYTES);
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
 * Parses an image file the sniffer typed `mime` (one of PROBED_IMAGE_MIME_TYPES). A file
 * above `walkLimit` is refused unread. The first IMAGE_PROBE_BYTES settle a static WebP, a
 * PNG whose first IDAT is in them and a JPEG whose frame header is (`ImageInfo.settled`);
 * anything else — a GIF, an animated WebP/APNG, a PNG or JPEG whose head ends in a large
 * metadata chunk — is walked whole so `animated` and the frame count are exact. Never throws
 * on hostile content.
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
    if (size > walkLimit)
      return fail('oversize', `Images may be at most ${Math.floor(walkLimit / (1024 * 1024))} MiB`);
    let bytes = await readAt(fh, 0, Math.min(size, IMAGE_PROBE_BYTES));
    let info = readImageInfo(bytes);
    if (bytes.length < size && !info?.settled) {
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
 * `stripImageMetadata`: EXIF, XMP, ICC, comments, text, a JPEG's trailer; pixels, frames
 * and timing untouched) and returns its size afterwards. An unchanged file is not rewritten.
 * A file beyond `walkLimit` is left as it is (`stripped: false`) — `probeImageFile` refuses
 * such a file first, so nothing unstripped reaches the store through the upload route.
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
