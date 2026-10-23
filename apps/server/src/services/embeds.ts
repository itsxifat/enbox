/**
 * Rich embeds of webhook messages (docs/design/discord-parity.md W10-E): Discord's snake_case
 * input (`embedInputSchema`, which checks every field against EMBED_LIMITS) → the stored
 * camelCase `MessageEmbed`. Checked here: an embed shows something, and all text of all
 * embeds of a message stays within EMBED_LIMITS.total (Discord counts titles, descriptions,
 * field names and values, footers and author names).
 *
 * Every third-party image — author and footer icons, the thumbnail, the image, a webhook
 * message's `avatar_url` — is copied into our uploads through the SSRF-guarded fetcher
 * (`cacheRemoteImage`), so clients never load another host (the CSP forbids it). An image
 * that can't be copied (unreachable, not a static picture) is left out; the rest of its
 * embed stays, and an embed left with nothing to show is dropped. Copies are remembered per
 * URL for IMAGE_MEMO_TTL_MS, so a webhook posting the same icons every minute neither
 * refetches nor stores them again; a URL that failed is retried after FAILED_MEMO_TTL_MS.
 */
import {
  EMBED_LIMITS,
  type EmbedField,
  type MessageEmbed,
  type embedInputSchema,
} from '@enbox/shared';
import type { z } from 'zod';
import { badRequest } from '../lib/errors.js';
import { storableDate } from '../lib/validate.js';
import { cacheRemoteImage } from './linkPreviews.js';
import { uniq } from './sql.js';

export type EmbedBody = z.output<typeof embedInputSchema>;

/** A stored copy is reused for this long (copies are never deleted, so the URL stays good). */
const IMAGE_MEMO_TTL_MS = 6 * 60 * 60_000;
/** An image that could not be copied is not tried again before this. */
const FAILED_MEMO_TTL_MS = 60_000;
const IMAGE_MEMO_MAX = 2_000;

const memo = new Map<string, { url: string | null; at: number }>();
const inflight = new Map<string, Promise<string | null>>();

function remember(src: string, url: string | null): void {
  if (memo.size >= IMAGE_MEMO_MAX) {
    const oldest = memo.keys().next().value;
    if (oldest !== undefined) memo.delete(oldest);
  }
  memo.delete(src);
  memo.set(src, { url, at: Date.now() });
}

/**
 * Our copy of a remote https image (`/uploads/…`), or null when it can't be had. Any size
 * goes (icons are small); animated pictures are refused like link preview images.
 */
export function cacheExternalImage(src: string): Promise<string | null> {
  const hit = memo.get(src);
  if (hit && Date.now() - hit.at < (hit.url ? IMAGE_MEMO_TTL_MS : FAILED_MEMO_TTL_MS))
    return Promise.resolve(hit.url);
  let pending = inflight.get(src);
  if (!pending) {
    pending = cacheRemoteImage(src, { minSide: 1 })
      .catch(() => null)
      .then((url) => {
        remember(src, url);
        return url;
      })
      .finally(() => inflight.delete(src));
    inflight.set(src, pending);
  }
  return pending;
}

/** Tests: forget the remembered copies. */
export function clearEmbedImageMemo(): void {
  memo.clear();
}

/** The text of an embed that counts toward EMBED_LIMITS.total. */
export function embedTextLength(e: EmbedBody): number {
  let n = (e.title?.length ?? 0) + (e.description?.length ?? 0);
  n += (e.footer?.text.length ?? 0) + (e.author?.name.length ?? 0);
  for (const f of e.fields ?? []) n += f.name.length + f.value.length;
  return n;
}

const blank = (s: string | undefined): boolean => !s || !s.trim();

/** Something to show besides the colour bar (a link alone shows nothing). */
function showsSomething(e: EmbedBody | MessageEmbed): boolean {
  return (
    !!e.title?.trim() ||
    !!e.description?.trim() ||
    !!e.fields?.length ||
    !!e.author ||
    !!e.footer ||
    !!e.image ||
    !!e.thumbnail ||
    !!e.timestamp
  );
}

