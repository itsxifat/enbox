import { Navigate, Outlet, useLocation, useSearchParams } from 'react-router';
import { Splash } from '@/components/layout/Splash';
import { useAuth } from '@/stores/auth';

/** Only allow same-app relative paths as post-login redirects (no open redirects). */
export function safeNext(next: string | null | undefined, fallback = '/chats'): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.startsWith('/\\'))
    return fallback;
  if (next.startsWith('/login') || next.startsWith('/register')) return fallback;
  return next;
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
