import { Suspense } from 'react';
import { Outlet, useLocation } from 'react-router';
import { useRouteHandle } from '@/app/routeHandle';
import { PageSpinner } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { lazyNamed } from '@/lib/lazy';
import { BottomTabs } from './BottomTabs';
import { ConnectionBanner } from './ConnectionBanner';
import { SpaceRail } from '@/features/spaces/SpaceRail';
import { HomeSidebar } from '@/features/home/HomeSidebar';

const CallOverlay = lazyNamed(() => import('@/features/calls/CallOverlay'), 'CallOverlay');
const ProfileCardHost = lazyNamed(
  () => import('@/features/profile/ProfileCardHost'),
  'ProfileCardHost',
);
const KeyboardShortcuts = lazyNamed(
  () => import('@/features/quickSwitcher/KeyboardShortcuts'),
  'KeyboardShortcuts',
);

/** Sections that live under Home (Discord's DMs): they get the DM sidebar on desktop. */
const NOT_HOME = ['/spaces', '/settings', '/join', '/communities'];
function isHomePath(pathname: string): boolean {
  return !NOT_HOME.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Authenticated app frame, Discord's layout from rounded cards on the app background
 * (`.card-pane`, gap `--pane-gap`).
 * Desktop: [rail (Home, unread DMs, Spaces) | Home sidebar on Home routes | section];
 * phone: [section] + the floating bottom tabs.
 * The call overlay (agent 4) floats above everything; the profile card host renders the
 * card opened through the bus (`profile:open`) from anywhere in the app; KeyboardShortcuts
 * owns Ctrl+K (Quick Switcher) and the other app-wide keys.
 */
export function AppShell() {
  const desktop = useIsDesktop();
  const { detail, hideTabs } = useRouteHandle();
  const { pathname } = useLocation();
  const home = isHomePath(pathname);
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-app px-safe text-fg">
      <ConnectionBanner />
      <div className="flex min-h-0 flex-1 gap-[var(--pane-gap)] lg:p-[var(--pane-gap)]">
        {desktop ? <SpaceRail /> : null}
        {desktop && home ? <HomeSidebar /> : null}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <Suspense fallback={<PageSpinner />}>
            <Outlet />
          </Suspense>
          {!desktop && !detail && !hideTabs ? <BottomTabs /> : null}
        </div>
      </div>
      <Suspense fallback={null}>
        <CallOverlay />
        <ProfileCardHost />
      </Suspense>
      {/* Its own boundary: Ctrl+K must not wait for the call overlay's chunk. */}
      <Suspense fallback={null}>
        <KeyboardShortcuts />
      </Suspense>
    </div>
  );
}
