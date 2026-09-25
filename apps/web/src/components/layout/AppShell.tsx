import { Suspense } from 'react';
import { Outlet } from 'react-router';
import { useRouteHandle } from '@/app/routeHandle';
import { PageSpinner } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { lazyNamed } from '@/lib/lazy';
import { BottomTabs } from './BottomTabs';
import { ConnectionBanner } from './ConnectionBanner';
import { NavRail } from './NavRail';

const CallOverlay = lazyNamed(() => import('@/features/calls/CallOverlay'), 'CallOverlay');

/**
 * Authenticated app frame.
 * Desktop: [nav rail | section (SplitView)]; phone: [section] + bottom tabs.
 * The call overlay (agent 4) floats above everything.
 */
export function AppShell() {
  const desktop = useIsDesktop();
  const { detail, hideTabs } = useRouteHandle();
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-app text-fg">
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1">
        {desktop ? <NavRail /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
          {!desktop && !detail && !hideTabs ? <BottomTabs /> : null}
        </div>
      </div>
      <Suspense fallback={null}>
        <CallOverlay />
      </Suspense>
    </div>
  );
}
