/**
 * Header-level image parser and metadata stripper shared by the web client (format
 * detection, poster choice, best-effort client-side stripping) and the server
 * (`POST /api/media`: verified dimensions, frame cap, decoded-pixel budget, EXIF/XMP
 * stripped before the file enters the store).
 *
 * Pure `Uint8Array` in and out: no Buffer, no DOM, so it runs in Node and browsers alike.
 * Both functions are total on hostile input: they never throw, every loop advances through
 * the input and stops at its end, and nothing is allocated in proportion to a length the
 * file CLAIMS (only to the bytes actually given). Given the head of a file
 * (`IMAGE_PROBE_BYTES`) they return what could be parsed from it.
 */

export type ImageMime = 'image/gif' | 'image/webp' | 'image/png' | 'image/jpeg';

export interface ImageInfo {
  mime: ImageMime;
  /** Canvas (logical screen) size in pixels as declared by the header. */
  width: number;
  height: number;
  animated: boolean;
  /**
   * Frames found: exact when the whole file was given, otherwise at least the frames seen
   * in the head. `1` for a static image; `0` for an animated head that stops before its
   * first frame.
   */
  frameCount: number;
  /** Declared loop count (`0` = forever); `null` when the file does not carry one. */
  loopCount: number | null;
  /**
   * Whether `stripImageMetadata` would remove something from these bytes (EXIF, XMP, ICC,
   * comments, text; for a JPEG also a trailer after its EOI).
   */
  hasMetadata: boolean;
  /**
   * Whether every frame rectangle seen (GIF image descriptor, WebP ANMF, APNG fcTL) lies
   * inside the canvas. A frame beyond it is malformed — decoders clip, grow the canvas or
   * refuse the file, so the decoded-pixel budget could not be trusted — and the server
   * rejects the upload. Always true for a JPEG (its one frame is the canvas).
   */
  framesInCanvas: boolean;
  /**
   * Whether `animated` and `frameCount` are final for these bytes: the walk reached the end
   * of the block structure (the GIF trailer, IEND, the declared RIFF size) or a point after
   * which nothing can change them (the first IDAT of a PNG without an earlier acTL, a WebP
   * whose VP8X flags say static, a JPEG frame header). False for the head of a larger file
   * that is, or may still turn out to be, animated: the rest must be read for exact counts —
   * an APNG's acTL may sit behind a chunk larger than the head, a GIF's second frame anywhere
   * before the trailer.
   */
  settled: boolean;
}

/**
 * Parses the header and block structure of a GIF, WebP, PNG/APNG or JPEG. `null` when the
 * bytes are not one of those or the header holding the dimensions is missing or truncated.
 */
export function readImageInfo(bytes: Uint8Array): ImageInfo | null {
  try {
    if (isGif(bytes)) return readGif(bytes);
    if (isWebp(bytes)) return readWebp(bytes);
    if (isPng(bytes)) return readPng(bytes);
    if (isJpeg(bytes)) return readJpeg(bytes);
    return null;
  } catch {
    // Every parser below is bounds-checked; this is the last line of defence for hostile input.
    return null;
  }
}

/**
 * Removes the metadata blocks (EXIF, XMP, ICC profiles, comments, text) and nothing else:
 * kept blocks are copied byte for byte, so pixels, frames and timing are untouched. A JPEG
 * also loses whatever follows its EOI (motion-photo videos, vendor trailers) and the APPn/COM
 * segments between the scans of a progressive file. Returns the SAME array when there is
 * nothing to strip or the format is unknown. Truncated or malformed tails are copied verbatim
 * from the point where the walk stopped.
 */
export function stripImageMetadata(bytes: Uint8Array): Uint8Array {
  try {
    if (isGif(bytes)) return stripGif(bytes);
    if (isWebp(bytes)) return stripWebp(bytes);
    if (isPng(bytes)) return stripPng(bytes);
    if (isJpeg(bytes)) return stripJpeg(bytes);
    return bytes;
  } catch {
    return bytes;
  }
}

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

/** Whether `n` bytes starting at `at` are present. Every read below is guarded by this. */
function has(b: Uint8Array, at: number, n: number): boolean {
  return at + n <= b.length;
}

function u16le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8);
}

function u16be(b: Uint8Array, at: number): number {
  return (b[at] << 8) | b[at + 1];
}

