/**
 * Link previews (`GET /api/link-preview?url=`): the card a client shows under a message
 * with a link — title, description, site name, theme colour and an image.
 *
 * The server fetches the page, never the client: sites do not learn who reads a chat, and
 * the image is a copy stored under /uploads (metadata stripped), not the site's own URL.
 * Results — "no preview" included — are cached in `link_previews`, one row per normalised
 * link: a preview is refreshed after LINK_PREVIEW_TTL_MS, a link without one is retried
 * after NO_PREVIEW_TTL_MS, and the GC job (jobs/linkPreviewGc.ts) deletes rows and their
 * images once they are older than LINK_PREVIEW_TTL_MS.
 *
 * Outbound requests can be aimed at anything a link names, so they are fenced in:
 * - http(s) on the default port only, no credentials, at most MAX_REDIRECTS redirects, each
 *   hop checked again;
 * - every address a host resolves to must be public (`isPublicAddress`: no loopback,
 *   private, link-local, CGNAT, multicast, documentation, NAT64/6to4 or other special
 *   ranges), and the connection is made to the checked address itself (custom `lookup`, no
 *   pooled sockets), so DNS rebinding between check and connect cannot reach the LAN;
 * - FETCH_TIMEOUT_MS per fetch, PAGE_MAX_BYTES of (decompressed) HTML, IMAGE_MAX_BYTES per
 *   image, MAX_CONCURRENT_FETCHES at a time, one fetch per link at a time.
 */
import dns from 'node:dns';
import fs from 'node:fs/promises';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { domainToUnicode } from 'node:url';
import zlib from 'node:zlib';
import { eq, sql } from 'drizzle-orm';
import {
  MAX_LINK_PREVIEW_URL_LENGTH,
  readImageInfo,
  stripImageMetadata,
  type ImageMime,
  type LinkPreview,
} from '@enbox/shared';
import { db } from '../db/index.js';
import { linkPreviews, type LinkPreviewRow } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { imageCapViolation } from './imageProbe.js';
import { mediaUrl } from './media.js';
import { newStorageKey, removeStoredFiles, storagePath } from './uploads.js';

/** A preview is refreshed after this long (and the GC deletes rows older than this). */
export const LINK_PREVIEW_TTL_MS = 7 * 24 * 60 * 60_000;
/** A link that had no preview (or could not be fetched) is retried after this long. */
export const NO_PREVIEW_TTL_MS = 6 * 60 * 60_000;
const PAGE_MAX_BYTES = 1024 * 1024;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 5;
const MAX_CONCURRENT_FETCHES = 6;
/** Waiting fetches beyond this are refused (no preview this time, nothing cached). */
const MAX_QUEUED_FETCHES = 200;
/** Images smaller than this on either side (icons, tracking pixels) are dropped. */
const MIN_IMAGE_SIDE = 48;
const TITLE_MAX = 300;
const DESCRIPTION_MAX = 600;
const SITE_NAME_MAX = 100;
const USER_AGENT = 'Mozilla/5.0 (compatible; EnboxBot/1.0; +https://enbox.dev) like TwitterBot';

const IMAGE_EXT: Record<ImageMime, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

// ---------------------------------------------------------------------------
// Address policy
// ---------------------------------------------------------------------------

const SPECIAL_V4: [string, number][] = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
];
/** Inside 2000::/3 (the only range allowed): IANA special, documentation, 6to4 (embeds IPv4). */
const SPECIAL_V6: [string, number][] = [
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
];
const SPECIAL = new net.BlockList();
for (const [a, p] of SPECIAL_V4) SPECIAL.addSubnet(a, p, 'ipv4');
for (const [a, p] of SPECIAL_V6) SPECIAL.addSubnet(a, p, 'ipv6');
const GLOBAL_UNICAST_V6 = new net.BlockList();
GLOBAL_UNICAST_V6.addSubnet('2000::', 3, 'ipv6');

