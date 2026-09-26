import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  ANIMATED_MAX_FRAMES,
  IMAGE_HEADER_MAX_DIMENSION,
  IMAGE_PROBE_BYTES,
  MAX_ANIMATED_AVATAR_BYTES,
  MAX_AVATAR_BYTES,
  MAX_BANNER_BYTES,
  MAX_FILE_NAME_LENGTH,
  MAX_IMAGE_BYTES,
  MAX_THUMBNAIL_BYTES,
  readImageInfo,
  type MediaAttachment,
} from '@enbox/shared';
import { db } from '../src/db/index.js';
import { media, messages, users } from '../src/db/schema.js';
import { runMediaGc } from '../src/jobs/mediaGc.js';
import {
  IMAGE_WALK_LIMIT_BYTES,
  probeImageFile,
  stripImageFileMetadata,
} from '../src/services/imageProbe.js';
import { requireAvatarMedia, requireBannerMedia } from '../src/services/media.js';
import { sanitizeFileName } from '../src/services/uploads.js';
import { startTestServer, type TestServer, type TestUser } from './helpers.js';
import { createGroup, send } from './services/fixtures.js';
import {
  ANIMATED_GIF,
  ANIMATED_WEBP,
  APNG,
  AVIF,
  JPEG_EXIF,
  JPEG_HEADERLESS,
  PNG,
  PNG_SIGNATURE,
  STATIC_GIF,
  WEBM,
  actl,
  anim,
  anmf,
  app0Jfif,
  fctl,
  fdat,
  gif,
  gifFrame,
  gifFrameAt,
  gifWithFrames,
  idat,
  iend,
  ihdr,
  jpeg,
  png,
  pngChunk,
  scanData,
  segment,
  sof0,
  sos,
  text,
  u32be,
  vp8x,
  webp,
} from './support/images.js';

const JPEG = JPEG_HEADERLESS;
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const SVG_XML = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
const HTML = Buffer.from(
  '<!doctype html><html><body><script>alert(document.cookie)</script></body></html>',
);

/** Frame data long enough that the block after it starts beyond the probe head. */
const beyondHead = new Array<number>(IMAGE_PROBE_BYTES + 4096).fill(0x11);

