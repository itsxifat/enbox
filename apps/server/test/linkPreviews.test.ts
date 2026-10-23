import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { LinkPreview } from '@enbox/shared';
import { db } from '../src/db/index.js';
import { linkPreviews } from '../src/db/schema.js';
import { runLinkPreviewGc } from '../src/jobs/linkPreviewGc.js';
import {
  allowLocalLinkPreviewsForTests,
  isPublicAddress,
  normalizeLink,
  parsePageMeta,
} from '../src/services/linkPreviews.js';
import { startTestServer, type TestServer, type TestUser } from './helpers.js';
import {
  ANIMATED_GIF,
  actl,
  fctl,
  fdat,
  gif,
  gifFrame,
  gifWithFrames,
  idat,
  iend,
  ihdr,
  png,
} from './support/images.js';

describe('isPublicAddress', () => {
  it('allows public unicast addresses', () => {
    for (const ip of ['1.1.1.1', '8.8.8.8', '103.129.209.29', '2606:4700:4700::1111'])
      expect(isPublicAddress(ip), ip).toBe(true);
  });

  it('refuses loopback, private, link-local, CGNAT, multicast and special ranges', () => {
    for (const ip of [
      '127.0.0.1',
      '10.1.2.3',
      '172.16.0.1',
      '172.31.255.255',
      '192.168.20.237',
      '169.254.169.254',
      '100.64.0.1',
      '0.0.0.0',
      '224.0.0.1',
      '255.255.255.255',
      '198.18.0.1',
      '::1',
      '::',
      '::ffff:127.0.0.1',
      '::ffff:192.168.1.1',
      '64:ff9b::a00:1',
      'fc00::1',
      'fd12:3456::1',
      'fe80::1',
      'ff02::1',
      '2001:db8::1',
      '2002:c0a8:101::1',
      'not-an-ip',
    ])
      expect(isPublicAddress(ip), ip).toBe(false);
  });
});

describe('normalizeLink', () => {
  it('keeps http(s) links on the default port, without the fragment', () => {
    expect(normalizeLink('https://example.com/a?b=1#top')?.href).toBe('https://example.com/a?b=1');
    expect(normalizeLink('http://EXAMPLE.com:80/x')?.href).toBe('http://example.com/x');
    expect(normalizeLink('https://例え.jp/')?.hostname).toBe('xn--r8jz45g.jp');
  });

  it('refuses other schemes, ports, credentials and single-label hosts', () => {
    for (const raw of [
      'ftp://example.com/',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'https://example.com:8443/',
      'http://example.com:22/',
      'https://user:pw@example.com/',
      'http://localhost/',
      'http://intranet/',
      'not a url',
      `https://example.com/${'a'.repeat(2100)}`,
    ])
      expect(normalizeLink(raw), raw).toBeNull();
  });
});

describe('parsePageMeta', () => {
  const page = new URL('https://news.example.com/story/1');

  it('reads Open Graph tags in any attribute order, entities decoded', () => {
    const meta = parsePageMeta(
      `<!doctype html><html><head>
        <title>Fallback title</title>
        <meta content="Big &amp; bold &#8212; news" property="og:title">
        <meta property='og:description' content='A "quoted" &lt;summary&gt; with &#x1F600;'>
        <meta property="og:site_name" content="Example News">
        <meta name="theme-color" content="#3B82F6">
        <meta property="og:image" content="/img/cover.png">
      </head><body><meta property="og:title" content="ignored"></body></html>`,
      page,
    );
    expect(meta).toEqual({
      title: 'Big & bold — news',
      description: 'A "quoted" <summary> with 😀',
      siteName: 'Example News',
      themeColor: '#3b82f6',
      image: 'https://news.example.com/img/cover.png',
    });
  });

  it('falls back to Twitter tags, the description meta and <title>', () => {
    const meta = parsePageMeta(
      `<head><title>  Plain
        title </title><meta name="description" content="Desc">
        <meta name="twitter:image" content="https://cdn.example.com/x.jpg"><meta name="theme-color" content="fff"></head>`,
      page,
    );
    expect(meta.title).toBe('Plain title');
    expect(meta.description).toBe('Desc');
    expect(meta.image).toBe('https://cdn.example.com/x.jpg');
    expect(meta.themeColor).toBe('#ffffff');
    expect(meta.siteName).toBeNull();
  });

  it('ignores scripts and comments, unsafe characters and non-http images', () => {
    const meta = parsePageMeta(
      `<head><script>var s = '<meta property="og:title" content="from script">';</script>
       <!-- <meta property="og:title" content="from comment"> -->
       <meta property="og:title" content="Real‮ title&#0;">
       <meta property="og:image" content="javascript:alert(1)"></head>`,
      page,
    );
    expect(meta.title).toBe('Real title�');
    expect(meta.image).toBeNull();
  });

  it('truncates long text', () => {
    const meta = parsePageMeta(`<head><title>${'x'.repeat(1000)}</title></head>`, page);
    expect(Array.from(meta.title!).length).toBe(300);
    expect(meta.title!.endsWith('…')).toBe(true);
  });
});

