/**
 * Link previews of messages: which link a text gets a card for, and a session cache of
 * `GET /api/link-preview` results (the server fetches the page and caches it for everyone).
 *
 *   const url = previewLink(m.text);         // first web link that is not one of ours, or null
 *   const preview = useLinkPreview(url);     // undefined while loading, null when there is none
 */
import { useEffect, useSyncExternalStore } from 'react';
import type { ApiResponse } from '@/lib/api';
import { api } from '@/lib/api';
import { publicOrigin } from '@/lib/serverConfig';
import type { LinkPreview } from '@enbox/shared';
import { firstUrl } from './richText';

const MAX_CACHED = 500;
const cache = new Map<string, LinkPreview | null>();
const pending = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/**
 * The link a text is previewed with: its first http(s) link, unless it points at this app
 * (invites, profiles — they would only preview as "Enbox").
 */
export function previewLink(text: string | null | undefined): string | null {
  const url = firstUrl(text);
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    const own = new Set([
      publicOrigin(),
      typeof window !== 'undefined' ? window.location.origin : '',
    ]);
    return own.has(origin) ? null : url;
  } catch {
    return null;
  }
}

function load(url: string): void {
  if (cache.has(url) || pending.has(url)) return;
  const p = api
    .get<ApiResponse<'GET /api/link-preview'>>('/api/link-preview', { query: { url } })
    .then(
      (r) => {
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value!);
        cache.set(url, r.preview);
        for (const fn of listeners) fn();
      },
      // Offline / rate limited: nothing cached, the next mount asks again.
      () => undefined,
    )
    .finally(() => pending.delete(url));
  pending.set(url, p);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The preview of `url`: undefined while unknown, null when the link has none. */
export function useLinkPreview(url: string | null): LinkPreview | null | undefined {
  const value = useSyncExternalStore(subscribe, () => (url ? cache.get(url) : null));
  useEffect(() => {
    if (url) load(url);
  }, [url]);
  return value;
}
