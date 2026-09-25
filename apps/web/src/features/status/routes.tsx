/**
 * Status routes — OWNED BY FEATURE AGENT 4. Children of /updates; both screens are
 * full-screen overlays (portals) over the Updates tab.
 *   /updates/status/new        composer (text; photo/video via `state.file` or the picker)
 *   /updates/status/mine       my statuses with view counts (a regular pane)
 *   /updates/status/:userId    viewer (my own id → my statuses with viewers; `state.startId`)
 */
import type { RouteObject } from 'react-router';
import { lazyNamed } from '@/lib/lazy';

const StatusComposer = lazyNamed(() => import('./StatusComposer'), 'StatusComposer');
const StatusViewer = lazyNamed(() => import('./StatusViewer'), 'StatusViewer');
const MyStatusPane = lazyNamed(() => import('./MyStatusPane'), 'MyStatusPane');

export const statusRoutes: RouteObject[] = [
  { path: 'status/new', element: <StatusComposer />, handle: { detail: true } },
  { path: 'status/mine', element: <MyStatusPane />, handle: { detail: true } },
  { path: 'status/:userId', element: <StatusViewer />, handle: { detail: true } },
];
