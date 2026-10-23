import type { RouteObject } from 'react-router';
import { lazyNamed } from '@/lib/lazy';

const SpacePreviewPage = lazyNamed(() => import('./SpacePreviewPage'), 'SpacePreviewPage');

/** /preview/:spaceId: a discoverable Space's public channels, before joining. */
export const previewRoutes: RouteObject[] = [
  { path: 'preview/:spaceId', element: <SpacePreviewPage /> },
];
