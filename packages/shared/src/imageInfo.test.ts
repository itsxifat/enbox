import { describe, expect, it } from 'vitest';

import { readImageInfo, stripImageMetadata } from './imageInfo.js';

// ---------------------------------------------------------------------------
// Fixture builders: every file is assembled in code from its spec'd byte layout.
// ---------------------------------------------------------------------------

type Part = number | number[] | Uint8Array | string;

const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const u16le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
const u16be = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];
const u24le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff];
const u32le = (n: number): number[] => [...u16le(n & 0xffff), ...u16le(n >>> 16)];
const u32be = (n: number): number[] => [...u16be(n >>> 16), ...u16be(n & 0xffff)];

function bytes(...parts: Part[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'number') out.push(p);
    else if (typeof p === 'string') out.push(...ascii(p));
    else out.push(...p);
  }
  return Uint8Array.from(out);
}

const readU32le = (b: Uint8Array, at: number): number =>
  (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0;

// GIF -------------------------------------------------------------------------

/** 'GIF89a', logical screen, a 2-entry global colour table, `blocks`, trailer. */
const gif = (w: number, h: number, ...blocks: number[][]): Uint8Array =>
  bytes('GIF89a', u16le(w), u16le(h), 0x80, 0, 0, [0, 0, 0, 255, 255, 255], ...blocks, 0x3b);
/** Image descriptor with a 2-entry local colour table, LZW min code size 2 and one data sub-block. */
const gifFrame = (w: number, h: number): number[] => [
  0x2c,
  ...u16le(0),
  ...u16le(0),
  ...u16le(w),
  ...u16le(h),
  0x80,
  ...[0, 0, 0, 255, 255, 255],
  0x02,
  0x03,
  0x44,
  0x01,
  0x05,
  0x00,
];
const gifGce = (delay: number): number[] => [0x21, 0xf9, 0x04, 0x00, ...u16le(delay), 0x00, 0x00];
const gifLoop = (loops: number): number[] => [
  0x21,
  0xff,
  0x0b,
  ...ascii('NETSCAPE2.0'),
  0x03,
  0x01,
  ...u16le(loops),
  0x00,
];
const gifComment = (text: string): number[] => [0x21, 0xfe, text.length, ...ascii(text), 0x00];
const gifPlainText: number[] = [
  0x21,
  0x01,
  0x0c,
  ...new Array<number>(12).fill(0),
  0x02,
  0x48,
  0x69,
  0x00,
];
/** An XMP-style application extension: metadata, not a loop block. */
const gifXmp: number[] = [0x21, 0xff, 0x0b, ...ascii('XMP DataXMP'), 0x03, ...ascii('<x>'), 0x00];

const staticGif = gif(1, 1, gifFrame(1, 1));
const animatedGif = gif(
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
const riffChunk = (id: string, payload: number[]): number[] => [
  ...ascii(id),
  ...u32le(payload.length),
  ...payload,
  ...(payload.length & 1 ? [0] : []),
];
const webp = (...chunks: number[][]): Uint8Array => {
  const body = chunks.flat();
  return bytes('RIFF', u32le(4 + body.length), 'WEBP', body);
};
/** VP8L bitstream header: signature 0x2f, 14-bit width - 1, 14-bit height - 1, alpha, version. */
const vp8l = (w: number, h: number): number[] =>
  riffChunk('VP8L', [0x2f, ...u32le((w - 1) | ((h - 1) << 14)), 0x00]);
/** VP8 key frame header: frame tag, start code 9d 01 2a, 14-bit width/height with 2-bit scale. */
const vp8 = (w: number, h: number): number[] =>
  riffChunk('VP8 ', [0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a, ...u16le(w), ...u16le(h), 0x00, 0x00]);
const vp8x = (flags: number, w: number, h: number): number[] =>
  riffChunk('VP8X', [flags, 0, 0, 0, ...u24le(w - 1), ...u24le(h - 1)]);
const anim = (loops: number): number[] => riffChunk('ANIM', [...u32le(0), ...u16le(loops)]);
const anmf = (w: number, h: number): number[] =>
  riffChunk('ANMF', [
    ...u24le(0),
    ...u24le(0),
    ...u24le(w - 1),
    ...u24le(h - 1),
    ...u24le(100),
    0x00,
    ...vp8l(w, h),
  ]);
/** Odd-sized so the pad byte is exercised. */
const webpExif = riffChunk('EXIF', [0x49, 0x49, 0x2a]);
const webpIcc = riffChunk('ICCP', [0x00, 0x00, 0x00, 0x08]);

const staticWebp = webp(vp8l(1, 1));
const animatedWebp = webp(vp8x(0x02 | 0x08, 6, 4), anim(2), anmf(6, 4), anmf(3, 2), webpExif);

// PNG -------------------------------------------------------------------------

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
/** A chunk with an arbitrary CRC: the parser never checks it. */
const pngChunk = (type: string, data: number[]): number[] => [
  ...u32be(data.length),
  ...ascii(type),
  ...data,
  0xde,
  0xad,
  0xbe,
  0xef,
];
const png = (...chunks: number[][]): Uint8Array => bytes(PNG_SIGNATURE, ...chunks);
const ihdr = (w: number, h: number): number[] =>
  pngChunk('IHDR', [...u32be(w), ...u32be(h), 8, 6, 0, 0, 0]);
const idat = pngChunk('IDAT', [0x78, 0x9c, 0x63, 0x00]);
const iend = pngChunk('IEND', []);
const actl = (frames: number, plays: number): number[] =>
  pngChunk('acTL', [...u32be(frames), ...u32be(plays)]);
const fctl = (seq: number, w: number, h: number): number[] =>
  pngChunk('fcTL', [
    ...u32be(seq),
    ...u32be(w),
    ...u32be(h),
    ...u32be(0),
    ...u32be(0),
    ...u16be(1),
    ...u16be(10),
    0,
    0,
  ]);
const fdat = (seq: number): number[] => pngChunk('fdAT', [...u32be(seq), 0x78, 0x9c, 0x63, 0x00]);
const itxt = pngChunk('iTXt', [...ascii('Comment'), 0, 0, 0, 0, 0, ...ascii('hello')]);
const text = pngChunk('tEXt', [...ascii('Author'), 0, ...ascii('me')]);
const time = pngChunk('tIME', [...u16be(2026), 9, 26, 12, 0, 0]);

const staticPng = png(ihdr(1, 1), idat, iend);
const animatedPng = png(
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
const segment = (marker: number, payload: number[]): number[] => [
  0xff,
  marker,
  ...u16be(payload.length + 2),
  ...payload,
];
const jpeg = (...segments: number[][]): Uint8Array =>
  bytes([0xff, 0xd8], ...segments, [0xff, 0xd9]);
const app1Exif = segment(0xe1, [...ascii('Exif'), 0, 0, 0x49, 0x49, 0x2a, 0x00]);
const app0Jfif = segment(0xe0, [...ascii('JFIF'), 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]);
const app13 = segment(0xed, [...ascii('Photoshop 3.0'), 0]);
const comment = segment(0xfe, ascii('a comment'));
const dqt = segment(0xdb, [0, ...new Array<number>(64).fill(1)]);
const sof0 = (w: number, h: number): number[] =>
  segment(0xc0, [8, ...u16be(h), ...u16be(w), 1, 1, 0x11, 0]);
const sof2 = (w: number, h: number): number[] =>
  segment(0xc2, [8, ...u16be(h), ...u16be(w), 1, 1, 0x11, 0]);
const sos = segment(0xda, [1, 1, 0, 0, 63, 0]);
/** Entropy-coded data with a stuffed 0xFF 0x00 and a restart marker. */
const scanData = [0x12, 0xff, 0x00, 0x34, 0xff, 0xd0, 0x56];

const minimalJpeg = jpeg(app1Exif, sof0(16, 8));

// ---------------------------------------------------------------------------

describe('readImageInfo', () => {
  it('reads a static GIF', () => {
    expect(readImageInfo(staticGif)).toEqual({
      mime: 'image/gif',
      width: 1,
      height: 1,
      animated: false,
      frameCount: 1,
      loopCount: null,
      hasMetadata: false,
    });
  });

  it('reads an animated GIF with a NETSCAPE loop count and a comment', () => {
    expect(readImageInfo(animatedGif)).toEqual({
      mime: 'image/gif',
      width: 4,
      height: 2,
      animated: true,
      frameCount: 2,
      loopCount: 3,
      hasMetadata: true,
    });
  });

  it('treats GIF plain-text and non-loop application extensions as metadata', () => {
    expect(readImageInfo(gif(1, 1, gifPlainText, gifFrame(1, 1)))?.hasMetadata).toBe(true);
    expect(readImageInfo(gif(1, 1, gifXmp, gifFrame(1, 1)))?.hasMetadata).toBe(true);
    // ANIMEXTS1.0 is the other loop block: a loop count, not metadata.
    const animexts = [0x21, 0xff, 0x0b, ...ascii('ANIMEXTS1.0'), 0x03, 0x01, ...u16le(0), 0x00];
    expect(readImageInfo(gif(1, 1, animexts, gifFrame(1, 1)))).toMatchObject({
      loopCount: 0,
      hasMetadata: false,
    });
  });

  it('reads a static VP8L WebP', () => {
    expect(readImageInfo(staticWebp)).toEqual({
      mime: 'image/webp',
      width: 1,
      height: 1,
      animated: false,
      frameCount: 1,
      loopCount: null,
      hasMetadata: false,
    });
  });

  it('reads VP8 key frame dimensions', () => {
    expect(readImageInfo(webp(vp8(320, 240)))).toMatchObject({ width: 320, height: 240 });
    // 14-bit fields: the top two bits are the scale, not part of the size.
    expect(readImageInfo(webp(vp8(0x3fff | 0xc000, 0x3fff)))).toMatchObject({
      width: 0x3fff,
      height: 0x3fff,
    });
  });

  it('reads an animated WebP with ANIM, ANMF frames and an EXIF chunk', () => {
    expect(readImageInfo(animatedWebp)).toEqual({
      mime: 'image/webp',
      width: 6,
      height: 4,
      animated: true,
      frameCount: 2,
      loopCount: 2,
      hasMetadata: true,
    });
  });

  it('reports WebP metadata from the VP8X flags alone', () => {
    expect(readImageInfo(webp(vp8x(0x20, 2, 2), vp8l(2, 2)))).toMatchObject({
      animated: false,
      frameCount: 1,
      hasMetadata: true,
    });
    expect(readImageInfo(webp(vp8x(0x10, 2, 2), vp8l(2, 2)))?.hasMetadata).toBe(false);
  });

  it('reads a static PNG', () => {
    expect(readImageInfo(staticPng)).toEqual({
      mime: 'image/png',
      width: 1,
      height: 1,
      animated: false,
      frameCount: 1,
      loopCount: null,
      hasMetadata: false,
    });
  });

  it('reads a 2-frame APNG with an iTXt chunk', () => {
    expect(readImageInfo(animatedPng)).toEqual({
      mime: 'image/png',
      width: 3,
      height: 2,
      animated: true,
      frameCount: 2,
      loopCount: 0,
      hasMetadata: true,
    });
  });

  it('ignores an acTL after the first IDAT and counts tEXt/tIME as metadata', () => {
    expect(readImageInfo(png(ihdr(1, 1), idat, actl(2, 1), fctl(0, 1, 1), iend))).toMatchObject({
      animated: false,
      frameCount: 1,
      loopCount: null,
    });
    expect(readImageInfo(png(ihdr(1, 1), text, idat, iend))?.hasMetadata).toBe(true);
    expect(readImageInfo(png(ihdr(1, 1), idat, time, iend))?.hasMetadata).toBe(true);
  });

  it('reads a minimal JPEG', () => {
    expect(readImageInfo(minimalJpeg)).toEqual({
      mime: 'image/jpeg',
      width: 16,
      height: 8,
      animated: false,
      frameCount: 1,
      loopCount: null,
      hasMetadata: true,
    });
  });

  it('reads progressive JPEG dimensions and sees APP13/COM as metadata', () => {
    expect(readImageInfo(jpeg(app0Jfif, dqt, sof2(300, 200), sos, scanData))).toEqual({
      mime: 'image/jpeg',
      width: 300,
      height: 200,
      animated: false,
      frameCount: 1,
      loopCount: null,
      hasMetadata: false,
    });
    expect(readImageInfo(jpeg(app13, sof0(1, 1)))?.hasMetadata).toBe(true);
    expect(readImageInfo(jpeg(comment, sof0(1, 1)))?.hasMetadata).toBe(true);
  });

  it('returns null for a JPEG whose frame header is missing', () => {
    expect(readImageInfo(jpeg(app1Exif))).toBeNull();
  });

  it('returns null for empty, unknown and garbage input', () => {
    expect(readImageInfo(new Uint8Array(0))).toBeNull();
    expect(readImageInfo(bytes('%PDF-1.7'))).toBeNull();
    expect(readImageInfo(bytes('RIFF', u32le(4), 'WAVE'))).toBeNull();
    expect(readImageInfo(Uint8Array.from({ length: 64 }, (_, i) => (i * 37) & 0xff))).toBeNull();
  });
});

describe('stripImageMetadata', () => {
  it('drops GIF comments and keeps frames, timing and the loop count', () => {
    const out = stripImageMetadata(animatedGif);
    expect(out.length).toBe(animatedGif.length - gifComment('made by').length);
    expect(readImageInfo(out)).toEqual({
      mime: 'image/gif',
      width: 4,
      height: 2,
      animated: true,
      frameCount: 2,
      loopCount: 3,
      hasMetadata: false,
    });
    expect(out[out.length - 1]).toBe(0x3b);
  });

  it('drops GIF plain-text and non-loop application extensions', () => {
    const src = gif(1, 1, gifXmp, gifPlainText, gifFrame(1, 1));
    const out = stripImageMetadata(src);
    expect(out).toEqual(gif(1, 1, gifFrame(1, 1)));
    expect(readImageInfo(out)?.hasMetadata).toBe(false);
  });

  it('drops WebP EXIF/XMP/ICCP chunks, clears the VP8X flags and rewrites the RIFF size', () => {
    const out = stripImageMetadata(animatedWebp);
    expect(out.length).toBe(animatedWebp.length - webpExif.length);
    expect(readU32le(out, 4)).toBe(out.length - 8);
    expect(out[20]).toBe(0x02);
    expect(readImageInfo(out)).toEqual({
      mime: 'image/webp',
      width: 6,
      height: 4,
      animated: true,
      frameCount: 2,
      loopCount: 2,
      hasMetadata: false,
    });
    expect(out).toEqual(webp(vp8x(0x02, 6, 4), anim(2), anmf(6, 4), anmf(3, 2)));
  });

  it('strips a static WebP whose ICC profile precedes the bitstream', () => {
    const src = webp(vp8x(0x20 | 0x10, 2, 2), webpIcc, vp8l(2, 2));
    const out = stripImageMetadata(src);
    expect(out).toEqual(webp(vp8x(0x10, 2, 2), vp8l(2, 2)));
    expect(readImageInfo(out)).toMatchObject({ width: 2, height: 2, hasMetadata: false });
  });

  it('clears stale VP8X metadata flags even without a matching chunk', () => {
    const src = webp(vp8x(0x08, 1, 1), vp8l(1, 1));
    const out = stripImageMetadata(src);
    expect(out).not.toBe(src);
    expect(out.length).toBe(src.length);
    expect(readImageInfo(out)?.hasMetadata).toBe(false);
  });

  it('drops PNG text/time/EXIF chunks and keeps the APNG structure', () => {
    const out = stripImageMetadata(animatedPng);
    expect(out.length).toBe(animatedPng.length - itxt.length);
    expect(readImageInfo(out)).toEqual({
      mime: 'image/png',
      width: 3,
      height: 2,
      animated: true,
      frameCount: 2,
      loopCount: 0,
      hasMetadata: false,
    });
    const exif = pngChunk('eXIf', [0x49, 0x49, 0x2a, 0x00]);
    const ztxt = pngChunk('zTXt', [...ascii('Comment'), 0, 0, 0x78, 0x9c]);
    const src = png(ihdr(1, 1), exif, text, ztxt, time, idat, iend);
    expect(stripImageMetadata(src)).toEqual(staticPng);
  });

  it('drops JPEG APP1/APP13/COM segments and copies the scan data verbatim', () => {
    expect(stripImageMetadata(minimalJpeg)).toEqual(jpeg(sof0(16, 8)));
    const src = jpeg(app0Jfif, app1Exif, dqt, app13, sof0(16, 8), comment, sos, scanData);
    const out = stripImageMetadata(src);
    expect(out).toEqual(jpeg(app0Jfif, dqt, sof0(16, 8), sos, scanData));
    expect(readImageInfo(out)).toMatchObject({ width: 16, height: 8, hasMetadata: false });
  });

  it('returns the same array when there is nothing to strip or the format is unknown', () => {
    for (const src of [staticGif, staticWebp, staticPng, jpeg(app0Jfif, sof0(1, 1))]) {
      expect(stripImageMetadata(src)).toBe(src);
    }
    const unknown = bytes('%PDF-1.7');
    expect(stripImageMetadata(unknown)).toBe(unknown);
    expect(stripImageMetadata(new Uint8Array(0)).length).toBe(0);
  });
});

describe('hostile and truncated input', () => {
  const fixtures = {
    staticGif,
    animatedGif,
    staticWebp,
    animatedWebp,
    staticPng,
    animatedPng,
    minimalJpeg,
  };

  it('never throws on any prefix of a valid file and keeps the mime once the magic is there', () => {
    for (const [name, full] of Object.entries(fixtures)) {
      const mime = readImageInfo(full)!.mime;
      for (let n = 0; n < full.length; n++) {
        const head = full.subarray(0, n);
        const info = readImageInfo(head);
        if (info) expect(info.mime, `${name}[0..${n})`).toBe(mime);
        const stripped = stripImageMetadata(head);
        expect(stripped.length, `${name}[0..${n})`).toBeLessThanOrEqual(n);
      }
    }
  });

  it('counts the frames seen in a head and never claims more than it saw', () => {
    // Cut inside the second GIF frame: the descriptor was seen, so it counts.
    const secondFrame = animatedGif.length - 1 - gifFrame(2, 2).length;
    expect(readImageInfo(animatedGif.subarray(0, secondFrame + 12))).toMatchObject({
      animated: true,
      frameCount: 2,
    });
    expect(readImageInfo(animatedGif.subarray(0, secondFrame))).toMatchObject({
      animated: false,
      frameCount: 1,
      loopCount: 3,
    });
    // An animated WebP head that ends after VP8X + ANIM: animated, no frames yet.
    expect(readImageInfo(animatedWebp.subarray(0, 12 + 18 + 14))).toMatchObject({
      animated: true,
      frameCount: 0,
      loopCount: 2,
    });
    // An APNG head cut after the first fcTL.
    const firstFrame =
      8 + ihdr(3, 2).length + actl(2, 0).length + itxt.length + fctl(0, 3, 2).length;
    expect(readImageInfo(animatedPng.subarray(0, firstFrame))).toMatchObject({
      animated: true,
      frameCount: 1,
    });
  });

  it('does not trust claimed lengths', () => {
    // GIF sub-block running past the end.
    const gifTail = bytes('GIF89a', u16le(1), u16le(1), 0, 0, 0, [0x21, 0xfe, 0xff, 0x41]);
    expect(readImageInfo(gifTail)).toMatchObject({ width: 1, height: 1, frameCount: 0 });
    expect(stripImageMetadata(gifTail).length).toBe(13);
    // GIF trailer followed by junk: the junk stays (nothing is parsed past the trailer).
    const gifJunk = bytes(staticGif, [0x21, 0xfe, 0x01, 0x41, 0x00]);
    expect(readImageInfo(gifJunk)?.hasMetadata).toBe(false);
    expect(stripImageMetadata(gifJunk)).toBe(gifJunk);
    // A colour table larger than the file.
    expect(readImageInfo(bytes('GIF89a', u16le(1), u16le(1), 0x87, 0, 0, 0x2c))).toMatchObject({
      frameCount: 0,
    });

    // RIFF chunk claiming 4 GiB.
    const hugeChunk = bytes('RIFF', u32le(0xffffffff), 'WEBP', 'VP8L', u32le(0xffffffff), [0x2f]);
    expect(readImageInfo(hugeChunk)).toBeNull();
    expect(stripImageMetadata(hugeChunk)).toBe(hugeChunk);
    const hugeExif = webp(vp8l(1, 1), [...ascii('EXIF'), ...u32le(0xfffffff0), 1, 2, 3]);
    expect(stripImageMetadata(hugeExif)).toEqual(webp(vp8l(1, 1)));

    // PNG chunk claiming more than 2^31 - 1 bytes, then one claiming past the end.
    const hugePng = png(ihdr(2, 3), [...u32be(0xffffffff), ...ascii('tEXt')]);
    expect(readImageInfo(hugePng)).toMatchObject({ width: 2, height: 3, hasMetadata: false });
    expect(stripImageMetadata(hugePng)).toBe(hugePng);
    const longText = png(ihdr(2, 3), [...u32be(1000), ...ascii('tEXt'), 1, 2, 3]);
    expect(readImageInfo(longText)?.hasMetadata).toBe(true);
    expect(stripImageMetadata(longText)).toEqual(png(ihdr(2, 3)));

    // JPEG segment with a zero length, and one running past the end.
    expect(readImageInfo(bytes([0xff, 0xd8, 0xff, 0xe1, 0x00, 0x00]))).toBeNull();
    const cutApp1 = bytes([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 0x45]);
    expect(readImageInfo(cutApp1)).toBeNull();
    expect(stripImageMetadata(cutApp1)).toEqual(bytes([0xff, 0xd8]));
    // Fill bytes before a marker are fine; a stray byte stops the walk.
    expect(
      readImageInfo(bytes([0xff, 0xd8, 0xff, 0xff, 0xff], sof0(5, 6), [0xff, 0xd9])),
    ).toMatchObject({
      width: 5,
      height: 6,
    });
    expect(readImageInfo(bytes([0xff, 0xd8, 0xff, 0xd8, 0x00], sof0(5, 6)))).toBeNull();
  });

  it('accepts Uint8Array views into a larger buffer', () => {
    const padded = bytes([0, 0, 0], minimalJpeg, [0, 0, 0]);
    const view = padded.subarray(3, 3 + minimalJpeg.length);
    expect(readImageInfo(view)).toMatchObject({ width: 16, height: 8 });
    expect(stripImageMetadata(view)).toEqual(jpeg(sof0(16, 8)));
  });
});
