/**
 * Link previews of messages (web lib/linkPreview.ts): which link a text gets a card for,
 * and a session cache of `GET /api/link-preview` results (the server fetches the page and
 * caches it for everyone).
 *
 *   const url = previewLink(m.text);         // first web link that is not one of ours, or null
 *   const preview = useLinkPreview(url);     // undefined while loading, null when there is none
 */
import { useEffect, useSyncExternalStore } from 'react';
import { api } from '@/lib/api';
import { getApiOrigin } from '@/lib/env';
import { publicOrigin } from '@/lib/serverConfig';
import { firstUrl } from './richText';

const MAX_CACHED = 500;
const cache = new Map();
const pending = new Map();
const listeners = new Set();

function originOf(url) {
  try {
    return url ? new URL(url).origin : null;
  } catch {
    return null;
  }
}

/**
 * The link a text is previewed with: its first http(s) link, unless it points at this
 * server (invites, profiles: they open in the app and would only preview as "Enbox").
 */
export function previewLink(text) {
  const url = firstUrl(text);
  const origin = originOf(url);
  if (!origin) return null;
  const own = [originOf(publicOrigin()), originOf(getApiOrigin())];
  return own.includes(origin) ? null : url;
}

function load(url) {
  if (cache.has(url) || pending.has(url)) return;
  const p = api
    .get('/api/link-preview', { query: { url } })
    .then(
      (r) => {
        if (cache.size >= MAX_CACHED) cache.delete(cache.keys().next().value);
        cache.set(url, r.preview);
        for (const fn of listeners) fn();
      },
      // Offline / rate limited: nothing cached, the next mount asks again.
      () => undefined,
    )
    .finally(() => pending.delete(url));
  pending.set(url, p);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The preview of `url`: undefined while unknown, null when the link has none. */
export function useLinkPreview(url) {
  const value = useSyncExternalStore(subscribe, () => (url ? cache.get(url) : null));
  useEffect(() => {
    if (url) load(url);
  }, [url]);
  return value;
}