/**
 * Whether the fetcher may connect to `ip`: a public IPv4 address, or an IPv6 address in
 * global unicast (2000::/3, which leaves out loopback, IPv4-mapped, NAT64, ULA, link-local
 * and multicast) outside its special blocks.
 */
export function isPublicAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return !SPECIAL.check(ip, 'ipv4');
  if (family === 6) return GLOBAL_UNICAST_V6.check(ip, 'ipv6') && !SPECIAL.check(ip, 'ipv6');
  return false;
}

let addressAllowed: (ip: string) => boolean = isPublicAddress;
let anyPort = false;

/** Tests only: let the fetcher reach a local server on any port (false restores the policy). */
export function allowLocalLinkPreviewsForTests(on: boolean): void {
  addressAllowed = on ? () => true : isPublicAddress;
  anyPort = on;
}

class PreviewFetchError extends Error {}
class FetchQueueFullError extends Error {}

/**
 * `lookup` for outbound sockets: resolves like dns.lookup but only hands out allowed
 * addresses, so the socket connects to exactly what was checked.
 */
const guardedLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { all: true, family: options.family ?? 0 }, (err, addresses) => {
    if (err) return callback(err, '');
    const allowed = addresses.filter((a) => addressAllowed(a.address));
    if (!allowed.length) {
      return callback(
        Object.assign(new Error(`${hostname} has no public address`), { code: 'EBLOCKED' }),
        '',
      );
    }
    if (options.all) callback(null, allowed);
    else callback(null, allowed[0]!.address, allowed[0]!.family);
  });
};

/**
 * The link a preview is cached under: an http(s) URL on its default port, without
 * credentials or fragment, whose host is a domain name or an IP literal. Null when the link
 * cannot be previewed.
 */
export function normalizeLink(raw: string): URL | null {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  if (u.username || u.password || (u.port !== '' && !anyPort) || !u.hostname) return null;
  // Single-label names (localhost, intranet hosts) only ever resolve inside a network.
  if (!net.isIP(bareHost(u)) && !u.hostname.includes('.')) return null;
  u.hash = '';
  return u.href.length <= MAX_LINK_PREVIEW_URL_LENGTH ? u : null;
}

/** Hostname without the brackets of an IPv6 literal. */
function bareHost(u: URL): string {
  return u.hostname.replace(/^\[(.*)\]$/, '$1');
}

/** Hostname as people read it: Unicode, without `www.`. */
function displayDomain(u: URL): string {
  const host = bareHost(u);
  return (domainToUnicode(host) || host).replace(/^www\./i, '');
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface Fetched {
  /** Where the body came from (after redirects). */
  url: URL;
  contentType: string;
  body: Buffer;
}

interface FetchOptions {
  accept: string;
  maxBytes: number;
  /** Keep the first `maxBytes` of a longer body (pages) instead of failing (images). */
  truncate: boolean;
}

function requestOnce(url: URL, accept: string, signal: AbortSignal): Promise<http.IncomingMessage> {
  const host = bareHost(url);
  if (net.isIP(host) && !addressAllowed(host)) {
    return Promise.reject(new PreviewFetchError(`${host} is not a public address`));
  }
  const mod = url.protocol === 'https:' ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.request(
      url,
      {
        method: 'GET',
        headers: {
          'user-agent': USER_AGENT,
          accept,
          'accept-language': 'en;q=0.9, *;q=0.5',
          'accept-encoding': 'gzip, deflate, br',
        },
        lookup: guardedLookup,
        // A fresh socket per request: a pooled one would skip the guarded lookup.
        agent: false,
        signal,
        maxHeaderSize: 32 * 1024,
      },
      resolve,
    );
    req.on('error', reject);
    req.end();
  });
}

