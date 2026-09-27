/**
 * Image fixtures assembled in code from their spec'd byte layouts (the builders of
 * packages/shared/src/imageInfo.test.ts, as Buffers): a real 1×1 PNG, GIF/WebP/PNG/JPEG
 * builders with the metadata blocks the server strips, and container heads (AVIF, WebM)
 * for the sniffer. Nothing here decodes: pixel data is a few arbitrary bytes.
 */

type Part = number | number[] | Uint8Array | string;

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
export const u16le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
export const u16be = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];
const u24le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
export const u32le = (n: number): number[] => [...u16le(n & 0xffff), ...u16le(n >>> 16)];
export const u32be = (n: number): number[] => [...u16be(n >>> 16), ...u16be(n & 0xffff)];

export function bytes(...parts: Part[]): Buffer {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p);
    else if (typeof p === 'string') out.push(...ascii(p));
    else for (const b of p) out.push(b);
  }
  return Buffer.from(out);
}

/** A real 1×1 RGBA PNG (IHDR, IDAT, IEND — nothing to strip). */
export const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// GIF -------------------------------------------------------------------------

/** 'GIF89a', logical screen, a 2-entry global colour table, `blocks`, trailer. */
export const gif = (w: number, h: number, ...blocks: number[][]): Buffer =>
  bytes('GIF89a', u16le(w), u16le(h), 0x80, 0, 0, [0, 0, 0, 255, 255, 255], ...blocks, 0x3b);
/** Image descriptor with a 2-entry local colour table, LZW min code size 2 and `data` in ≤ 255-byte sub-blocks. */
export function gifFrame(w: number, h: number, data: number[] = [0x44, 0x01]): number[] {
  const subBlocks: number[] = [];
  for (let at = 0; at < data.length; at += 255) {
    const chunk = data.slice(at, at + 255);
    subBlocks.push(chunk.length, ...chunk);
  }
  return [
    0x2c,
    ...u16le(0),
    ...u16le(0),
    ...u16le(w),
    ...u16le(h),
    0x80,
    ...[0, 0, 0, 255, 255, 255],
    0x02,
    ...subBlocks,
    0x00,
  ];
}
/** `gifFrame` placed at (`left`, `top`) on the logical screen. */
export function gifFrameAt(left: number, top: number, w: number, h: number): number[] {
  const frame = gifFrame(w, h);
  frame.splice(1, 4, ...u16le(left), ...u16le(top));
  return frame;
}
export const gifGce = (delay: number): number[] => [
  0x21,
  0xf9,
  0x04,
  0x00,
  ...u16le(delay),
  0x00,
  0x00,
];
export const gifLoop = (loops: number): number[] => [
  0x21,
  0xff,
  0x0b,
  ...ascii('NETSCAPE2.0'),
  0x03,
  0x01,
  ...u16le(loops),
  0x00,
];
export const gifComment = (text: string): number[] => [
  0x21,
  0xfe,
  text.length,
  ...ascii(text),
  0x00,
];

/** `frames` delayed frames of `w`×`h` on a `w`×`h` canvas, looping forever, no metadata. */
export function gifWithFrames(frames: number, w: number, h: number): Buffer {
  const blocks: number[][] = [gifLoop(0)];
  for (let i = 0; i < frames; i++) blocks.push(gifGce(10), gifFrame(w, h));
  return gif(w, h, ...blocks);
}

export const STATIC_GIF = gif(1, 1, gifFrame(1, 1));
/** 4×2, two frames, loop count 3, a comment extension to strip. */
export const ANIMATED_GIF = gif(
  4,
  2,
  gifLoop(3),
  gifComment('made by'),
  gifGce(10),
  gifFrame(4, 2),
  gifGce(10),
  gifFrame(2, 2),
);

// WebP ------------------------------------------------------------------------

/** A RIFF chunk: fourcc, little-endian size, payload, one pad byte when the size is odd. */
export const riffChunk = (id: string, payload: number[]): number[] => [
  ...ascii(id),
  ...u32le(payload.length),
  ...payload,
  ...(payload.length & 1 ? [0] : []),
];
export const webp = (...chunks: number[][]): Buffer => {
  const body = chunks.flat();
  return bytes('RIFF', u32le(4 + body.length), 'WEBP', body);
};
/** VP8L bitstream header: signature 0x2f, 14-bit width - 1, 14-bit height - 1, alpha, version. */
export const vp8l = (w: number, h: number): number[] =>
  riffChunk('VP8L', [0x2f, ...u32le((w - 1) | ((h - 1) << 14)), 0x00]);
