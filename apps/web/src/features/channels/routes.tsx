/**
 * Channel routes — OWNED BY FEATURE AGENT 3. Mounted as children of /updates (main pane):
 * /updates/channels/discover, /updates/channels/new, /updates/channels/:chatId.
 */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { lazyNamed } from '@/lib/lazy';

const ChannelPane = lazyNamed(() => import('./ChannelPane'), 'ChannelPane');
const ChannelDiscoverPane = lazyNamed(() => import('./ChannelDiscoverPane'), 'ChannelDiscoverPane');
const NewChannelPane = lazyNamed(() => import('./NewChannelPane'), 'NewChannelPane');

const detail: RouteHandle = { detail: true };

export const channelRoutes: RouteObject[] = [
  { path: 'channels/discover', element: <ChannelDiscoverPane />, handle: detail },
  { path: 'channels/new', element: <NewChannelPane />, handle: detail },
  { path: 'channels/:chatId', element: <ChannelPane />, handle: detail },
];