describe('POST /api/media', () => {
  let t: TestServer;
  let alice: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser();
  });
  afterAll(() => t.close());

  const upload = (
    fields: Record<string, string>,
    file?: { buf: Buffer; name: string; type?: string },
    thumb?: { buf: Buffer; name: string; type?: string },
  ) => {
    let req = t.api(alice).post('/api/media');
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    if (file)
      req = req.attach('file', file.buf, {
        filename: file.name,
        contentType: file.type ?? 'application/octet-stream',
      });
    if (thumb)
      req = req.attach('thumbnail', thumb.buf, {
        filename: thumb.name,
        contentType: thumb.type ?? 'application/octet-stream',
      });
    return req;
  };
  const stored = (url: string | null) =>
    fs.readFileSync(path.join(t.uploadDir, url!.replace('/uploads/', '')));
  const rowOf = async (id: string) => (await db.select().from(media).where(eq(media.id, id)))[0]!;

  it('stores a sniffed image under yyyy/mm/<uuid>.<ext> and returns a MediaAttachment', async () => {
    const res = await upload(
      { kind: 'image', width: '1', height: '1' },
      { buf: PNG, name: 'photo.jpg', type: 'image/jpeg' },
    ).expect(201);
    const m = res.body as MediaAttachment;
    expect(m).toMatchObject({
      kind: 'image',
      mimeType: 'image/png',
      fileName: 'photo.jpg',
      size: PNG.length,
      width: 1,
      height: 1,
      animated: false,
      frameCount: null,
      durationMs: null,
      waveform: null,
      thumbnailUrl: null,
    });
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    expect(m.url).toMatch(new RegExp(`^/uploads/${yyyy}/${mm}/[0-9a-f-]{36}\\.png$`)); // extension from the bytes, not the name
    expect(stored(m.url)).toEqual(PNG); // nothing to strip: byte-identical
    const served = await t.api().get(m.url).expect(200);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    const row = await rowOf(m.id);
    expect(row.uploaderId).toBe(alice.id);
    expect(row.metadataStripped).toBe(true);
    // temp files are cleaned up
    expect(fs.readdirSync(path.join(t.uploadDir, '.tmp'))).toEqual([]);
  });

  it('parses an animated GIF: verified dimensions override the claim, frames counted, comment stripped', async () => {
    const res = await upload(
      { kind: 'image', width: '100', height: '50' },
      { buf: ANIMATED_GIF, name: 'dance.gif', type: 'image/gif' },
    ).expect(201);
    const m = res.body as MediaAttachment;
    expect(m).toMatchObject({
      mimeType: 'image/gif',
      width: 4,
      height: 2,
      animated: true,
      frameCount: 2,
    });
    expect(m.url).toMatch(/\.gif$/);
    const file = stored(m.url);
    expect(m.size).toBe(file.length);
    expect(file.length).toBeLessThan(ANIMATED_GIF.length);
    expect(file.includes(Buffer.from([0x21, 0xfe]))).toBe(false); // no comment extension
    expect(readImageInfo(file)).toMatchObject({
      animated: true,
      frameCount: 2,
      loopCount: 3, // the NETSCAPE loop block survives
      hasMetadata: false,
    });
    expect(await rowOf(m.id)).toMatchObject({
      animated: true,
      frameCount: 2,
      metadataStripped: true,
    });
  });

  it('keeps APNG as image/png with animated=true and drops its text chunks', async () => {
    const res = await upload(
      { kind: 'image' },
      { buf: APNG, name: 'blink.png', type: 'image/png' },
    ).expect(201);
    const m = res.body as MediaAttachment;
    expect(m).toMatchObject({
      mimeType: 'image/png',
      width: 3,
      height: 2,
      animated: true,
      frameCount: 2,
    });
    expect(m.url).toMatch(/\.png$/);
    const file = stored(m.url);
    expect(file.includes(Buffer.from('iTXt'))).toBe(false);
    expect(file.includes(Buffer.from('acTL'))).toBe(true);
    expect(readImageInfo(file)).toMatchObject({
      animated: true,
      frameCount: 2,
      hasMetadata: false,
    });
  });

  it('flags an animated WebP and removes its EXIF chunk (VP8X flag cleared, RIFF size fixed)', async () => {
    const res = await upload(
      { kind: 'image' },
      { buf: ANIMATED_WEBP, name: 'wave.webp', type: 'image/webp' },
    ).expect(201);
    const m = res.body as MediaAttachment;
    expect(m).toMatchObject({
      mimeType: 'image/webp',
      width: 6,
      height: 4,
      animated: true,
      frameCount: 2,
    });
    const file = stored(m.url);
    expect(file.includes(Buffer.from('EXIF'))).toBe(false);
    expect(file[20]! & 0x08).toBe(0);
    expect(file.readUInt32LE(4)).toBe(file.length - 8);
    expect(readImageInfo(file)).toMatchObject({
      animated: true,
      frameCount: 2,
      hasMetadata: false,
    });
  });

  it('strips EXIF from a JPEG and from its thumbnail', async () => {
    const res = await upload(
      { kind: 'image', width: '4000', height: '3000' },
      { buf: JPEG_EXIF, name: 'photo.jpg', type: 'image/jpeg' },
      { buf: JPEG_EXIF, name: 'thumb.jpg', type: 'image/jpeg' },
    ).expect(201);
    const m = res.body as MediaAttachment;
    expect(m).toMatchObject({ mimeType: 'image/jpeg', width: 16, height: 8, animated: false });
    for (const file of [stored(m.url), stored(m.thumbnailUrl)]) {
      expect(file.includes(Buffer.from([0xff, 0xe1]))).toBe(false); // no APP1
      expect(file.includes(Buffer.from('JFIF'))).toBe(true); // APP0 kept
      expect(readImageInfo(file)).toMatchObject({ width: 16, height: 8, hasMetadata: false });
    }
    expect(m.size).toBe(stored(m.url).length);
    expect(m.size).toBeLessThan(JPEG_EXIF.length);
  });

  it('walks a GIF past the probe head for an exact frame count', async () => {
    const big = gif(1, 1, gifFrame(1, 1, beyondHead), gifFrame(1, 1));
    expect(readImageInfo(big.subarray(0, IMAGE_PROBE_BYTES))?.frameCount).toBe(1); // the head alone would say static
    const res = await upload(
      { kind: 'image' },
      { buf: big, name: 'big.gif', type: 'image/gif' },
    ).expect(201);
    expect(res.body).toMatchObject({ animated: true, frameCount: 2, size: big.length });
  });

  it('rejects images over the decode caps with 400', async () => {
    const wide = await upload(
      { kind: 'image' },
      { buf: gif(IMAGE_HEADER_MAX_DIMENSION + 1, 1, gifFrame(1, 1)), name: 'wide.gif' },
    ).expect(400);
    expect(wide.body.error).toMatchObject({ code: 'validation_error' });
    expect(wide.body.error.message).toMatch(/^file: Image is larger than 8192 px/);
    await upload(
      { kind: 'image' },
      { buf: png(ihdr(1, IMAGE_HEADER_MAX_DIMENSION + 1), idat, iend), name: 'tall.png' },
    ).expect(400);
    const frames = await upload(
      { kind: 'image' },
      { buf: gifWithFrames(ANIMATED_MAX_FRAMES + 1, 1, 1), name: 'long.gif' },
    ).expect(400);
    expect(frames.body.error.message).toMatch(/^file: Animated images may have at most 400 frames/);
    const atCap = await upload(
      { kind: 'image' },
      { buf: gifWithFrames(ANIMATED_MAX_FRAMES, 1, 1), name: 'ok.gif' },
    ).expect(201);
    expect(atCap.body.frameCount).toBe(ANIMATED_MAX_FRAMES);
    // 8192 × 8192 × 3 frames = 201 M decoded pixels: over the budget; two frames fit.
    const side = IMAGE_HEADER_MAX_DIMENSION;
    const budget = await upload(
      { kind: 'image' },
      { buf: gif(side, side, gifFrame(1, 1), gifFrame(1, 1), gifFrame(1, 1)), name: 'huge.gif' },
    ).expect(400);
    expect(budget.body.error.message).toMatch(/^file: Image is too large to decode/);
    await upload(
      { kind: 'image' },
      { buf: gif(side, side, gifFrame(1, 1), gifFrame(1, 1)), name: 'large.gif' },
    ).expect(201);
    expect(fs.readdirSync(path.join(t.uploadDir, '.tmp'))).toEqual([]);
  });

  it('rejects unreadable images with 400, never 500', async () => {
    const cases: [string, Buffer][] = [
      ['truncated.gif', Buffer.from('GIF89a\x01\x00')],
      ['noframes.gif', gif(1, 1)],
      ['empty.png', png(ihdr(0, 0), idat, iend)],
      ['headerless.jpg', JPEG_HEADERLESS],
    ];
    for (const [name, buf] of cases) {
      const res = await upload({ kind: 'image' }, { buf, name }).expect(400);
      expect(res.body.error.code).toBe('validation_error');
      expect(res.body.error.message).toMatch(/^file: /);
    }
    expect(fs.readdirSync(path.join(t.uploadDir, '.tmp'))).toEqual([]);
  });

  it('rejects a frame outside the canvas with 400', async () => {
    const cases: [string, Buffer][] = [
      ['offscreen.gif', gif(2, 2, gifFrame(1, 1), gifFrameAt(1, 0, 2, 2))],
      ['offscreen.webp', webp(vp8x(0x02, 4, 4), anim(0), anmf(2, 2, 4, 0))],
      ['offscreen.png', png(ihdr(4, 4), actl(1, 0), fctl(0, 4, 2, 0, 3), idat, iend)],
    ];
    for (const [name, buf] of cases) {
      const res = await upload({ kind: 'image' }, { buf, name }).expect(400);
      expect(res.body.error.message, name).toBe('file: A frame lies outside the image canvas');
    }
    // The same frames placed inside the canvas pass.
    await upload(
      { kind: 'image' },
      { buf: gif(3, 2, gifFrame(1, 1), gifFrameAt(1, 0, 2, 2)), name: 'onscreen.gif' },
    ).expect(201);
    expect(fs.readdirSync(path.join(t.uploadDir, '.tmp'))).toEqual([]);
  });

  it('walks a PNG whose head ends before its first IDAT: an APNG behind a large chunk is animated', async () => {
    const hidden = png(
      ihdr(2, 2),
      pngChunk('iCCP', beyondHead),
      actl(2, 0),
      fctl(0, 2, 2),
      idat,
      fctl(1, 2, 2),
      fdat(2),
      iend,
    );
    // The head alone would pass it off as a static PNG (no poster, no frame caps).
    expect(readImageInfo(hidden.subarray(0, IMAGE_PROBE_BYTES))).toMatchObject({
      animated: false,
      settled: false,
    });
    const res = await upload(
      { kind: 'image' },
      { buf: hidden, name: 'hidden.png', type: 'image/png' },
    ).expect(201);
    expect(res.body).toMatchObject({ mimeType: 'image/png', animated: true, frameCount: 2 });
    await expect(requireAvatarMedia(db, res.body.id, alice.id)).rejects.toMatchObject({
      status: 400,
      message: 'Animated images need a static poster',
    });
    const frames = await upload(
      { kind: 'image' },
      {
        buf: png(
          ihdr(1, 1),
          pngChunk('iCCP', beyondHead),
          actl(ANIMATED_MAX_FRAMES + 1, 0),
          ...Array.from({ length: ANIMATED_MAX_FRAMES + 1 }, (_, i) => fctl(i, 1, 1)),
          idat,
          iend,
        ),
        name: 'long.png',
      },
    ).expect(400);
    expect(frames.body.error.message).toMatch(/^file: Animated images may have at most/);
  });

  it('refuses an image above MAX_IMAGE_BYTES unread; larger photos go as documents', async () => {
    const huge = Buffer.concat([
      png(ihdr(1, 1)),
      Buffer.from(u32be(MAX_IMAGE_BYTES)),
      Buffer.from('IDAT'),
      Buffer.alloc(MAX_IMAGE_BYTES + 4),
      png(iend).subarray(PNG_SIGNATURE.length),
    ]);
    const res = await upload({ kind: 'image' }, { buf: huge, name: 'huge.png' }).expect(400);
    expect(res.body.error.message).toBe('file: Images may be at most 32 MiB');
    expect(fs.readdirSync(path.join(t.uploadDir, '.tmp'))).toEqual([]);
  });

  it('rejects AVIF as an image (neither parsed nor stripped); files of any kind stay unprobed', async () => {
    const res = await upload(
      { kind: 'image', width: '640', height: '480' },
      { buf: AVIF, name: 'a.avif', type: 'image/avif' },
    ).expect(400);
    expect(res.body.error.message).toBe('file: image/avif is not allowed for image uploads');
    const asFile = await upload({ kind: 'file' }, { buf: AVIF, name: 'a.avif' }).expect(201);
    expect(asFile.body).toMatchObject({ kind: 'file', mimeType: 'image/avif', animated: false });
    expect(stored(asFile.body.url)).toEqual(AVIF);
    expect(await rowOf(asFile.body.id)).toMatchObject({ metadataStripped: false });
    const doc = await upload(
      { kind: 'file', width: '7', height: '9' },
      { buf: ANIMATED_GIF, name: 'dance.gif' },
    ).expect(201);
    expect(doc.body).toMatchObject({ kind: 'file', width: 7, height: 9, animated: false });
    expect(stored(doc.body.url)).toEqual(ANIMATED_GIF);
  });

  it('requires a static poster within the caps; unparsable poster bytes are tolerated', async () => {
    const animated = await upload(
      { kind: 'image' },
      { buf: PNG, name: 'a.png' },
      { buf: ANIMATED_WEBP, name: 't.webp' },
    ).expect(400);
    expect(animated.body.error.message).toBe('thumbnail: must be a static image');
    const huge = await upload(
      { kind: 'video' },
      { buf: WEBM, name: 'v.webm' },
      {
        buf: jpeg(app0Jfif, sof0(IMAGE_HEADER_MAX_DIMENSION + 1, 1), sos, scanData),
        name: 't.jpg',
      },
    ).expect(400);
    expect(huge.body.error.message).toMatch(/^thumbnail: Image is larger than/);
    const ok = await upload(
      { kind: 'image' },
      { buf: PNG, name: 'a.png' },
      { buf: JPEG_HEADERLESS, name: 't.jpg' },
    ).expect(201);
    expect(stored(ok.body.thumbnailUrl)).toEqual(JPEG_HEADERLESS);
  });

  it('rejects SVG as an image (with or without an XML declaration)', async () => {
    const r1 = await upload(
      { kind: 'image' },
      { buf: SVG, name: 'logo.svg', type: 'image/svg+xml' },
    ).expect(400);
    expect(r1.body.error.code).toBe('validation_error');
    await upload(
      { kind: 'image' },
      { buf: SVG_XML, name: 'logo.svg', type: 'image/svg+xml' },
    ).expect(400);
  });

  it('rejects HTML disguised as a PNG', async () => {
    const res = await upload(
      { kind: 'image' },
      { buf: HTML, name: 'cute-cat.png', type: 'image/png' },
    ).expect(400);
    expect(res.body.error.message).toMatch(/not allowed for image/);
    expect(fs.readdirSync(path.join(t.uploadDir, '.tmp'))).toEqual([]);
  });

  it('accepts anything as a file, stored as .bin and served as an attachment', async () => {
    const res = await upload(
      { kind: 'file' },
      { buf: HTML, name: 'page.html', type: 'text/html' },
    ).expect(201);
    const m = res.body as MediaAttachment;
    expect(m).toMatchObject({
      kind: 'file',
      mimeType: 'application/octet-stream',
      fileName: 'page.html',
    });
    expect(m.url).toMatch(/\.bin$/);
    const served = await t.api().get(m.url).expect(200);
    expect(served.headers['content-disposition']).toMatch(/^attachment/);
    expect(served.headers['content-security-policy']).toContain('sandbox');
  });

  it('checks the kind allowlist (WebM voice ok, PNG voice rejected) and keeps waveforms for voice only', async () => {
    const res = await upload(
      { kind: 'voice', durationMs: '1500', waveform: JSON.stringify([0.1, 2, -1]) },
      { buf: WEBM, name: 'voice.webm' },
    ).expect(201);
    expect(res.body).toMatchObject({
      kind: 'voice',
      mimeType: 'video/webm',
      durationMs: 1500,
      waveform: [0.1, 1, 0],
    });
    await upload({ kind: 'voice' }, { buf: PNG, name: 'x.webm' }).expect(400);
    await upload({ kind: 'video' }, { buf: PNG, name: 'x.mp4' }).expect(400);
    const img = await upload(
      { kind: 'image', waveform: '[0.5]' },
      { buf: PNG, name: 'x.png' },
    ).expect(201);
    expect(img.body.waveform).toBeNull();
  });

  it('validates the thumbnail: JPEG/WebP only, ≤ MAX_THUMBNAIL_BYTES', async () => {
    const ok = await upload(
      { kind: 'image' },
      { buf: PNG, name: 'a.png' },
      { buf: JPEG, name: 't.jpg' },
    ).expect(201);
    expect(ok.body.thumbnailUrl).toMatch(/^\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    expect(
      fs.existsSync(path.join(t.uploadDir, ok.body.thumbnailUrl.replace('/uploads/', ''))),
    ).toBe(true);
    await upload(
      { kind: 'image' },
      { buf: PNG, name: 'a.png' },
      { buf: PNG, name: 't.png' },
    ).expect(400);
    const big = Buffer.concat([JPEG, Buffer.alloc(MAX_THUMBNAIL_BYTES)]);
    const tooBig = await upload(
      { kind: 'image' },
      { buf: PNG, name: 'a.png' },
      { buf: big, name: 't.jpg' },
    ).expect(413);
    expect(tooBig.body.error.code).toBe('payload_too_large');
  });

  it('rejects malformed multipart bodies with 400', async () => {
    const res = await t
      .api(alice)
      .post('/api/media')
      .set('Content-Type', 'multipart/form-data; boundary=XYZ')
      .send(
        '--XYZ\r\nContent-Disposition: form-data; name="file"; filename="a\u0000.png"\r\n\r\nabc\r\n--XYZ--\r\n',
      )
      .expect(400);
    expect(res.body.error.code).toBe('validation_error');
  });

  it('validates fields: missing file / kind, bad meta, unauthenticated', async () => {
    await upload({ kind: 'image' }).expect(400);
    await upload({}, { buf: PNG, name: 'a.png' }).expect(400);
    await upload({ kind: 'sticker' }, { buf: PNG, name: 'a.png' }).expect(400);
    await upload({ kind: 'image', width: '-5' }, { buf: PNG, name: 'a.png' }).expect(400);
    await t.api(alice).post('/api/media').send({ kind: 'image' }).expect(400);
    await t.api().post('/api/media').attach('file', PNG, 'a.png').expect(401);
  });

  it('sanitises file names (basename, control/bidi chars, NFC, length)', async () => {
    const evil = `../../etc/${'\u202E'}gpj.exe`;
    const res = await upload({ kind: 'file' }, { buf: PNG, name: evil }).expect(201);
    expect(res.body.fileName).toBe('gpj.exe');
    expect(sanitizeFileName('a\u0000b\u0007c\u2028.txt')).toBe('abc.txt');
    expect(sanitizeFileName('C:\\Users\\me\\report.pdf')).toBe('report.pdf');
    expect(sanitizeFileName('cafe\u0301.txt')).toBe('caf\u00e9.txt');
    expect(sanitizeFileName('..')).toBeNull();
    expect(sanitizeFileName('\u2066\u2069')).toBeNull();
    expect(sanitizeFileName('👩‍💻 notes.md')).toBe('👩‍💻 notes.md'); // ZWJ sequences survive
    const long = sanitizeFileName(`${'a'.repeat(300)}.docx`)!;
    expect(Array.from(long)).toHaveLength(MAX_FILE_NAME_LENGTH);
    expect(long.endsWith('.docx')).toBe(true);
  });
});

