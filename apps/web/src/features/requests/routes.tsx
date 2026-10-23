import type { RouteObject } from 'react-router';
import { lazyNamed } from '@/lib/lazy';

const MessageRequestsPage = lazyNamed(() => import('./MessageRequestsPage'), 'MessageRequestsPage');

/** /message-requests (Home): pending DMs from people who aren't my friends. */
export const requestsRoutes: RouteObject[] = [
  { path: 'message-requests', element: <MessageRequestsPage /> },
];
