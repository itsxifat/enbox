/** Calls routes — OWNED BY FEATURE AGENT 4. */
import type { RouteObject } from 'react-router';
import { CallsIcon } from '@/components/icons';
import { MainEmpty } from '@/components/layout/MainEmpty';
import { SplitView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const CallsPane = lazyNamed(() => import('./CallsPane'), 'CallsPane');
const CallDetails = lazyNamed(() => import('./CallDetails'), 'CallDetails');
const NewCallPane = lazyNamed(() => import('./NewCallPane'), 'NewCallPane');

export const callsRoutes: RouteObject[] = [
  {
    path: 'calls',
    element: (
      <SplitView
        list={<CallsPane />}
        empty={
          <MainEmpty
            icon={CallsIcon}
            title="Calls"
            description="Make voice and video calls to your contacts and groups, right from your browser. Select a call to see its details."
          />
        }
      />
    ),
    children: [
      { path: 'new', element: <NewCallPane />, handle: { detail: true } },
      { path: ':callId', element: <CallDetails />, handle: { detail: true } },
    ],
  },
];