function u24le(b: Uint8Array, at: number): number {
  return b[at] | (b[at + 1] << 8) | (b[at + 2] << 16);
}

function u32le(b: Uint8Array, at: number): number {
  return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;
}

function u32be(b: Uint8Array, at: number): number {
  return ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
}

function writeU32le(b: Uint8Array, at: number, value: number): void {
  b[at] = value & 0xff;
  b[at + 1] = (value >>> 8) & 0xff;
  b[at + 2] = (value >>> 16) & 0xff;
  b[at + 3] = (value >>> 24) & 0xff;
}

/** Whether the ASCII `tag` sits at `at`. */
function tagAt(b: Uint8Array, at: number, tag: string): boolean {
  if (!has(b, at, tag.length)) return false;
  for (let i = 0; i < tag.length; i++) if (b[at + i] !== tag.charCodeAt(i)) return false;
  return true;
}

/** The four ASCII bytes at `at` (RIFF fourcc, PNG chunk type); the caller checks bounds. */
function fourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

/**
 * Copies the input without the given `[start, end)` ranges (flat, in file order, disjoint).
 * The output is never larger than the input, whatever the file claimed.
 */
function withoutRanges(bytes: Uint8Array, drop: number[]): Uint8Array {
  let size = bytes.length;
  for (let i = 0; i < drop.length; i += 2) size -= drop[i + 1] - drop[i];
  const out = new Uint8Array(size);
  let at = 0;
  let from = 0;
  for (let i = 0; i < drop.length; i += 2) {
    out.set(bytes.subarray(from, drop[i]), at);
    at += drop[i] - from;
    from = drop[i + 1];
  }
  out.set(bytes.subarray(from), at);
  return out;
}

// ---------------------------------------------------------------------------
// GIF
// ---------------------------------------------------------------------------

/** Header (6) + logical screen descriptor (7); the dimensions sit at 6-9. */
const GIF_HEADER_LENGTH = 13;
const GIF_EXTENSION = 0x21;
const GIF_IMAGE_DESCRIPTOR = 0x2c;
const GIF_TRAILER = 0x3b;
const GIF_PLAIN_TEXT = 0x01;
const GIF_COMMENT = 0xfe;
const GIF_APPLICATION = 0xff;
/** Application extensions carrying the loop count; every other application extension is metadata. */
const GIF_LOOP_APPLICATIONS = ['NETSCAPE2.0', 'ANIMEXTS1.0'];

function isGif(b: Uint8Array): boolean {
  return tagAt(b, 0, 'GIF87a') || tagAt(b, 0, 'GIF89a');
}

/** Byte size of a colour table announced by a packed byte (bit 7 = present, bits 0-2 = size). */
function gifColourTableSize(packed: number): number {
  return packed & 0x80 ? 3 << ((packed & 0x07) + 1) : 0;
}

/** Skips length-prefixed data sub-blocks up to and including the terminator; `-1` when the file ends first. */
function skipGifSubBlocks(b: Uint8Array, pos: number): number {
  while (pos < b.length) {
    const size = b[pos];
    if (size === 0) return pos + 1;
    pos += 1 + size;
  }
  return -1;
}

type GifBlock =
  | { kind: 'extension'; label: number; start: number; end: number }
  | { kind: 'image'; start: number; end: number };

/**
 * Walks the blocks after the logical screen descriptor and global colour table. A block
 * cut off by the end of the file is still visited (its `end` is the file end) so a head
 * counts the frame it stopped in. Returns where the walk stopped: after the trailer
 * (`complete`), at the file end, or at the first byte that is not a block introducer.
 */
function walkGif(
  b: Uint8Array,
  visit: (block: GifBlock) => void,
): { end: number; complete: boolean } {
  let pos = GIF_HEADER_LENGTH + gifColourTableSize(b[10]);
  while (pos < b.length) {
    const start = pos;
    const introducer = b[pos];
    if (introducer === GIF_TRAILER) return { end: pos + 1, complete: true };
    if (introducer === GIF_EXTENSION) {
      if (!has(b, pos, 2)) break;
      const end = skipGifSubBlocks(b, pos + 2);
      visit({ kind: 'extension', label: b[pos + 1], start, end: end < 0 ? b.length : end });
      if (end < 0) break;
      pos = end;
    } else if (introducer === GIF_IMAGE_DESCRIPTOR) {
      // Descriptor (10) + local colour table + LZW minimum code size + data sub-blocks.
      if (!has(b, pos, 10)) break;
      const end = skipGifSubBlocks(b, pos + 10 + gifColourTableSize(b[pos + 9]) + 1);
      visit({ kind: 'image', start, end: end < 0 ? b.length : end });
      if (end < 0) break;
      pos = end;
    } else {
      return { end: pos, complete: false };
    }
  }
  return { end: b.length, complete: false };
}