/** Reads a (decompressed) body up to `maxBytes`. */
function readBody(
  res: http.IncomingMessage,
  { maxBytes, truncate }: FetchOptions,
): Promise<{ body: Buffer }> {
  const encoding = String(res.headers['content-encoding'] ?? '')
    .trim()
    .toLowerCase();
  let stream: Readable = res;
  if (encoding === 'gzip' || encoding === 'x-gzip') stream = res.pipe(zlib.createGunzip());
  else if (encoding === 'deflate') stream = res.pipe(zlib.createInflate());
  else if (encoding === 'br') stream = res.pipe(zlib.createBrotliDecompress());
  else if (encoding !== '' && encoding !== 'identity') {
    res.destroy();
    return Promise.reject(new PreviewFetchError(`Unsupported content-encoding ${encoding}`));
  }
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const stop = () => {
      done = true;
      res.destroy();
      if (stream !== res) stream.destroy();
    };
    const finish = () => {
      if (done) return;
      stop();
      resolve({ body: Buffer.concat(chunks, size) });
    };
    const fail = (err: unknown) => {
      if (done) return;
      stop();
      reject(err);
    };
    stream.on('data', (chunk: Buffer) => {
      if (done) return;
      const room = maxBytes - size;
      if (chunk.length > room) {
        if (!truncate) return fail(new PreviewFetchError('Response too large'));
        chunks.push(chunk.subarray(0, room));
        size += room;
        return finish();
      }
      chunks.push(chunk);
      size += chunk.length;
    });
    stream.on('end', finish);
    stream.on('error', fail);
    if (stream !== res) res.on('error', fail);
  });
}

/** GET with the address policy, redirects (re-checked per hop), a deadline and a size cap. */
async function fetchCapped(start: URL, opts: FetchOptions): Promise<Fetched> {
  const signal = AbortSignal.timeout(FETCH_TIMEOUT_MS);
  let url = start;
  for (let hop = 0; ; hop++) {
    const res = await requestOnce(url, opts.accept, signal);
    const status = res.statusCode ?? 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.destroy();
      if (hop >= MAX_REDIRECTS) throw new PreviewFetchError('Too many redirects');
      let next: URL | null = null;
      try {
        next = normalizeLink(new URL(res.headers.location, url).href);
      } catch {
        // invalid Location
      }
      if (!next) throw new PreviewFetchError('Redirect to a link that cannot be previewed');
      url = next;
      continue;
    }
    if (status < 200 || status >= 300) {
      res.destroy();
      throw new PreviewFetchError(`HTTP ${status}`);
    }
    const declared = Number(res.headers['content-length']);
    if (!opts.truncate && !res.headers['content-encoding'] && declared > opts.maxBytes) {
      res.destroy();
      throw new PreviewFetchError('Response too large');
    }
    const { body } = await readBody(res, opts);
    return { url, contentType: String(res.headers['content-type'] ?? ''), body };
  }
}

let activeFetches = 0;
const waitingFetches: (() => void)[] = [];

/** Runs `fn` in one of MAX_CONCURRENT_FETCHES slots (a finished fetch hands its slot on). */
async function withFetchSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (activeFetches < MAX_CONCURRENT_FETCHES) activeFetches++;
  else if (waitingFetches.length >= MAX_QUEUED_FETCHES) throw new FetchQueueFullError();
  else await new Promise<void>((resolve) => waitingFetches.push(resolve));
  try {
    return await fn();
  } finally {
    const next = waitingFetches.shift();
    if (next) next();
    else activeFetches--;
  }
}

// ---------------------------------------------------------------------------
// HTML metadata
// ---------------------------------------------------------------------------

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  hellip: '…',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  bull: '•',
  middot: '·',
  copy: '©',
  reg: '®',
  trade: '™',
  euro: '€',
  pound: '£',
  times: '×',
};

