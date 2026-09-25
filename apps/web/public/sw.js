/* Enbox service worker: Web Push notifications + a minimal offline app shell.
 *
 * Caching rules (deliberately conservative):
 * - Navigations: network-first; the latest successful HTML response is kept as the app
 *   shell and served when offline.
 * - Hashed build assets (/assets/*): cache-first (file names change on every build).
 * - Never cached: /api, /socket.io, /uploads, non-GET requests, cross-origin requests.
 *
 * Bump SHELL_CACHE when the caching strategy changes; old caches are purged on activate.
 */
const SHELL_CACHE = 'enbox-shell-v1';
const ASSET_CACHE = 'enbox-assets-v1';
const SHELL_URL = '/index.html';
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then(async (cache) => {
        await Promise.all(
          PRECACHE.map((url) =>
            fetch(url, { cache: 'no-cache' })
              .then((res) => (res.ok ? cache.put(url === '/' ? SHELL_URL : url, res) : undefined))
              .catch(() => undefined),
          ),
        );
      })
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isBypassed(url) {
  return (
    url.origin !== self.location.origin ||
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    url.pathname.startsWith('/uploads/') ||
    // Vite dev server internals (when the SW is opted in during development)
    url.pathname.startsWith('/@') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (isBypassed(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok && (res.headers.get('content-type') || '').includes('text/html')) {
            const copy = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(SHELL_URL, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(SHELL_URL);
          return (
            cached ||
            new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } })
          );
        }),
    );
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ||
          fetch(request).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(request, copy));
            }
            return res;
          }),
      ),
    );
  }
});

// ---------------------------------------------------------------------------
// Web Push
// payload JSON: { title, body, tag, url, icon }
// ---------------------------------------------------------------------------

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'Enbox';
  const options = {
    body: data.body || '',
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    icon: data.icon || '/icons/icon-192.png',
    badge: '/icons/icon-192.png',
    data: { url: data.url || '/chats' },
  };
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      // The open, focused app shows its own in-app notification; don't double up.
      const focused = clients.some((c) => c.focused && c.visibilityState === 'visible');
      if (focused) return undefined;
      return self.registration.showNotification(title, options);
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(
    (event.notification.data && event.notification.data.url) || '/chats',
    self.location.origin,
  );
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
      const client = clients.find((c) => new URL(c.url).origin === target.origin);
      if (client) {
        await client.focus();
        // The app routes client-side (see src/lib/sw.ts) — no full reload.
        client.postMessage({
          type: 'navigate',
          url: target.pathname + target.search + target.hash,
        });
        return;
      }
      await self.clients.openWindow(target.href);
    }),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'skip-waiting') self.skipWaiting();
});