/** Whether the application extension at `start` is a NETSCAPE2.0/ANIMEXTS1.0 loop block. */
function isGifLoopExtension(b: Uint8Array, start: number): boolean {
  // 0x21 0xFF, an 11-byte sub-block: 8-byte application identifier + 3-byte authentication code.
  if (!has(b, start, 3) || b[start + 2] !== 11) return false;
  return GIF_LOOP_APPLICATIONS.some((id) => tagAt(b, start + 3, id));
}

/** The loop count of a loop extension: a 3-byte sub-block `01 lo hi`; `null` when malformed. */
function gifLoopCount(b: Uint8Array, start: number): number | null {
  const at = start + 14;
  if (!has(b, at, 5) || b[at] !== 3 || b[at + 1] !== 1) return null;
  return u16le(b, at + 2);
}

function readGif(b: Uint8Array): ImageInfo | null {
  if (!has(b, 0, GIF_HEADER_LENGTH)) return null;
  const width = u16le(b, 6);
  const height = u16le(b, 8);
  let frameCount = 0;
  let loopCount: number | null = null;
  let hasMetadata = false;
  let framesInCanvas = true;
  const { complete } = walkGif(b, (block) => {
    if (block.kind === 'image') {
      frameCount++;
      // Image descriptor: left (u16), top (u16), width (u16), height (u16) after the introducer.
      const at = block.start + 1;
      if (u16le(b, at) + u16le(b, at + 4) > width || u16le(b, at + 2) + u16le(b, at + 6) > height)
        framesInCanvas = false;
    } else if (block.label === GIF_COMMENT || block.label === GIF_PLAIN_TEXT) {
      hasMetadata = true;
    } else if (block.label === GIF_APPLICATION) {
      if (isGifLoopExtension(b, block.start)) loopCount = gifLoopCount(b, block.start) ?? loopCount;
      else hasMetadata = true;
    }
  });
  return {
    mime: 'image/gif',
    width,
    height,
    animated: frameCount >= 2,
    frameCount,
    loopCount,
    hasMetadata,
    framesInCanvas,
    // A second image descriptor may follow anywhere before the trailer.
    settled: complete,
  };
}

function stripGif(b: Uint8Array): Uint8Array {
  if (!has(b, 0, GIF_HEADER_LENGTH)) return b;
  const drop: number[] = [];
  walkGif(b, (block) => {
    if (block.kind !== 'extension') return;
    const metadata =
      block.label === GIF_COMMENT ||
      block.label === GIF_PLAIN_TEXT ||
      (block.label === GIF_APPLICATION && !isGifLoopExtension(b, block.start));
    if (metadata) drop.push(block.start, block.end);
  });
  return drop.length ? withoutRanges(b, drop) : b;
}

// ---------------------------------------------------------------------------
// WebP (RIFF)
// ---------------------------------------------------------------------------

/** 'RIFF' + file size + 'WEBP'; chunks follow. */
const RIFF_HEADER_LENGTH = 12;
/** VP8X flag bits (byte 20 of the file when VP8X is the first chunk). */
const VP8X_ANIMATION = 0x02;
const VP8X_XMP = 0x04;
const VP8X_EXIF = 0x08;
const VP8X_ICC = 0x20;
const VP8X_METADATA = VP8X_XMP | VP8X_EXIF | VP8X_ICC;
const WEBP_METADATA_CHUNKS = ['EXIF', 'XMP ', 'ICCP'];

function isWebp(b: Uint8Array): boolean {
  return tagAt(b, 0, 'RIFF') && tagAt(b, 8, 'WEBP');
}

