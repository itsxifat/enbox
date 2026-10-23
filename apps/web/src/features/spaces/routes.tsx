import { Navigate, type RouteObject } from 'react-router';
import { lazyNamed } from '@/lib/lazy';
import { SpacesView } from './SpacesView';

const SpaceChannelPane = lazyNamed(() => import('./SpaceChannelPane'), 'SpaceChannelPane');
const SpaceHome = lazyNamed(() => import('./SpaceChannelPane'), 'SpaceHome');
const SpaceSettings = lazyNamed(() => import('./settings/SpaceSettings'), 'SpaceSettings');
const ServerGuidePage = lazyNamed(
  () => import('@/features/guide/ServerGuidePage'),
  'ServerGuidePage',
);
const BrowseChannelsPage = lazyNamed(
  () => import('@/features/guide/BrowseChannelsPage'),
  'BrowseChannelsPage',
);
const ChannelsRolesPage = lazyNamed(
  () => import('@/features/guide/ChannelsRolesPage'),
  'ChannelsRolesPage',
);

/**
 *   /spaces                              rail (+ last Space on desktop)
 *   /spaces/:spaceId                     channel sidebar (desktop: opens the last channel)
 *   /spaces/:spaceId/:chatId             a channel (phone: full screen)
 *   /spaces/:spaceId/settings/:section?  Space settings (full screen overlay)
 *   /communities/*                       → /spaces (communities became Spaces)
 */
export const spacesRoutes: RouteObject[] = [
  { path: 'communities/*', element: <Navigate to="/spaces" replace /> },
  {
    path: 'spaces/:spaceId/settings/:section?',
    element: <SpaceSettings />,
    handle: { detail: true, hideTabs: true },
  },
  {
    path: 'spaces',
    element: <SpacesView />,
    children: [
      { path: ':spaceId', element: <SpaceHome /> },
      { path: ':spaceId/guide', element: <ServerGuidePage />, handle: { detail: true } },
      { path: ':spaceId/browse', element: <BrowseChannelsPage />, handle: { detail: true } },
      { path: ':spaceId/channels-roles', element: <ChannelsRolesPage />, handle: { detail: true } },
      { path: ':spaceId/:chatId', element: <SpaceChannelPane />, handle: { detail: true } },
    ],
  },
];
