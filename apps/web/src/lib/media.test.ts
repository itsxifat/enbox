import { describe, expect, it } from 'vitest';
import { IMAGE_PROBE_BYTES } from '@enbox/shared';
import { FULL_PROBE_MAX_BYTES, probeImageFile, stripImageBlob } from './media';

// In-code fixtures (byte layouts as in packages/shared/src/imageInfo.test.ts).
const ascii = (s: string): number[] => Array.from(s, (c) => c.charCodeAt(0));
const u16le = (n: number): number[] => [n & 0xff, (n >>> 8) & 0xff];
const u16be = (n: number): number[] => [(n >>> 8) & 0xff, n & 0xff];

const gif = (w: number, h: number, ...blocks: number[][]): Uint8Array =>
  Uint8Array.from([
    ...ascii('GIF89a'),
    ...u16le(w),
    ...u16le(h),
    0x80,
    0,
    0,
    ...[0, 0, 0, 255, 255, 255],
    ...blocks.flat(),
    0x3b,
  ]);
/** Image descriptor with a local colour table, LZW min code size 2 and `dataBytes` of image data. */
const gifFrame = (w: number, h: number, dataBytes = 3): number[] => {
  const out = [
    0x2c,
    ...u16le(0),
    ...u16le(0),
    ...u16le(w),
    ...u16le(h),
    0x80,
    0,
    0,
    0,
    255,
    255,
    255,
    0x02,
  ];
  let left = dataBytes;
  while (left > 0) {
    const n = Math.min(255, left);
    out.push(n, ...new Array<number>(n).fill(0x44));
    left -= n;
  }
  out.push(0x00);
  return out;
};
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

/** SOI, an APP1 (Exif) segment, SOF0 with the size, EOI. */
const jpeg = (w: number, h: number): Uint8Array =>
  Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe1,
    ...u16be(2 + 6),
    ...ascii('Exif\0\0'),
    0xff,
    0xc0,
    ...u16be(11),
    8,
    ...u16be(h),
    ...u16be(w),
    1,
    1,
    0x11,
    0,
    0xff,
    0xd9,
  ]);

const animatedGif = gif(4, 2, gifLoop(0), gifGce(10), gifFrame(4, 2), gifGce(10), gifFrame(2, 2));
const staticGif = gif(3, 3, gifComment('made by'), gifFrame(3, 3));

function file(bytes: Uint8Array, name: string, type: string): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe('probeImageFile', () => {
  it('detects an animated GIF from the header', async () => {
    const info = await probeImageFile(file(animatedGif, 'fun.gif', 'image/gif'));
    expect(info).toMatchObject({
      mime: 'image/gif',
      width: 4,
      height: 2,
      animated: true,
      frameCount: 2,
      loopCount: 0,
    });
  });

  it('reports a static GIF as not animated', async () => {
    const info = await probeImageFile(file(staticGif, 'still.gif', 'image/gif'));
    expect(info).toMatchObject({ mime: 'image/gif', animated: false, frameCount: 1 });
  });

  it('goes by the bytes, not the name: a renamed JPEG is not animated', async () => {
    const info = await probeImageFile(file(jpeg(640, 480), 'photo.gif', 'image/gif'));
    expect(info).toMatchObject({ mime: 'image/jpeg', width: 640, height: 480, animated: false });
    expect(info?.hasMetadata).toBe(true);
  });

  it('reads a GIF whose first frame is longer than the probe head in full', async () => {
    const big = gif(
      8,
      8,
      gifGce(5),
      gifFrame(8, 8, IMAGE_PROBE_BYTES + 512),
      gifGce(5),
      gifFrame(8, 8),
    );
    expect(big.length).toBeGreaterThan(IMAGE_PROBE_BYTES);
    expect(big.length).toBeLessThanOrEqual(FULL_PROBE_MAX_BYTES);
    const info = await probeImageFile(file(big, 'big.gif', 'image/gif'));
    expect(info).toMatchObject({ animated: true, frameCount: 2 });
    const bigStill = gif(8, 8, gifFrame(8, 8, IMAGE_PROBE_BYTES + 512));
    expect(await probeImageFile(file(bigStill, 'big.gif', 'image/gif'))).toMatchObject({
      animated: false,
      frameCount: 1,
    });
  });

  it('returns null for files the parser does not know', async () => {
    expect(
      await probeImageFile(file(Uint8Array.from(ascii('<svg/>')), 'a.svg', 'image/svg+xml')),
    ).toBe(null);
    expect(await probeImageFile(new File([], 'empty.png', { type: 'image/png' }))).toBe(null);
  });
});

describe('stripImageBlob', () => {
  it('drops a GIF comment and keeps the frames', async () => {
    const out = await stripImageBlob(file(staticGif, 'still.gif', 'image/gif'));
    expect(out.type).toBe('image/gif');
    expect(out.size).toBe(staticGif.length - (3 + 'made by'.length + 1));
    expect((await probeImageFile(out))?.hasMetadata).toBe(false);
  });

  it('returns the same blob when there is nothing to strip', async () => {
    const clean = file(gif(1, 1, gifFrame(1, 1)), 'clean.gif', 'image/gif');
    expect(await stripImageBlob(clean)).toBe(clean);
  });
});