/**
 * Walks the RIFF chunks (8-byte header, payload padded to an even size). A chunk cut off
 * by the end of the file is still visited with the file end as its `end`. Returns where
 * the walk stopped (the file end, or the first position without room for a chunk header).
 */
function walkRiff(b: Uint8Array, visit: (id: string, start: number, end: number) => void): number {
  let pos = RIFF_HEADER_LENGTH;
  while (has(b, pos, 8)) {
    const size = u32le(b, pos + 4);
    const end = pos + 8 + size + (size & 1);
    if (end > b.length) {
      visit(fourcc(b, pos), pos, b.length);
      return b.length;
    }
    visit(fourcc(b, pos), pos, end);
    pos = end;
  }
  return pos;
}

function readWebp(b: Uint8Array): ImageInfo | null {
  let width = 0;
  let height = 0;
  let hasDims = false;
  let extended = false;
  let flags = 0;
  let frames = 0;
  let loopCount: number | null = null;
  let hasMetadata = false;
  let framesInCanvas = true;
  walkRiff(b, (id, start) => {
    const data = start + 8;
    switch (id) {
      case 'VP8X':
        // Flags, 3 reserved bytes, canvas width - 1 (u24), canvas height - 1 (u24).
        if (!extended && has(b, data, 10)) {
          extended = true;
          flags = b[data];
          width = u24le(b, data + 4) + 1;
          height = u24le(b, data + 7) + 1;
          hasDims = true;
        }
        break;
      case 'VP8 ':
        // Key frame: 3-byte frame tag (bit 0 clear), start code 9d 01 2a, then 14-bit width/height.
        if (
          !hasDims &&
          has(b, data, 10) &&
          (b[data] & 0x01) === 0 &&
          b[data + 3] === 0x9d &&
          b[data + 4] === 0x01 &&
          b[data + 5] === 0x2a
        ) {
          width = u16le(b, data + 6) & 0x3fff;
          height = u16le(b, data + 8) & 0x3fff;
          hasDims = true;
        }
        break;
      case 'VP8L':
        // Signature 0x2f, then 14 bits width - 1 and 14 bits height - 1 (little-endian bit order).
        if (!hasDims && has(b, data, 5) && b[data] === 0x2f) {
          const bits = u32le(b, data + 1);
          width = (bits & 0x3fff) + 1;
          height = ((bits >>> 14) & 0x3fff) + 1;
          hasDims = true;
        }
        break;
      case 'ANIM':
        // Background colour (u32), loop count (u16).
        if (has(b, data, 6)) loopCount = u16le(b, data + 4);
        break;
      case 'ANMF':
        frames++;
        // Frame X / 2 (u24), Y / 2 (u24), width - 1 (u24), height - 1 (u24) against the VP8X canvas.
        if (
          extended &&
          has(b, data, 12) &&
          (u24le(b, data) * 2 + u24le(b, data + 6) + 1 > width ||
            u24le(b, data + 3) * 2 + u24le(b, data + 9) + 1 > height)
        )
          framesInCanvas = false;
        break;
      default:
        if (WEBP_METADATA_CHUNKS.includes(id)) hasMetadata = true;
    }
  });
  if (!hasDims) return null;
  const animated = extended && (flags & VP8X_ANIMATION) !== 0;
  return {
    mime: 'image/webp',
    width,
    height,
    animated,
    frameCount: animated ? frames : 1,
    loopCount,
    hasMetadata: hasMetadata || (flags & VP8X_METADATA) !== 0,
    framesInCanvas: animated ? framesInCanvas : true,
    // Decoders read up to the declared RIFF size (the u32 after 'RIFF' + 8) and ignore the
    // rest, so the frames are all in once that many bytes are present.
    settled: !animated || b.length >= u32le(b, 4) + 8,
  };
}

function stripWebp(b: Uint8Array): Uint8Array {
  const drop: number[] = [];
  let dropped = 0;
  // Output offset of the VP8X flags byte, or -1 without a VP8X chunk.
  let flagsAt = -1;
  let flags = 0;
  walkRiff(b, (id, start, end) => {
    if (WEBP_METADATA_CHUNKS.includes(id)) {
      drop.push(start, end);
      dropped += end - start;
    } else if (id === 'VP8X' && flagsAt < 0 && has(b, start + 8, 1)) {
      flagsAt = start + 8 - dropped;
      flags = b[start + 8];
    }
  });
  if (!drop.length && !(flags & VP8X_METADATA)) return b;
  const out = withoutRanges(b, drop);
  if (flagsAt >= 0) out[flagsAt] = flags & ~VP8X_METADATA;
  // The RIFF size counts everything after the 8-byte 'RIFF' + size header.
  writeU32le(out, 4, out.length - 8);
  return out;
}

