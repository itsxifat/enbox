/**
 * Service worker registration. Registered in production builds; in `vite dev` only when
 * `VITE_ENABLE_SW=true`. Clicking a push notification posts `{ type: 'navigate', url }`
 * to the page, which is forwarded to the router via the `navigate` bus event.
 */
import { bus } from './bus';

let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function serviceWorkerEnabled(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    (import.meta.env.PROD || import.meta.env.VITE_ENABLE_SW === 'true')
  );
}

export function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (registration) return registration;
  if (!serviceWorkerEnabled()) return (registration = Promise.resolve(null));

  navigator.serviceWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
    const data = event.data as { type?: string; url?: string } | null;
    if (data?.type === 'navigate' && typeof data.url === 'string' && data.url.startsWith('/')) {
      bus.emit('navigate', { to: data.url });
    }
  });

  registration = new Promise((resolve) => {
    const run = () =>
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then(resolve)
        .catch((e: unknown) => {
          console.warn('[sw] registration failed', e);
          resolve(null);
        });
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run, { once: true });
  });
  return registration;
}

/** The active registration, if the service worker is enabled and registered. */
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration | null> {
  if (!serviceWorkerEnabled()) return null;
  await registerServiceWorker();
  try {
    return (await navigator.serviceWorker.getRegistration()) ?? null;
  } catch {
    return null;
  }
}
