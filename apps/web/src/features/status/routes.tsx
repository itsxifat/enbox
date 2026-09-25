/**
 * Status routes — OWNED BY FEATURE AGENT 4. Mounted as children of /updates (main pane),
 * e.g. add `{ path: 'status/:userId', element: <StatusViewer />, handle: { detail: true } }`.
 * (A full-screen viewer can also be a portal overlay opened from StatusSection.)
 */
import type { RouteObject } from 'react-router';

export const statusRoutes: RouteObject[] = [];