// ---------------------------------------------------------------------------
// PNG / APNG
// ---------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_METADATA_CHUNKS = ['eXIf', 'iTXt', 'tEXt', 'zTXt', 'tIME'];

function isPng(b: Uint8Array): boolean {
  if (!has(b, 0, PNG_SIGNATURE.length)) return false;
  return PNG_SIGNATURE.every((v, i) => b[i] === v);
}

/**
 * Walks the chunks (length u32 BE, type, data, CRC) up to and including IEND. A chunk cut
 * off by the end of the file is still visited with the file end as its `end`. Returns
 * where the walk stopped: after IEND (`complete`), at the file end, or at a chunk whose
 * length cannot be trusted.
 */
function walkPng(
  b: Uint8Array,
  visit: (type: string, start: number, end: number) => void,
): { end: number; complete: boolean } {
  let pos = PNG_SIGNATURE.length;
  while (has(b, pos, 8)) {
    const length = u32be(b, pos);
    // Lengths above 2^31 - 1 are forbidden by the spec: stop rather than trust them.
    if (length > 0x7fffffff) return { end: pos, complete: false };
    const type = fourcc(b, pos + 4);
    const end = pos + 12 + length;
    if (end > b.length) {
      visit(type, pos, b.length);
      return { end: b.length, complete: false };
    }
    visit(type, pos, end);
    if (type === 'IEND') return { end, complete: true };
    pos = end;
  }
  return { end: pos, complete: false };
}

function readPng(b: Uint8Array): ImageInfo | null {
  // IHDR must be the first chunk; its width and height are the first 8 data bytes.
  if (!has(b, 16, 8) || fourcc(b, 12) !== 'IHDR') return null;
  const width = u32be(b, 16);
  const height = u32be(b, 20);
  let animated = false;
  let frames = 0;
  let loopCount: number | null = null;
  let hasMetadata = false;
  let framesInCanvas = true;
  let sawImageData = false;
  const { complete } = walkPng(b, (type, start) => {
    const data = start + 8;
    switch (type) {
      case 'IDAT':
        sawImageData = true;
        break;
      case 'acTL':
        // Only an acTL before the first IDAT makes an APNG: num_frames (u32), num_plays (u32).
        if (!sawImageData && !animated) {
          animated = true;
          if (has(b, data, 8)) loopCount = u32be(b, data + 4);
        }
        break;
      case 'fcTL':
        frames++;
        // Sequence number, then width, height, x_offset, y_offset (u32 each) against IHDR.
        if (
          has(b, data, 20) &&
          (u32be(b, data + 12) + u32be(b, data + 4) > width ||
            u32be(b, data + 16) + u32be(b, data + 8) > height)
        )
          framesInCanvas = false;
        break;
      default:
        if (PNG_METADATA_CHUNKS.includes(type)) hasMetadata = true;
    }
  });
  return {
    mime: 'image/png',
    width,
    height,
    animated,
    frameCount: animated ? frames : 1,
    loopCount,
    hasMetadata,
    framesInCanvas: animated ? framesInCanvas : true,
    // An acTL after the first IDAT no longer counts; before it, every fcTL up to IEND does.
    settled: animated ? complete : sawImageData,
  };
}

