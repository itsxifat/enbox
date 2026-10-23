import { Fragment, Suspense, useContext } from 'react';
import {
  Navigate,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
  useOutlet,
  type Location,
} from 'react-router';
import { useRouteHandle } from '@/app/routeHandle';
import { PageSpinner } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { lazyNamed } from '@/lib/lazy';
import { useSettingsLayer } from '@/features/settings/SettingsLayer';
import { AppChrome } from '@/features/chrome/AppChrome';
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
const NOT_HOME = ['/spaces', '/settings', '/join', '/communities', '/discover'];
function isHomePath(pathname: string): boolean {
  return !NOT_HOME.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Phones list chats under /chats (Friends is Home's main view on desktop only): a Friends
 * link there (`?friends=pending` from a request toast or push) opens the You tab's Friends.
 */
function phoneFriendsRedirect(location: Location): string | null {
  if (location.pathname !== '/chats' || !new URLSearchParams(location.search).has('friends'))
    return null;
  return `/you/friends${location.search}`;
}

/**
 * Authenticated app frame, Discord's layout from rounded cards on the app background
 * (`.card-pane`, gap `--pane-gap`).
 * Desktop: [rail (Home, unread DMs, Spaces) | Home sidebar on Home routes | section], and
 * User Settings (/settings/*) as a full-screen layer over the page it was opened from, which
 * stays mounted underneath — inert, hidden, state intact (features/settings/SettingsLayer).
 * Phone: [section] + the floating bottom tabs (Servers, Messages, Notifications, You).
 * The call overlay (agent 4) floats above everything; the profile card host renders the
 * card opened through the bus (`profile:open`) from anywhere in the app; KeyboardShortcuts
 * owns Ctrl+K (Quick Switcher) and the other app-wide keys; AppChrome (features/chrome) keeps
 * the tab title and badges current and shows the Streamer Mode bar.
 */
export function AppShell() {
  const desktop = useIsDesktop();
  const { detail, hideTabs } = useRouteHandle();
  const location = useContext(UNSAFE_LocationContext);
  const route = useContext(UNSAFE_RouteContext);
  const outlet = useOutlet();
  const layer = useSettingsLayer({ location, route, outlet, key: 'app' }, desktop);
  // What the app shows: the current route, or (behind the settings layer) the page settings
  // was opened from — rail, sidebar and section all see that page's location and params.
  const { base } = layer;
  const here = base.location.location;
  const home = isHomePath(here.pathname);
  const friends = desktop ? null : phoneFriendsRedirect(here);
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-app px-safe text-fg">
      <div
        className="flex min-h-0 flex-1 flex-col"
        inert={layer.open}
        aria-hidden={layer.open || undefined}
        data-testid="app-base"
      >
        {/* Tab title, favicon and app badges, Streamer Mode (its banner sits here). */}
        <AppChrome />
        <ConnectionBanner />
        <UNSAFE_LocationContext.Provider value={base.location}>
          <UNSAFE_RouteContext.Provider value={base.route}>
            <div className="flex min-h-0 flex-1 gap-[var(--pane-gap)] lg:p-[var(--pane-gap)]">
              {desktop ? <SpaceRail /> : null}
              {desktop && home ? <HomeSidebar /> : null}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <Suspense fallback={<PageSpinner />}>
                  {/* Same key for the live route and the page kept behind settings: one tree. */}
                  <Fragment key={base.key}>
                    {friends ? <Navigate to={friends} replace /> : base.outlet}
                  </Fragment>
                </Suspense>
                {!desktop && !detail && !hideTabs ? <BottomTabs /> : null}
              </div>
            </div>
          </UNSAFE_RouteContext.Provider>
        </UNSAFE_LocationContext.Provider>
      </div>
      {layer.element}
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