describe('probeImageFile / stripImageFileMetadata', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'enbox-image-probe-'));
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  let n = 0;
  const write = (buf: Buffer) => {
    const p = path.join(dir, `f${++n}`);
    fs.writeFileSync(p, buf);
    return p;
  };
  /** Just over the probe head, so a full walk is needed and a small walk limit bites. */
  const walkLimit = IMAGE_PROBE_BYTES + 1024;

  it('walks unsettled heads whole and refuses any image beyond the walk limit', async () => {
    const bigGif = write(gif(1, 1, gifFrame(1, 1, beyondHead), gifFrame(1, 1)));
    expect(await probeImageFile(bigGif, 'image/gif')).toMatchObject({
      ok: true,
      info: { animated: true, frameCount: 2 },
    });
    expect(await probeImageFile(bigGif, 'image/gif', { walkLimit })).toEqual({
      ok: false,
      code: 'oversize',
      reason: 'Images may be at most 0 MiB',
    });
    const bigApng = write(
      png(
        ihdr(1, 1),
        pngChunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0]),
        pngChunk('IDAT', beyondHead),
        iend,
      ),
    );
    expect(await probeImageFile(bigApng, 'image/png', { walkLimit })).toMatchObject({
      ok: false,
      code: 'oversize',
    });
    // A static PNG whose first IDAT lies beyond the head is walked whole too (an acTL could
    // still follow the chunk the head stopped in).
    const lateIdat = write(png(ihdr(1, 1), pngChunk('iCCP', beyondHead), idat, iend));
    expect(await probeImageFile(lateIdat, 'image/png')).toMatchObject({
      ok: true,
      info: { animated: false, frameCount: 1, settled: true },
    });
    expect(await probeImageFile(lateIdat, 'image/png', { walkLimit })).toMatchObject({
      ok: false,
      code: 'oversize',
    });
    expect(IMAGE_WALK_LIMIT_BYTES).toBe(MAX_IMAGE_BYTES);
  });

  it('settles a static WebP/PNG/JPEG from the head alone, but never accepts a file over the limit unstripped', async () => {
    const bigPng = write(png(ihdr(2, 2), text, pngChunk('IDAT', beyondHead), iend));
    expect(readImageInfo(fs.readFileSync(bigPng).subarray(0, IMAGE_PROBE_BYTES))?.settled).toBe(
      true,
    );
    expect(await probeImageFile(bigPng, 'image/png')).toMatchObject({
      ok: true,
      info: { width: 2, height: 2, animated: false, frameCount: 1 },
    });
    // Over the limit the probe refuses it before the strip could skip it: what enters the
    // store through the route is always stripped.
    expect(await probeImageFile(bigPng, 'image/png', { walkLimit })).toEqual({
      ok: false,
      code: 'oversize',
      reason: 'Images may be at most 0 MiB',
    });
    const before = fs.statSync(bigPng).size;
    expect(await stripImageFileMetadata(bigPng, { walkLimit })).toEqual({
      size: before,
      stripped: false,
    });
    expect(fs.readFileSync(bigPng).includes(Buffer.from('tEXt'))).toBe(true);
    expect(await stripImageFileMetadata(bigPng)).toEqual({
      size: before - text.length,
      stripped: true,
    });
    expect(fs.readFileSync(bigPng).includes(Buffer.from('tEXt'))).toBe(false);
  });

  it('reads a JPEG frame header behind more than a head of metadata', async () => {
    const filler = new Array<number>(40_000).fill(0);
    const lateSof = write(
      jpeg(app0Jfif, segment(0xe1, filler), segment(0xe2, filler), sof0(20, 10), sos, scanData),
    );
    expect(await probeImageFile(lateSof, 'image/jpeg')).toMatchObject({
      ok: true,
      info: { width: 20, height: 10, animated: false },
    });
    expect(await probeImageFile(lateSof, 'image/jpeg', { walkLimit })).toEqual({
      ok: false,
      code: 'oversize',
      reason: 'Images may be at most 0 MiB',
    });
    const { size } = await stripImageFileMetadata(lateSof);
    const stripped = fs.readFileSync(lateSof);
    expect(stripped.length).toBe(size);
    expect(readImageInfo(stripped)).toMatchObject({ width: 20, height: 10, hasMetadata: false });
    expect(stripped.includes(Buffer.from('JFIF'))).toBe(true);
  });

  it('never throws on hostile bytes and checks the sniffed type against the parsed one', async () => {
    const cases: [Buffer, string][] = [
      [Buffer.alloc(0), 'image/png'],
      [Buffer.from('GIF89a'), 'image/gif'],
      [Buffer.from('RIFF\xff\xff\xff\xffWEBPVP8X', 'latin1'), 'image/webp'],
      [jpeg(segment(0xe1, [1, 2, 3]), [0xff, 0xc0, 0x00]), 'image/jpeg'],
      [gif(1, 1, [0x2c, 0x00]), 'image/gif'],
      [STATIC_GIF, 'image/png'], // sniffed as one type, parsed as another
      [STATIC_GIF, 'image/avif'], // never parsed
    ];
    for (const [buf, mime] of cases) {
      const p = write(buf);
      expect(await probeImageFile(p, mime)).toMatchObject({ ok: false, code: 'unreadable' });
      // Stripping such bytes never throws either and reports the file's real size.
      const { size } = await stripImageFileMetadata(p);
      expect(fs.statSync(p).size).toBe(size);
    }
    // A sound header followed by a chunk claiming 4 GiB: parsed from the bytes present (the
    // caps still apply), nothing allocated for the claim, the tail stored verbatim.
    const claimed = write(png(ihdr(1, 1), [0xff, 0xff, 0xff, 0xff, ...Buffer.from('IDAT')]));
    expect(await probeImageFile(claimed, 'image/png')).toMatchObject({
      ok: true,
      info: { width: 1, height: 1, animated: false, frameCount: 1 },
    });
    expect(await stripImageFileMetadata(claimed)).toEqual({
      size: fs.statSync(claimed).size,
      stripped: true,
    });
  });
});

