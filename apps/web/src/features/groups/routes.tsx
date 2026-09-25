/** Groups routes — OWNED BY FEATURE AGENT 3. */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { SplitView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const NewGroupPane = lazyNamed(() => import('./NewGroupPane'), 'NewGroupPane');

const hideTabs: RouteHandle = { hideTabs: true };

export const groupsRoutes: RouteObject[] = [
  { path: 'new/group', element: <SplitView list={<NewGroupPane />} />, handle: hideTabs },
];
