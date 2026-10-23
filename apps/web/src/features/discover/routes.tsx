/** /discover — Space discovery (the rail's compass). Phones: full screen. */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { FullView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const DiscoverPage = lazyNamed(() => import('./DiscoverPage'), 'DiscoverPage');

const detail: RouteHandle = { detail: true };

export const discoverRoutes: RouteObject[] = [
  {
    path: 'discover',
    handle: detail,
    element: (
      <FullView>
        <DiscoverPage />
      </FullView>
    ),
  },
];