function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]*);/gi, (all, ref: string) => {
    if (ref[0] === '#') {
      const hex = ref[1] === 'x' || ref[1] === 'X';
      const cp = Number.parseInt(ref.slice(hex ? 2 : 1), hex ? 16 : 10);
      // NUL and lone surrogates cannot be stored (or rendered); out-of-range is invalid.
      if (!(cp > 0 && cp <= 0x10ffff) || (cp >= 0xd800 && cp <= 0xdfff)) return '�';
      return String.fromCodePoint(cp);
    }
    return NAMED_ENTITIES[ref.toLowerCase()] ?? all;
  });
}

// Control characters, line/paragraph separators, bidi marks/embeddings/overrides/isolates
// and the BOM (ZWJ/ZWNJ stay: emoji sequences and some scripts need them).
const cp = (...codes: number[]) => String.fromCodePoint(...codes);
const UNSAFE_TEXT = new RegExp(
  `[\\p{Cc}\\p{Zl}\\p{Zp}${cp(0x061c, 0x200e, 0x200f, 0xfeff)}${cp(0x202a)}-${cp(0x202e)}${cp(0x2066)}-${cp(0x2069)}]`,
  'gu',
);

/** Display text: unsafe characters out, whitespace collapsed, at most `max` characters. */
function cleanText(raw: string | undefined, max: number): string | null {
  if (!raw) return null;
  const s = raw.replace(UNSAFE_TEXT, ' ').replace(/\s+/g, ' ').trim();
  if (!s) return null;
  const chars = Array.from(s);
  return chars.length > max
    ? `${chars
        .slice(0, max - 1)
        .join('')
        .trimEnd()}…`
    : s;
}

/** `#rgb` / `#rrggbb` (with or without `#`) → `#rrggbb`, else null. */
function hexColor(raw: string | undefined): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(raw?.trim() ?? '');
  if (!m) return null;
  const h = m[1]!.toLowerCase();
  return `#${h.length === 3 ? Array.from(h, (c) => c + c).join('') : h}`;
}

function parseAttributes(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(
    /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g,
  )) {
    const name = m[1]!.toLowerCase();
    if (!out.has(name)) out.set(name, decodeEntities(m[2] ?? m[3] ?? m[4] ?? ''));
  }
  return out;
}

export interface PageMeta {
  title: string | null;
  description: string | null;
  siteName: string | null;
  themeColor: string | null;
  /** Absolute http(s) URL of the page's preview image. */
  image: string | null;
}

/**
 * Open Graph / Twitter card / plain HTML metadata of a page's head: title (og:title,
 * twitter:title, <title>), description (og:, twitter:, description), og:site_name,
 * theme-color and the image (og:image[:secure_url|:url], twitter:image[:src]) resolved
 * against `pageUrl`.
 */
export function parsePageMeta(html: string, pageUrl: URL): PageMeta {
  const end = html.search(/<\/head\s*>/i);
  const head = (end >= 0 ? html.slice(0, end) : html)
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1\s*>/gi, ' ');
  const metas = new Map<string, string>();
  for (const m of head.matchAll(/<meta\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi)) {
    const attrs = parseAttributes(m[1]!);
    const key = (attrs.get('property') ?? attrs.get('name') ?? attrs.get('itemprop'))
      ?.trim()
      .toLowerCase();
    const content = attrs.get('content');
    if (key && content !== undefined && content.trim() && !metas.has(key)) metas.set(key, content);
  }
  const first = (...keys: string[]) => keys.map((k) => metas.get(k)).find((v) => v !== undefined);
  const titleTag = /<title\b[^>]*>([\s\S]*?)<\/title\s*>/i.exec(head)?.[1];

  let image: string | null = null;
  const rawImage = first(
    'og:image:secure_url',
    'og:image',
    'og:image:url',
    'twitter:image',
    'twitter:image:src',
  );
  if (rawImage) {
    try {
      const u = new URL(rawImage.trim(), pageUrl);
      if (u.protocol === 'https:' || u.protocol === 'http:') image = u.href;
    } catch {
      // unusable image URL
    }
  }
  return {
    title: cleanText(
      first('og:title', 'twitter:title') ?? (titleTag ? decodeEntities(titleTag) : undefined),
      TITLE_MAX,
    ),
    description: cleanText(
      first('og:description', 'twitter:description', 'description'),
      DESCRIPTION_MAX,
    ),
    siteName: cleanText(first('og:site_name'), SITE_NAME_MAX),
    themeColor: hexColor(first('theme-color')),
    image,
  };
}

