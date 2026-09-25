/**
 * Runtime environment. `API_ORIGIN` is '' for same-origin (web, dev proxy) or an absolute
 * origin such as `https://api.enbox.app` (Capacitor / split deployments, via VITE_API_URL).
 */
function normalizeOrigin(value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '';
  try {
    return new URL(v).origin;
  } catch {
    console.warn('[enbox] Ignoring invalid VITE_API_URL:', v);
    return '';
  }
}

export const API_ORIGIN: string = normalizeOrigin(import.meta.env.VITE_API_URL);

/** Origin passed to socket.io: undefined = connect to the page's own origin. */
export const SOCKET_ORIGIN: string | undefined = API_ORIGIN || undefined;

export const IS_PROD = import.meta.env.PROD;
