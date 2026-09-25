/**
 * Channel routes — OWNED BY FEATURE AGENT 3. Mounted as children of /updates (main pane),
 * e.g. /updates/channels/:chatId. Add discovery etc. here.
 */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { lazyNamed } from '@/lib/lazy';

const ChannelPane = lazyNamed(() => import('./ChannelPane'), 'ChannelPane');

const detail: RouteHandle = { detail: true };

export const channelRoutes: RouteObject[] = [
  { path: 'channels/:chatId', element: <ChannelPane />, handle: detail },
];
