/**
 * Profile routes:
 *
 *   /users/:userId    the full profile as a page (same view as /u/:username)
 */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { FullView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const UserProfilePage = lazyNamed(
  () => import('@/features/contacts/UserProfilePage'),
  'UserProfilePage',
);

const detail: RouteHandle = { detail: true };

export const profileRoutes: RouteObject[] = [
  {
    path: 'users/:userId',
    element: (
      <FullView>
        <UserProfilePage />
      </FullView>
    ),
    handle: detail,
  },
];