describe('avatar and banner requirers', () => {
  let t: TestServer;
  let alice: TestUser;
  let bob: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser();
    bob = await t.createUser();
  });
  afterAll(() => t.close());

  async function uploadAs(
    user: TestUser,
    file: Buffer,
    name: string,
    opts: { kind?: 'image' | 'file'; poster?: Buffer } = {},
  ): Promise<string> {
    let req = t
      .api(user)
      .post('/api/media')
      .field('kind', opts.kind ?? 'image')
      .attach('file', file, name);
    if (opts.poster) req = req.attach('thumbnail', opts.poster, 't.jpg');
    return (await req.expect(201)).body.id as string;
  }
  const setSize = (id: string, size: number) =>
    db.update(media).set({ size }).where(eq(media.id, id));
  const rejects = (p: Promise<unknown>, status: number, message: string | RegExp) =>
    expect(p).rejects.toMatchObject({ status, message: expect.stringMatching(message) });

  it('avatars: static AVATAR_MIME_TYPES ≤ MAX_AVATAR_BYTES, or animated with a poster ≤ MAX_ANIMATED_AVATAR_BYTES', async () => {
    const still = await uploadAs(alice, PNG, 'a.png');
    await expect(requireAvatarMedia(db, still, alice.id)).resolves.toMatchObject({ id: still });
    await setSize(still, MAX_AVATAR_BYTES + 1);
    await rejects(requireAvatarMedia(db, still, alice.id), 400, 'Media is too large');

    const noPoster = await uploadAs(alice, ANIMATED_GIF, 'a.gif');
    await rejects(
      requireAvatarMedia(db, noPoster, alice.id),
      400,
      'Animated images need a static poster',
    );
    const withPoster = await uploadAs(alice, ANIMATED_GIF, 'a.gif', { poster: JPEG_EXIF });
    await expect(requireAvatarMedia(db, withPoster, alice.id)).resolves.toMatchObject({
      animated: true,
      frameCount: 2,
    });
    // Animated avatars may be larger than static ones, up to their own cap.
    await setSize(withPoster, MAX_ANIMATED_AVATAR_BYTES);
    await expect(requireAvatarMedia(db, withPoster, alice.id)).resolves.toBeDefined();
    await setSize(withPoster, MAX_ANIMATED_AVATAR_BYTES + 1);
    await rejects(requireAvatarMedia(db, withPoster, alice.id), 400, 'Media is too large');

    // A one-frame GIF is not animated, and GIF is not a static avatar type.
    const stillGif = await uploadAs(alice, STATIC_GIF, 's.gif');
    await rejects(
      requireAvatarMedia(db, stillGif, alice.id),
      400,
      'Unsupported media type image/gif',
    );
    await rejects(requireAvatarMedia(db, withPoster, bob.id), 404, 'Media not found');
    const doc = await uploadAs(alice, PNG, 'a.png', { kind: 'file' });
    await rejects(requireAvatarMedia(db, doc, alice.id), 400, /kind image/);
  });

  it('PATCH /me applies the poster rule to animated avatars', async () => {
    const noPoster = await uploadAs(alice, ANIMATED_GIF, 'a.gif');
    const res = await t.api(alice).patch('/api/me').send({ avatarMediaId: noPoster }).expect(400);
    expect(res.body.error.message).toBe('Animated images need a static poster');
    const withPoster = await uploadAs(alice, ANIMATED_WEBP, 'a.webp', { poster: JPEG_EXIF });
    await t.api(alice).patch('/api/me').send({ avatarMediaId: withPoster }).expect(200);
    const [row] = await db.select().from(users).where(eq(users.id, alice.id));
    expect(row!.avatarMediaId).toBe(withPoster);
  });

  it('banners: BANNER_MIME_TYPES ≤ MAX_BANNER_BYTES, poster required when animated', async () => {
    const still = await uploadAs(alice, JPEG_EXIF, 'b.jpg');
    await expect(requireBannerMedia(db, still, alice.id)).resolves.toMatchObject({ id: still });
    const stillGif = await uploadAs(alice, STATIC_GIF, 'b.gif');
    await expect(requireBannerMedia(db, stillGif, alice.id)).resolves.toMatchObject({
      animated: false,
    });
    await setSize(still, MAX_BANNER_BYTES + 1);
    await rejects(requireBannerMedia(db, still, alice.id), 400, 'Media is too large');

    const noPoster = await uploadAs(alice, APNG, 'b.png');
    await rejects(
      requireBannerMedia(db, noPoster, alice.id),
      400,
      'Animated images need a static poster',
    );
    const withPoster = await uploadAs(alice, APNG, 'b.png', { poster: JPEG_EXIF });
    await expect(requireBannerMedia(db, withPoster, alice.id)).resolves.toMatchObject({
      animated: true,
      thumbnailKey: expect.stringMatching(/\.jpg$/),
    });

    await rejects(requireBannerMedia(db, withPoster, bob.id), 404, 'Media not found');
    const doc = await uploadAs(alice, PNG, 'a.png', { kind: 'file' });
    await rejects(requireBannerMedia(db, doc, alice.id), 400, /kind image/);
  });
});