/** Text of an HTML body: charset from the BOM / Content-Type / a <meta> in the head, else UTF-8. */
function decodeHtml(body: Buffer, contentType: string): string {
  const fromHeader = /charset\s*=\s*["']?([\w.:-]+)/i.exec(contentType)?.[1];
  const fromMeta = /<meta\b[^>]*charset\s*=\s*["']?([\w.:-]+)/i.exec(
    body.subarray(0, 4096).toString('latin1'),
  )?.[1];
  const bom = body[0] === 0xef && body[1] === 0xbb && body[2] === 0xbf ? 'utf-8' : undefined;
  for (const label of [bom, fromHeader, fromMeta]) {
    if (!label) continue;
    try {
      return new TextDecoder(label).decode(body);
    } catch {
      // unknown charset label: try the next source
    }
  }
  return new TextDecoder('utf-8').decode(body);
}

// ---------------------------------------------------------------------------
// Previews
// ---------------------------------------------------------------------------

type PreviewData = Omit<LinkPreviewRow, 'url' | 'fetchedAt'>;

const NO_PREVIEW: PreviewData = {
  domain: null,
  siteName: null,
  title: null,
  description: null,
  themeColor: null,
  imageKey: null,
  imageWidth: null,
  imageHeight: null,
};

function hasContent(d: PreviewData): boolean {
  return !!(d.title || d.description || d.imageKey);
}

/** Downloads, verifies and stores a preview image; null when it is unusable. */
async function storePreviewImage(
  src: string,
): Promise<{ key: string; width: number; height: number } | null> {
  const url = normalizeLink(src);
  if (!url) return null;
  const { body } = await fetchCapped(url, {
    accept: 'image/webp,image/png,image/jpeg,image/gif;q=0.8',
    maxBytes: IMAGE_MAX_BYTES,
    truncate: false,
  });
  const info = readImageInfo(body);
  // Animated images have no static poster to honour "play animated media: never" with.
  if (!info || info.animated || !info.framesInCanvas || imageCapViolation(info)) return null;
  if (Math.min(info.width, info.height) < MIN_IMAGE_SIDE) return null;
  const key = newStorageKey(IMAGE_EXT[info.mime]);
  const dest = storagePath(key);
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.writeFile(dest, stripImageMetadata(body));
  return { key, width: info.width, height: info.height };
}

async function fetchPreview(url: URL): Promise<PreviewData> {
  const page = await fetchCapped(url, {
    accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.1',
    maxBytes: PAGE_MAX_BYTES,
    truncate: true,
  });
  const domain = displayDomain(page.url);
  const type = page.contentType.split(';')[0]!.trim().toLowerCase();
  if (type !== 'text/html' && type !== 'application/xhtml+xml') return { ...NO_PREVIEW, domain };
  const meta = parsePageMeta(decodeHtml(page.body, page.contentType), page.url);
  let image: Awaited<ReturnType<typeof storePreviewImage>> = null;
  if (meta.image) {
    image = await storePreviewImage(meta.image).catch((err: unknown) => {
      logger.debug({ err, image: meta.image }, 'link preview image skipped');
      return null;
    });
  }
  return {
    domain,
    siteName: meta.siteName,
    title: meta.title,
    description: meta.description,
    themeColor: meta.themeColor,
    imageKey: image?.key ?? null,
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
  };
}

function toLinkPreview(url: string, d: PreviewData): LinkPreview | null {
  if (!hasContent(d)) return null;
  return {
    url,
    domain: d.domain ?? '',
    siteName: d.siteName,
    title: d.title,
    description: d.description,
    themeColor: d.themeColor,
    image:
      d.imageKey && d.imageWidth && d.imageHeight
        ? { url: mediaUrl(d.imageKey), width: d.imageWidth, height: d.imageHeight }
        : null,
  };
}

function isFresh(row: LinkPreviewRow, now = Date.now()): boolean {
  const age = now - row.fetchedAt.getTime();
  return age < (hasContent(row) ? LINK_PREVIEW_TTL_MS : NO_PREVIEW_TTL_MS);
}

/**
 * Fetches a link again and stores the result. Cluster-safe: the write runs under a per-link
 * advisory lock with the row locked (the GC skips it), so when several processes refresh one
 * link at once the first write wins and the others drop their copies, and a replaced image is
 * always the one the row held.
 */
async function refresh(url: URL, old: LinkPreviewRow | null): Promise<LinkPreview | null> {
  let data: PreviewData;
  let fetchedAt = new Date();
  let keptOld = false;
  try {
    data = await withFetchSlot(() => fetchPreview(url));
  } catch (err) {
    if (err instanceof FetchQueueFullError) return old ? toLinkPreview(old.url, old) : null;
    logger.debug({ err, url: url.href }, 'link preview fetch failed');
    if (old && hasContent(old)) {
      // A site that is down for a while keeps its last preview; retried like a miss.
      data = old;
      keptOld = true;
      fetchedAt = new Date(Date.now() - LINK_PREVIEW_TTL_MS + NO_PREVIEW_TTL_MS);
    } else {
      data = NO_PREVIEW;
    }
  }
  const fetched: PreviewData = {
    domain: data.domain,
    siteName: data.siteName,
    title: data.title,
    description: data.description,
    themeColor: data.themeColor,
    imageKey: data.imageKey,
    imageWidth: data.imageWidth,
    imageHeight: data.imageHeight,
  };
  const ownImage = keptOld ? null : fetched.imageKey;
  let outcome: { stored: PreviewData; replaced: string | null };
  try {
    outcome = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`enbox:link-preview:${url.href}`}, 0))`,
      );
      const [current] = await tx
        .select()
        .from(linkPreviews)
        .where(eq(linkPreviews.url, url.href))
        .for('update');
      // Another process refreshed the link while this one was fetching: keep its result.
      if (current && isFresh(current)) return { stored: current, replaced: null };
      // Falling back to the old preview whose row (and image) the GC has removed meanwhile.
      const stored = keptOld && current?.imageKey !== fetched.imageKey ? NO_PREVIEW : fetched;
      await tx
        .insert(linkPreviews)
        .values({ url: url.href, ...stored, fetchedAt })
        .onConflictDoUpdate({ target: linkPreviews.url, set: { ...stored, fetchedAt } });
      return { stored, replaced: current?.imageKey ?? null };
    });
  } catch (err) {
    await removeStoredFiles([ownImage]);
    throw err;
  }
  const { stored, replaced } = outcome;
  await removeStoredFiles([
    ownImage !== stored.imageKey ? ownImage : null,
    replaced !== stored.imageKey ? replaced : null,
  ]);
  return toLinkPreview(url.href, stored);
}

const inflight = new Map<string, Promise<LinkPreview | null>>();

/** The preview of a link (cached; fetched when missing or stale), or null when it has none. */
export async function getLinkPreview(raw: string): Promise<LinkPreview | null> {
  const url = normalizeLink(raw);
  if (!url) return null;
  const key = url.href;
  const [row] = await db.select().from(linkPreviews).where(eq(linkPreviews.url, key));
  if (row && isFresh(row)) return toLinkPreview(key, row);
  let pending = inflight.get(key);
  if (!pending) {
    pending = refresh(url, row ?? null).finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}
