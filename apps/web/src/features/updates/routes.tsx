/**
 * Updates routes (foundation-owned). Children come from features/channels/routes.tsx
 * (agent 3) and features/status/routes.tsx (agent 4).
 */
import type { RouteObject } from 'react-router';
import { CircleDashed } from 'lucide-react';
import { MainEmpty } from '@/components/layout/MainEmpty';
import { SplitView } from '@/components/layout/SplitView';
import { channelRoutes } from '@/features/channels/routes';
import { statusRoutes } from '@/features/status/routes';
import { lazyNamed } from '@/lib/lazy';

const UpdatesPane = lazyNamed(() => import('./UpdatesPane'), 'UpdatesPane');

export const updatesRoutes: RouteObject[] = [
  {
    path: 'updates',
    element: (
      <SplitView
        list={<UpdatesPane />}
        empty={
          <MainEmpty
            icon={CircleDashed}
            title="Status & channels"
            description="Share photos, videos and text that disappear after 24 hours, and follow channels about the things you care about."
          />
        }
      />
    ),
    children: [...channelRoutes, ...statusRoutes],
  },
];