export const vp8x = (flags: number, w: number, h: number): number[] =>
  riffChunk('VP8X', [flags, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
export const anim = (loops: number): number[] => riffChunk('ANIM', [...u32le(0), ...u16le(loops)]);
/** Animation frame at (`x`, `y`) — stored halved, so pass even offsets. */
export const anmf = (w: number, h: number, x = 0, y = 0): number[] =>
  riffChunk('ANMF', [
    ...u24le(x / 2),
    ...u24le(y / 2),
    ...u24le(w - 1),
    ...u24le(h - 1),
    ...u24le(100),
    0x00,
    ...vp8l(w, h),
  ]);
/** Odd-sized so the pad byte is exercised. */
export const webpExif = riffChunk('EXIF', [0x49, 0x49, 0x2a]);

export const STATIC_WEBP = webp(vp8l(1, 1));
/** 6×4, two frames, loop count 2, VP8X animation + EXIF flags, an EXIF chunk to strip. */
export const ANIMATED_WEBP = webp(
  vp8x(0x02 | 0x08, 6, 4),
  anim(2),
  anmf(6, 4),
  anmf(3, 2),
  webpExif,
);

// PNG -------------------------------------------------------------------------

export const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A chunk with an arbitrary CRC: neither the sniffer nor the parser checks it. */
export const pngChunk = (type: string, data: number[]): number[] => [
  ...u32be(data.length),
  ...ascii(type),
  ...data,
  0xde,
  0xad,
  0xbe,
  0xef,
];
export const png = (...chunks: number[][]): Buffer => bytes(PNG_SIGNATURE, ...chunks);
export const ihdr = (w: number, h: number): number[] =>
  pngChunk('IHDR', [...u32be(w), ...u32be(h), 8, 6, 0, 0, 0]);
export const idat = pngChunk('IDAT', [0x78, 0x9c, 0x63, 0x00]);
export const iend = pngChunk('IEND', []);
export const actl = (frames: number, plays: number): number[] =>
  pngChunk('acTL', [...u32be(frames), ...u32be(plays)]);
export const fctl = (seq: number, w: number, h: number, x = 0, y = 0): number[] =>
  pngChunk('fcTL', [
    ...u32be(seq),
    ...u32be(w),
    ...u32be(h),
    ...u32be(x),
    ...u32be(y),
    ...u16be(1),
    ...u16be(10),
    0,
    0,
  ]);
export const fdat = (seq: number): number[] =>
  pngChunk('fdAT', [...u32be(seq), 0x78, 0x9c, 0x63, 0x00]);
export const itxt = pngChunk('iTXt', [...ascii('Comment'), 0, 0, 0, 0, 0, ...ascii('hello')]);
export const text = pngChunk('tEXt', [...ascii('Author'), 0, ...ascii('me')]);

/** 3×2, two frames, an iTXt chunk to strip; sniffs as image/apng → stored as image/png. */
export const APNG = png(
  ihdr(3, 2),
  actl(2, 0),
  itxt,
  fctl(0, 3, 2),
  idat,
  fctl(1, 3, 2),
  fdat(2),
  iend,
);

// JPEG ------------------------------------------------------------------------

/** A marker segment; the length field counts itself. */
export const segment = (marker: number, payload: number[]): number[] => [
  0xff,
  marker,
  ...u16be(payload.length + 2),
  ...payload,
];
export const jpeg = (...segments: number[][]): Buffer =>
  bytes([0xff, 0xd8], ...segments, [0xff, 0xd9]);
export const app1Exif = segment(0xe1, [...ascii('Exif'), 0, 0, 0x49, 0x49, 0x2a, 0x00]);
export const app0Jfif = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
export const sof0 = (w: number, h: number): number[] =>
  segment(0xc0, [8, ...u16be(h), ...u16be(w), 1, 1, 0x11, 0]);
export const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
/** Entropy-coded data with a stuffed 0xFF 0x00 and a restart marker. */
export const scanData = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];

/** 16×8 with an EXIF APP1 segment to strip. */
export const JPEG_EXIF = jpeg(app0Jfif, app1Exif, sof0(16, 8), sos, scanData);
/** Sniffs as JPEG but has no frame header: the parser cannot read it (a tolerated poster). */
export const JPEG_HEADERLESS = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0'),
  Buffer.alloc(64),
]);

// Containers ------------------------------------------------------------------

/** An ISO-BMFF `ftyp` box with the `avif` brand: sniffs as image/avif (not parsed). */
export const AVIF = bytes(
  u32be(28),
  'ftyp',
  'avif',
  u32be(0),
  'avif',
  'mif1',
  'miaf',
  new Array<number>(64).fill(0),
);

/** An EBML head with DocType `webm`: sniffs as video/webm. */
export const WEBM = bytes(
  [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01],
  [0x42, 0xf2, 0x81, 0x04, 0x42, 0xf3, 0x81, 0x08, 0x42, 0x82, 0x84],
  'webm',
  [0x42, 0x87, 0x81, 0x02, 0x42, 0x85, 0x81, 0x02],
  new Array<number>(64).fill(0),
);
