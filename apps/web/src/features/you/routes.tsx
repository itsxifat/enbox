/**
 * The phone shell's own pages (bottom tabs Notifications and You):
 *
 *   /you            the You tab: my profile card, Friends, Collectibles, Updates, Calls,
 *                   Settings (desktop → /chats)
 *   /you/friends    the Friends page full screen (desktop → /chats, Home's main view)
 *   /notifications  the Inbox full screen (Mentions / Unreads)
 */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { lazyNamed } from '@/lib/lazy';

const YouPage = lazyNamed(() => import('./YouPage'), 'YouPage');
const PhoneFriendsPage = lazyNamed(() => import('./FriendsScreen'), 'PhoneFriendsPage');
const InboxPage = lazyNamed(() => import('./InboxPage'), 'InboxPage');

export const youRoutes: RouteObject[] = [
  { path: 'you', element: <YouPage /> },
  {
    path: 'you/friends',
    element: <PhoneFriendsPage />,
    handle: { detail: true } satisfies RouteHandle,
  },
  { path: 'notifications', element: <InboxPage /> },
];
