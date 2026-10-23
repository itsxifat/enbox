/**
 * Link embeds of messages: which links a text gets embeds for, and a session cache of
 * `GET /api/link-preview` results (the server fetches the page and caches it for everyone).
 *
 *   const urls = embedLinks(m.text);         // ≤ MAX_EMBEDS_PER_MESSAGE links, in order
 *   const preview = useLinkPreview(url);     // undefined while loading, null when there is none
 *
 * What each link becomes (a page card, an inline image, a player, a message or invite card)
 * is decided by bubbles/LinkPreviewCard.tsx.
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { ApiResponse } from '@/lib/api';
import { api } from '@/lib/api';
import type { LinkPreview } from '@enbox/shared';
import { linkify } from './richText';

/** Links of one message that get an embed (Discord shows a few; the rest stay plain links). */
export const MAX_EMBEDS_PER_MESSAGE = 3;
/** A failed lookup (offline, rate limited) is asked again after this long. */
const RETRY_AFTER_MS = 30_000;
const MAX_CACHED = 500;

const cache = new Map<string, LinkPreview | null>();
const failedAt = new Map<string, number>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/**
 * The links of a text that get embeds, in order without repeats, at most
 * MAX_EMBEDS_PER_MESSAGE: http(s) links — bare, `www.` or masked — outside code and spoilers,
 * and not wrapped in `<…>` (Discord's "no embed" syntax, also `[text](<url>)`).
 */
export function embedLinks(text: string | null | undefined): string[] {
  if (!text) return [];
  const visible = text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/``[^\n]*?``|`[^`\n]*`/g, ' ')
    .replace(/\|\|[\s\S]*?\|\|/g, ' ')
    .replace(/<https?:\/\/[^\s>]+>/gi, ' ');
  const out: string[] = [];
  for (const s of linkify(visible)) {
    if (s.t !== 'link' || s.href.startsWith('mailto:') || out.includes(s.href)) continue;
    out.push(s.href);
    if (out.length === MAX_EMBEDS_PER_MESSAGE) break;
  }
  return out;
}

function notify(): void {
  for (const fn of listeners) fn();
}

function load(url: string): void {
  if (cache.has(url) || pending.has(url)) return;
  const failed = failedAt.get(url);
  if (failed !== undefined && Date.now() - failed < RETRY_AFTER_MS) return;
  const p = api
    .get<ApiResponse<'GET /api/link-preview'>>('/api/link-preview', { query: { url } })
    .then(
      (r) => {
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
        cache.set(url, r.preview);
        failedAt.delete(url);
        notify();
      },
      // Offline / rate limited: nothing cached (shown as "no preview" for now), asked again
      // by a later mount.
      () => {
        failedAt.set(url, Date.now());
        notify();
      },
    )
    .finally(() => pending.delete(url));
  pending.set(url, p);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function snapshot(url: string | null): LinkPreview | null | undefined {
  if (!url) return null;
  const hit = cache.get(url);
  if (hit !== undefined) return hit;
  return failedAt.has(url) && !pending.has(url) ? null : undefined;
}

/** The preview of `url`: undefined while unknown, null when the link has none (or failed). */
export function useLinkPreview(url: string | null): LinkPreview | null | undefined {
  const value = useSyncExternalStore(subscribe, () => snapshot(url));
  useEffect(() => {
    if (url) load(url);
  }, [url]);
  return value;
}

/** Tests: forget every cached preview. */
export function resetLinkPreviewCache(): void {
  cache.clear();
  failedAt.clear();
  pending.clear();
}
