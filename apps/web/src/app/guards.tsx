import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { Splash } from '@/components/layout/Splash';
import { useAuth } from '@/stores/auth';

/**
 * Only allow same-app paths as post-login redirects (no open redirects). Parsed, not
 * prefix-matched: the URL parser drops TAB/CR/LF and reads a backslash as `/`, so
 * `/<TAB>/evil.example` would resolve to another origin. Returns the normalized path + query + hash.
 */
export function safeNext(next: string | null | undefined, fallback = '/chats'): string {
  // Control characters (incl. TAB/CR/LF) and backslashes never appear in our own paths.
  // eslint-disable-next-line no-control-regex
  if (!next || !next.startsWith('/') || /[\u0000-\u001f\u007f\\]/.test(next)) return fallback;
  let url: URL;
  try {
    url = new URL(next, window.location.href);
  } catch {
    return fallback;
  }
  if (url.origin !== window.location.origin) return fallback;
  if (/^\/(login|register)(\/|$)/.test(url.pathname)) return fallback;
  return url.pathname + url.search + url.hash;
}

/** Authenticated area: splash while booting, redirect to /login?next=… when anonymous. */
export function RequireAuth() {
  const status = useAuth((s) => s.status);
  const bootError = useAuth((s) => s.bootError);
  const location = useLocation();
  if (status === 'booting') return <Splash message={bootError} />;
  if (status === 'anonymous') {
    const here = location.pathname + location.search;
    const next = here === '/' || here === '/chats' ? '' : `?next=${encodeURIComponent(here)}`;
    return <Navigate to={`/login${next}`} replace />;
  }
  return <Outlet />;
}

/** Login/register: bounce authenticated users to `next` (or /chats). */
export function PublicOnly() {
  const status = useAuth((s) => s.status);
  const [params] = useSearchParams();
  if (status === 'booting') return <Splash />;
  if (status === 'authenticated') return <Navigate to={safeNext(params.get('next'))} replace />;
  return <Outlet />;
}
