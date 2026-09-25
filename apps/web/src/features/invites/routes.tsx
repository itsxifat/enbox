/** Invite routes — OWNED BY FEATURE AGENT 3. Anonymous visitors are sent to /login?next=/join/:code first. */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { FullView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const JoinInvitePage = lazyNamed(() => import('./JoinInvitePage'), 'JoinInvitePage');

const detail: RouteHandle = { detail: true };

export const invitesRoutes: RouteObject[] = [
  {
    path: 'join/:code',
    handle: detail,
    element: (
      <FullView>
        <JoinInvitePage />
      </FullView>
    ),
  },
];
