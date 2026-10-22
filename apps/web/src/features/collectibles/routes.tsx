/**
 * /collectibles — the free cosmetics gallery. A Home section on desktop (the DM sidebar has a
 * Collectibles row); full screen on phones (opened from Settings → Profiles), with a back arrow.
 */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { FullView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const CollectiblesPage = lazyNamed(() => import('./CollectiblesPage'), 'CollectiblesPage');

export const collectiblesRoutes: RouteObject[] = [
  {
    path: 'collectibles',
    element: (
      <FullView>
        <CollectiblesPage />
      </FullView>
    ),
    handle: { detail: true } satisfies RouteHandle,
  },
];
