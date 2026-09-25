/**
 * Auth routes — OWNED BY FEATURE AGENT 1 (auth / settings / contacts / profile).
 * Rendered inside <PublicOnly/>: authenticated users are redirected to `?next=` or /chats.
 *
 * Lazy: the pages pull in zod and the shared form schemas, which a logged-in cold start
 * doesn't need (RootLayout provides the Suspense boundary).
 */
import type { RouteObject } from 'react-router';
import { lazyNamed } from '@/lib/lazy';

const LoginPage = lazyNamed(() => import('./LoginPage'), 'LoginPage');
const RegisterPage = lazyNamed(() => import('./RegisterPage'), 'RegisterPage');

export const authRoutes: RouteObject[] = [
  { path: 'login', element: <LoginPage /> },
  { path: 'register', element: <RegisterPage /> },
];
