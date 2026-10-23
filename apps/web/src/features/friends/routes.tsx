/** Friend invite links: /friend/:code. Anonymous visitors log in first (/login?next=…). */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { FullView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const FriendInvitePage = lazyNamed(() => import('./FriendInvitePage'), 'FriendInvitePage');

const detail: RouteHandle = { detail: true };

export const friendsRoutes: RouteObject[] = [
  {
    path: 'friend/:code',
    handle: detail,
    element: (
      <FullView>
        <FriendInvitePage />
      </FullView>
    ),
  },
];