describe('GET /api/link-preview', () => {
  let t: TestServer;
  let user: TestUser;
  let site: http.Server;
  let origin = '';
  let hits = 0;
  const COVER = gif(120, 63, gifFrame(120, 63));
  const ANIMATED_64 = gifWithFrames(3, 64, 64);
  const APNG_64 = png(
    ihdr(64, 64),
    actl(2, 0),
    fctl(0, 64, 64),
    idat,
    fctl(1, 64, 64),
    fdat(2),
    iend,
  );
  const image = (type: string, body: Buffer) => (res: http.ServerResponse) => {
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  };
  const IMAGES: Record<string, (res: http.ServerResponse) => void> = {
    '/photo.gif': image('image/gif', COVER),
    '/animated.gif': image('image/gif', ANIMATED_64),
    '/tiny.gif': image('image/gif', gif(8, 8, gifFrame(8, 8))),
    '/moving.png': image('image/png', APNG_64),
    '/lying.png': image('image/png', Buffer.from('<html>not an image</html>')),
    '/huge.gif': (res) => {
      res.writeHead(200, {
        'content-type': 'image/gif',
        'content-length': String(6 * 1024 * 1024),
      });
      res.end();
    },
    // A video is never downloaded: this body never ends, so reading it would time out.
    '/clip.mp4': (res) => {
      res.writeHead(200, { 'content-type': 'video/mp4' });
      res.write(Buffer.alloc(1024));
    },
  };

  beforeAll(async () => {
    t = await startTestServer();
    user = await t.createUser();
    site = http.createServer((req, res) => {
      hits += 1;
      const direct = IMAGES[req.url ?? ''];
      if (direct) return direct(res);
      switch (req.url) {
        case '/article':
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          res.end(
            `<html><head><title>Article</title><meta property="og:description" content="About it">
             <meta property="og:image" content="${origin}/cover.gif"></head><body>…</body></html>`,
          );
          return;
        case '/gzip':
          res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
          res.end(zlib.gzipSync('<head><meta property="og:title" content="Zipped"></head>'));
          return;
        case '/moved':
          res.writeHead(301, { location: '/article' });
          res.end();
          return;
        case '/to-ftp':
          res.writeHead(302, { location: 'ftp://example.com/' });
          res.end();
          return;
        case '/animated':
          res.writeHead(200, { 'content-type': 'text/html' });
          res.end(`<head><title>Anim</title><meta property="og:image" content="/anim.gif"></head>`);
          return;
        case '/cover.gif':
          res.writeHead(200, { 'content-type': 'image/gif' });
          res.end(COVER);
          return;
        case '/anim.gif':
          res.writeHead(200, { 'content-type': 'image/gif' });
          res.end(ANIMATED_GIF);
          return;
        case '/file.zip':
          res.writeHead(200, { 'content-type': 'application/zip' });
          res.end('PK');
          return;
        default:
          res.writeHead(404);
          res.end();
      }
    });
    await new Promise<void>((resolve) => site.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(site.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    allowLocalLinkPreviewsForTests(false);
    site.closeAllConnections();
    await new Promise<void>((resolve) => site.close(() => resolve()));
    await t.close();
  });

  const preview = async (url: string) => {
    const res = await t.api(user).get('/api/link-preview').query({ url });
    expect(res.status).toBe(200);
    return (res.body as { preview: LinkPreview | null }).preview;
  };

  it('requires a session and a url', async () => {
    expect((await t.api().get('/api/link-preview').query({ url: 'https://a.com' })).status).toBe(
      401,
    );
    expect((await t.api(user).get('/api/link-preview')).status).toBe(400);
  });

  it('never fetches private addresses', async () => {
    allowLocalLinkPreviewsForTests(false);
    const before = hits;
    expect(await preview(`${origin}/article`)).toBeNull();
    expect(await preview('http://127.0.0.1/article')).toBeNull();
    expect(await preview('http://[::1]/article')).toBeNull();
    expect(hits).toBe(before);
  });

  it('fetches, caches and stores the image', async () => {
    allowLocalLinkPreviewsForTests(true);
    const p = await preview(`${origin}/article#section`);
    expect(p).toMatchObject({
      url: `${origin}/article`,
      domain: '127.0.0.1',
      title: 'Article',
      description: 'About it',
      siteName: null,
      image: { width: 120, height: 63 },
    });
    expect(p!.image!.url).toMatch(/^\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]+\.gif$/);
    const stored = path.join(t.uploadDir, p!.image!.url.replace('/uploads/', ''));
    expect(fs.readFileSync(stored).equals(COVER)).toBe(true);

    const before = hits;
    expect(await preview(`${origin}/article`)).toEqual(p);
    expect(hits).toBe(before);

    // The GC deletes the row and the image once it is old.
    expect(await runLinkPreviewGc({ ttlMs: -1000 })).toBeGreaterThan(0);
    expect(fs.existsSync(stored)).toBe(false);
    expect(
      await db
        .select()
        .from(linkPreviews)
        .where(eq(linkPreviews.url, `${origin}/article`)),
    ).toEqual([]);
  });

  it('follows redirects, decompresses, drops animated images and non-pages', async () => {
    allowLocalLinkPreviewsForTests(true);
    expect((await preview(`${origin}/moved`))?.title).toBe('Article');
    expect((await preview(`${origin}/gzip`))?.title).toBe('Zipped');
    const anim = await preview(`${origin}/animated`);
    expect(anim?.title).toBe('Anim');
    expect(anim?.image).toBeNull();
    expect(await preview(`${origin}/file.zip`)).toBeNull();
    expect(await preview(`${origin}/to-ftp`)).toBeNull();
    expect(await preview(`${origin}/missing`)).toBeNull();
    // A miss is cached too.
    const before = hits;
    expect(await preview(`${origin}/missing`)).toBeNull();
    expect(hits).toBe(before);
  });

  it('a direct image link previews as the stored image alone', async () => {
    allowLocalLinkPreviewsForTests(true);
    const p = await preview(`${origin}/photo.gif`);
    expect(p).toMatchObject({
      url: `${origin}/photo.gif`,
      domain: '127.0.0.1',
      siteName: null,
      title: null,
      description: null,
      themeColor: null,
      image: { width: 120, height: 63 },
    });
    expect(p!.image!.url).toMatch(/^\/uploads\/\d{4}\/\d{2}\/[0-9a-f-]+\.gif$/);
    const stored = path.join(t.uploadDir, p!.image!.url.replace('/uploads/', ''));
    expect(fs.readFileSync(stored).equals(COVER)).toBe(true);
    // Cached like any preview.
    const before = hits;
    expect(await preview(`${origin}/photo.gif`)).toEqual(p);
    expect(hits).toBe(before);
  });

  it('direct links keep animated GIFs (clients draw the still); not APNGs, tiny or fake images', async () => {
    allowLocalLinkPreviewsForTests(true);
    const anim = await preview(`${origin}/animated.gif`);
    expect(anim?.image).toMatchObject({ width: 64, height: 64 });
    const stored = path.join(t.uploadDir, anim!.image!.url.replace('/uploads/', ''));
    expect(fs.readFileSync(stored).equals(ANIMATED_64)).toBe(true);
    expect(await preview(`${origin}/moving.png`)).toBeNull();
    expect(await preview(`${origin}/tiny.gif`)).toBeNull();
    expect(await preview(`${origin}/lying.png`)).toBeNull();
    expect(await preview(`${origin}/huge.gif`)).toBeNull();
  });

  it('a video link has no preview and is never downloaded', async () => {
    allowLocalLinkPreviewsForTests(true);
    const started = Date.now();
    expect(await preview(`${origin}/clip.mp4`)).toBeNull();
    expect(Date.now() - started).toBeLessThan(4000);
  });
});
