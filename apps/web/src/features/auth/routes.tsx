/**
 * Auth routes — OWNED BY FEATURE AGENT 1 (auth / settings / contacts / profile).
 * Rendered inside <PublicOnly/>: authenticated users are redirected to `?next=` or /chats.
 */
import type { RouteObject } from 'react-router';
import { LoginPage } from './LoginPage';
import { RegisterPage } from './RegisterPage';

export const authRoutes: RouteObject[] = [
  { path: 'login', element: <LoginPage /> },
  { path: 'register', element: <RegisterPage /> },
];
