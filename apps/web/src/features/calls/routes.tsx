/** Calls routes — OWNED BY FEATURE AGENT 4. */
import type { RouteObject } from 'react-router';
import { Phone } from 'lucide-react';
import { MainEmpty } from '@/components/layout/MainEmpty';
import { SplitView } from '@/components/layout/SplitView';
import { lazyNamed } from '@/lib/lazy';

const CallsPane = lazyNamed(() => import('./CallsPane'), 'CallsPane');

export const callsRoutes: RouteObject[] = [
  {
    path: 'calls',
    element: (
      <SplitView
        list={<CallsPane />}
        empty={
          <MainEmpty
            icon={Phone}
            title="Calls"
            description="Make voice and video calls to your contacts and groups, right from your browser."
          />
        }
      />
    ),
  },
];
