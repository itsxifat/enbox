import { Suspense, useEffect, useState } from 'react';
import { useOutlet, useParams } from 'react-router';
import { useRouteHandle } from '@/app/routeHandle';
import { PageSpinner } from '@/components/ui';
import { useIsDesktop, useMediaQuery } from '@/hooks/useMediaQuery';
import { storage } from '@/lib/storage';
import { useSpaces } from '@/stores/spaces';
import { ChannelSidebar } from './ChannelSidebar';
import { MemberList } from './MemberList';
import { SpaceRail } from './SpaceRail';
import { SpacesEmpty } from './SpacesEmpty';
import { SpacesUiContext } from './ui';

const MEMBERS_KEY = 'enbox.spaces.members';

/**
 * The Spaces section (Discord layout from the existing card panes).
 * - Desktop: [Space rail | channel sidebar | channel (child route) | member list] — each a
 *   rounded card; the member list toggles from the channel header (remembered per device).
 * - Phone: rail + sidebar side by side as the list; a channel (`handle.detail`) full screen.
 */
export function SpacesView() {
  const { spaceId } = useParams<{ spaceId?: string; chatId?: string }>();
  const outlet = useOutlet();
  const desktop = useIsDesktop();
  const wide = useMediaQuery('(min-width: 1280px)');
  const { detail } = useRouteHandle();
  const loaded = useSpaces((s) => s.loaded);
  const [membersOpen, setMembersOpen] = useState(() => storage.get(MEMBERS_KEY) !== 'off');

  useEffect(() => {
    if (!loaded)
      void useSpaces
        .getState()
        .loadSpaces()
        .catch(() => undefined);
  }, [loaded]);

  useEffect(() => {
    if (spaceId && !useSpaces.getState().channelsLoaded[spaceId])
      void useSpaces
        .getState()
        .loadSpace(spaceId)
        .catch(() => undefined);
  }, [spaceId]);

  const toggleMembers = () =>
    setMembersOpen((o) => {
      storage.set(MEMBERS_KEY, o ? 'off' : 'on');
      return !o;
    });
  const ui = { membersOpen: membersOpen && wide, toggleMembers, canShowMembers: wide };

  if (desktop) {
    return (
      <SpacesUiContext.Provider value={ui}>
        <div className="flex min-h-0 min-w-0 flex-1 gap-[var(--pane-gap)]">
          <SpaceRail />
          {spaceId ? <ChannelSidebar spaceId={spaceId} /> : null}
          <main className="card-pane relative flex min-w-0 flex-1 flex-col">
            <Suspense fallback={<PageSpinner />}>{outlet ?? <SpacesEmpty />}</Suspense>
          </main>
          {spaceId && ui.membersOpen ? <MemberList spaceId={spaceId} /> : null}
        </div>
      </SpacesUiContext.Provider>
    );
  }

  return (
    <SpacesUiContext.Provider value={ui}>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <section
          className={detail ? 'hidden' : 'relative flex min-h-0 flex-1 bg-surface'}
          aria-hidden={detail || undefined}
        >
          <SpaceRail />
          {spaceId ? (
            <ChannelSidebar spaceId={spaceId} />
          ) : (
            <div className="flex min-w-0 flex-1 flex-col">
              <SpacesEmpty />
            </div>
          )}
        </section>
        {detail ? (
          <main className="relative flex min-h-0 flex-1 flex-col bg-surface">
            <Suspense fallback={<PageSpinner />}>{outlet}</Suspense>
          </main>
        ) : null}
      </div>
    </SpacesUiContext.Provider>
  );
}
