/**
 * Contacts routes — OWNED BY FEATURE AGENT 1. `/new` replaces the list pane (phone: full
 * screen without bottom tabs).
 */
import type { RouteObject } from 'react-router';
import type { RouteHandle } from '@/app/routeHandle';
import { SplitView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const NewChatPane = lazyNamed(() => import('./NewChatPane'), 'NewChatPane');

const hideTabs: RouteHandle = { hideTabs: true };

export const contactsRoutes: RouteObject[] = [
  { path: 'new', element: <SplitView list={<NewChatPane />} />, handle: hideTabs },
];