/**
 * 400s an input embed list can be refused with before anything is fetched: a blank field
 * name or value, a URL that doesn't parse, an embed with nothing in it, too much text.
 */
export function assertEmbedInput(embeds: readonly EmbedBody[], path = 'embeds'): void {
  let total = 0;
  embeds.forEach((e, i) => {
    const at = `${path}.${i}`;
    if (!showsSomething(e))
      throw badRequest(
        `${at}: An embed needs a title, description, fields, author, footer or image`,
      );
    e.fields?.forEach((f, j) => {
      if (blank(f.name)) throw badRequest(`${at}.fields.${j}.name: Field names can't be blank`);
      if (blank(f.value)) throw badRequest(`${at}.fields.${j}.value: Field values can't be blank`);
    });
    const urls: [string, string | undefined][] = [
      ['url', e.url],
      ['author.url', e.author?.url],
      ['author.icon_url', e.author?.icon_url],
      ['footer.icon_url', e.footer?.icon_url],
      ['image.url', e.image?.url],
      ['thumbnail.url', e.thumbnail?.url],
    ];
    for (const [key, url] of urls)
      if (url !== undefined && !URL.canParse(url))
        throw badRequest(`${at}.${key}: Not a valid URL`);
    if (e.timestamp) storableDate(e.timestamp, `${at}.timestamp`);
    total += embedTextLength(e);
  });
  if (total > EMBED_LIMITS.total)
    throw badRequest(
      `${path}: The embeds of a message can hold at most ${EMBED_LIMITS.total} characters of text`,
    );
}

/** The image URLs of input embeds (distinct, in order). */
function imageUrlsOf(embeds: readonly EmbedBody[]): string[] {
  return uniq(
    embeds.flatMap((e) =>
      [e.author?.icon_url, e.footer?.icon_url, e.thumbnail?.url, e.image?.url].filter(
        (u): u is string => !!u,
      ),
    ),
  );
}

/** One input embed as stored, with our copies of its images (`copies`: source → copy). */
function toMessageEmbed(e: EmbedBody, copies: ReadonlyMap<string, string | null>): MessageEmbed {
  const copy = (src: string | undefined) => (src ? (copies.get(src) ?? null) : null);
  const out: MessageEmbed = {};
  if (!blank(e.title)) out.title = e.title!;
  if (!blank(e.description)) out.description = e.description!;
  if (e.url) out.url = e.url;
  if (e.color !== undefined) out.color = e.color;
  if (e.timestamp) out.timestamp = storableDate(e.timestamp, 'timestamp').toISOString();
  if (e.author) {
    const iconUrl = copy(e.author.icon_url);
    out.author = {
      name: e.author.name,
      ...(e.author.url ? { url: e.author.url } : {}),
      ...(iconUrl ? { iconUrl } : {}),
    };
  }
  if (e.footer) {
    const iconUrl = copy(e.footer.icon_url);
    out.footer = { text: e.footer.text, ...(iconUrl ? { iconUrl } : {}) };
  }
  const thumbnail = copy(e.thumbnail?.url);
  if (thumbnail) out.thumbnail = { url: thumbnail };
  const image = copy(e.image?.url);
  if (image) out.image = { url: image };
  if (e.fields?.length)
    out.fields = e.fields.map((f): EmbedField => ({
      name: f.name,
      value: f.value,
      ...(f.inline ? { inline: true } : {}),
    }));
  return out;
}

/**
 * Input embeds → stored embeds: validated (`assertEmbedInput`), images copied (in parallel,
 * each distinct URL once), embeds left empty by failed images dropped.
 */
export async function prepareEmbeds(
  embeds: readonly EmbedBody[],
  path = 'embeds',
): Promise<MessageEmbed[]> {
  if (embeds.length === 0) return [];
  assertEmbedInput(embeds, path);
  const urls = imageUrlsOf(embeds);
  const copies = new Map(
    await Promise.all(urls.map(async (u) => [u, await cacheExternalImage(u)] as const)),
  );
  return embeds.map((e) => toMessageEmbed(e, copies)).filter(showsSomething);
}