describe('media GC job', () => {
  let t: TestServer;
  let alice: TestUser;

  beforeAll(async () => {
    t = await startTestServer();
    alice = await t.createUser();
  });
  afterAll(() => t.close());

  async function uploadPng(withThumb = false) {
    let req = t.api(alice).post('/api/media').field('kind', 'image').attach('file', PNG, 'a.png');
    if (withThumb) req = req.attach('thumbnail', JPEG, 't.jpg');
    return (await req.expect(201)).body as MediaAttachment;
  }
  const fileOf = (url: string | null) => path.join(t.uploadDir, url!.replace('/uploads/', ''));
  const age = (id: string, ms: number) =>
    db
      .update(media)
      .set({ createdAt: new Date(Date.now() - ms) })
      .where(eq(media.id, id));

  it('deletes old unreferenced media (rows and files, thumbnails included) and keeps the rest', async () => {
    const orphan = await uploadPng(true);
    const young = await uploadPng();
    const inMessage = await uploadPng();
    const asAvatar = await uploadPng();
    const asBanner = await uploadPng(true);
    const chatId = await createGroup(alice);
    await send(alice, chatId, { type: 'image', text: null, mediaId: inMessage.id });
    await db
      .update(users)
      .set({ avatarMediaId: asAvatar.id, bannerMediaId: asBanner.id })
      .where(eq(users.id, alice.id));
    const day = 25 * 60 * 60 * 1000;
    for (const m of [orphan, inMessage, asAvatar, asBanner]) await age(m.id, day);

    const deleted = await runMediaGc();
    expect(deleted).toBe(1);
    const ids = (await db.select({ id: media.id }).from(media)).map((r) => r.id);
    expect(ids).not.toContain(orphan.id);
    expect(ids).toEqual(expect.arrayContaining([young.id, inMessage.id, asAvatar.id, asBanner.id]));
    expect(fs.existsSync(fileOf(orphan.url))).toBe(false);
    expect(fs.existsSync(fileOf(orphan.thumbnailUrl))).toBe(false);
    expect(fs.existsSync(fileOf(inMessage.url))).toBe(true);
    expect(fs.existsSync(fileOf(asBanner.thumbnailUrl))).toBe(true);

    // Deleting the referencing message for everyone nulls the reference → collectable later.
    await db.update(messages).set({ mediaId: null }).where(eq(messages.mediaId, inMessage.id));
    expect(await runMediaGc()).toBe(1);
    expect(await runMediaGc({ ttlMs: 0 })).toBe(1); // `young` once the TTL is 0; the avatar and banner stay
    expect((await db.select({ id: media.id }).from(media)).map((r) => r.id).sort()).toEqual(
      [asAvatar.id, asBanner.id].sort(),
    );
  });

  it('processes in batches', async () => {
    for (let i = 0; i < 5; i++) await uploadPng();
    expect(await runMediaGc({ ttlMs: 0, batchSize: 2 })).toBe(5);
  });
});