function stripPng(b: Uint8Array): Uint8Array {
  const drop: number[] = [];
  walkPng(b, (type, start, end) => {
    if (PNG_METADATA_CHUNKS.includes(type)) drop.push(start, end);
  });
  return drop.length ? withoutRanges(b, drop) : b;
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

const JPEG_SOS = 0xda;
const JPEG_EOI = 0xd9;
const JPEG_APP1 = 0xe1;
const JPEG_APP13 = 0xed;
const JPEG_COM = 0xfe;

function isJpeg(b: Uint8Array): boolean {
  return has(b, 0, 3) && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
}

/** SOF0-SOF15 (baseline, progressive, lossless, …) minus DHT (C4), JPG (C8) and DAC (CC). */
function isJpegFrameHeader(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** TEM, RST0-7 and SOI have no length field. */
function isJpegStandaloneMarker(marker: number): boolean {
  return marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8);
}

/** EXIF/XMP (APP1), Photoshop IPTC (APP13) and comments; JFIF/ICC/Adobe segments are kept. */
function isJpegMetadataMarker(marker: number): boolean {
  return marker === JPEG_APP1 || marker === JPEG_APP13 || marker === JPEG_COM;
}

/**
 * From `pos` (the first byte of a scan's entropy-coded data), the position of the next
 * marker: a 0xFF that is not a stuffed 0x00, a fill 0xFF or a restart marker RST0-7. The
 * file end when there is none.
 */
function skipJpegScan(b: Uint8Array, pos: number): number {
  while (has(b, pos, 2)) {
    if (b[pos] !== 0xff) pos++;
    else if (b[pos + 1] === 0xff)
      pos++; // fill byte: the next 0xFF may start the marker
    else if (b[pos + 1] === 0x00 || (b[pos + 1] >= 0xd0 && b[pos + 1] <= 0xd7)) pos += 2;
    else return pos;
  }
  return b.length;
}

/**
 * Walks the marker segments after SOI: the frame header and metadata before the first SOS,
 * then — skipping each scan's entropy-coded data — the tables, DNL and any APPn/COM segments
 * between the scans of a progressive file, up to EOI. A segment cut off by the end of the
 * file is still visited with the file end as its `end`. Returns where the walk stopped:
 * after EOI (`complete`; what follows is a trailer, not part of the image), the file end, or
 * the first byte that is not a marker.
 */
function walkJpeg(
  b: Uint8Array,
  visit: (marker: number, start: number, end: number) => void,
): { end: number; complete: boolean } {
  let pos = 2;
  while (has(b, pos, 2)) {
    if (b[pos] !== 0xff) return { end: pos, complete: false };
    const marker = b[pos + 1];
    if (marker === 0xff) {
      // Fill byte before a marker.
      pos++;
      continue;
    }
    if (marker === JPEG_EOI) return { end: pos + 2, complete: true };
    if (marker === 0x00) return { end: pos, complete: false };
    if (isJpegStandaloneMarker(marker)) {
      pos += 2;
      continue;
    }
    if (!has(b, pos, 4)) {
      visit(marker, pos, b.length);
      return { end: b.length, complete: false };
    }
    // The length includes its own two bytes.
    const length = u16be(b, pos + 2);
    if (length < 2) return { end: pos, complete: false };
    const end = pos + 2 + length;
    if (end > b.length) {
      visit(marker, pos, b.length);
      return { end: b.length, complete: false };
    }
    visit(marker, pos, end);
    pos = marker === JPEG_SOS ? skipJpegScan(b, end) : end;
  }
  return { end: b.length, complete: false };
}

function readJpeg(b: Uint8Array): ImageInfo | null {
  let width = 0;
  let height = 0;
  let hasDims = false;
  let hasMetadata = false;
  const { end, complete } = walkJpeg(b, (marker, start) => {
    const data = start + 4;
    if (isJpegFrameHeader(marker)) {
      // Sample precision (u8), lines (u16), samples per line (u16).
      if (!hasDims && has(b, data, 5)) {
        height = u16be(b, data + 1);
        width = u16be(b, data + 3);
        hasDims = true;
      }
    } else if (isJpegMetadataMarker(marker)) {
      hasMetadata = true;
    }
  });
  if (!hasDims) return null;
  return {
    mime: 'image/jpeg',
    width,
    height,
    animated: false,
    frameCount: 1,
    loopCount: null,
    hasMetadata: hasMetadata || (complete && end < b.length),
    framesInCanvas: true,
    settled: true,
  };
}

function stripJpeg(b: Uint8Array): Uint8Array {
  const drop: number[] = [];
  const { end, complete } = walkJpeg(b, (marker, start, end) => {
    if (isJpegMetadataMarker(marker)) drop.push(start, end);
  });
  // Bytes after the image's EOI — motion-photo videos, vendor trailers — are not part of it.
  if (complete && end < b.length) drop.push(end, b.length);
  return drop.length ? withoutRanges(b, drop) : b;
}
