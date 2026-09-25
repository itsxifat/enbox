/** Communities routes — OWNED BY FEATURE AGENT 3. */
import type { RouteObject } from 'react-router';
import { UsersRound } from 'lucide-react';
import type { RouteHandle } from '@/app/routeHandle';
import { MainEmpty } from '@/components/layout/MainEmpty';
import { SplitView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const CommunitiesPane = lazyNamed(() => import('./CommunitiesPane'), 'CommunitiesPane');
const CommunityPane = lazyNamed(() => import('./CommunityPane'), 'CommunityPane');
const NewCommunityPane = lazyNamed(() => import('./NewCommunityPane'), 'NewCommunityPane');

const detail: RouteHandle = { detail: true };

export const communitiesRoutes: RouteObject[] = [
  {
    path: 'communities',
    element: (
      <SplitView
        list={<CommunitiesPane />}
        empty={
          <MainEmpty
            icon={UsersRound}
            title="Communities"
            description="Bring related groups together under one community, with announcements that reach every member."
          />
        }
      />
    ),
    children: [
      { path: 'new', element: <NewCommunityPane />, handle: detail },
      { path: ':communityId', element: <CommunityPane />, handle: detail },
    ],
  },
];
