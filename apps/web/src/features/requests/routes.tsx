import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { FullView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const MessageRequestsPage = lazyNamed(() => import('./MessageRequestsPage'), 'MessageRequestsPage');

/**
 * /message-requests (Home): pending DMs from people who aren't my friends. A Home section on
 * desktop (the DM sidebar has a Message Requests row); full screen on phones, with a back arrow.
 */
export const requestsRoutes: RouteObject[] = [
  {
    path: 'message-requests',
    element: (
      <FullView>
        <MessageRequestsPage />
      </FullView>
    ),
    handle: { detail: true } satisfies RouteHandle,
  },
];
