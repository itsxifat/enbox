import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { lazyNamed } from '@/lib/lazy';

const SpacePreviewPage = lazyNamed(() => import('./SpacePreviewPage'), 'SpacePreviewPage');

/** Phones: full screen (no bottom tabs), like Discover. */
const detail: RouteHandle = { detail: true };

/** /preview/:spaceId: a discoverable Space's public channels, before joining (its own cards). */
export const previewRoutes: RouteObject[] = [
  { path: 'preview/:spaceId', handle: detail, element: <SpacePreviewPage /> },
];
