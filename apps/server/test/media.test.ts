import fs from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { MAX_FILE_NAME_LENGTH, MAX_THUMBNAIL_BYTES, type MediaAttachment } from '@enbox/shared';
import { db } from '../src/db/index.js';
import { media, messages, users } from '../src/db/schema.js';
import { runMediaGc } from '../src/jobs/mediaGc.js';
import { sanitizeFileName } from '../src/services/uploads.js';
import { startTestServer, type TestServer, type TestUser } from './helpers.js';
import { createGroup, send } from './services/fixtures.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG = Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]),
  Buffer.from('JFIF\0'),
  Buffer.alloc(64),
]);
const WEBM = Buffer.from([
  0x1a,
  0x45,
  0xdf,
  0xa3,
  0x9f,
  0x42,
  0x86,
  0x81,
  0x01,
  0x42,
  0xf7,
  0x81,
  0x01,
  0x42,
  0xf2,
  0x81,
  0x04,
  0x42,
  0xf3,
  0x81,
  0x08,
  0x42,
  0x82,
  0x84,
  0x77,
  0x65,
  0x62,
  0x6d,
  0x42,
  0x87,
  0x81,
  0x02,
  0x42,
  0x85,
  0x81,
  0x02,
  ...Array(64).fill(0),
]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const SVG_XML = Buffer.from('<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"></svg>');
const HTML = Buffer.from(
  '<!doctype html><html><body><script>alert(document.cookie)</script></body></html>',
);

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
      durationMs: null,
      waveform: null,
      thumbnailUrl: null,
    });
    const now = new Date();
    const yyyy = String(now.getUTCFullYear());
    const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
    expect(m.url).toMatch(new RegExp(`^/uploads/${yyyy}/${mm}/[0-9a-f-]{36}\\.png$`)); // extension from the bytes, not the name
    expect(fs.readFileSync(path.join(t.uploadDir, m.url.replace('/uploads/', '')))).toEqual(PNG);
    const served = await t.api().get(m.url).expect(200);
    expect(served.headers['x-content-type-options']).toBe('nosniff');
    const [row] = await db.select().from(media).where(eq(media.id, m.id));
    expect(row!.uploaderId).toBe(alice.id);
    // temp files are cleaned up
    expect(fs.readdirSync(path.join(t.uploadDir, '.tmp'))).toEqual([]);
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
    const chatId = await createGroup(alice);
    await send(alice, chatId, { type: 'image', text: null, mediaId: inMessage.id });
    await db.update(users).set({ avatarMediaId: asAvatar.id }).where(eq(users.id, alice.id));
    const day = 25 * 60 * 60 * 1000;
    for (const m of [orphan, inMessage, asAvatar]) await age(m.id, day);

    const deleted = await runMediaGc();
    expect(deleted).toBe(1);
    const ids = (await db.select({ id: media.id }).from(media)).map((r) => r.id);
    expect(ids).not.toContain(orphan.id);
    expect(ids).toEqual(expect.arrayContaining([young.id, inMessage.id, asAvatar.id]));
    expect(fs.existsSync(fileOf(orphan.url))).toBe(false);
    expect(fs.existsSync(fileOf(orphan.thumbnailUrl))).toBe(false);
    expect(fs.existsSync(fileOf(inMessage.url))).toBe(true);

    // Deleting the referencing message for everyone nulls the reference → collectable later.
    await db.update(messages).set({ mediaId: null }).where(eq(messages.mediaId, inMessage.id));
    expect(await runMediaGc()).toBe(1);
    expect(await runMediaGc({ ttlMs: 0 })).toBe(1); // `young` once the TTL is 0; the avatar stays
    expect((await db.select({ id: media.id }).from(media)).map((r) => r.id)).toEqual([asAvatar.id]);
  });

  it('processes in batches', async () => {
    for (let i = 0; i < 5; i++) await uploadPng();
    expect(await runMediaGc({ ttlMs: 0, batchSize: 2 })).toBe(5);
  });
});
