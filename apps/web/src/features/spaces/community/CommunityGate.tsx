/**
 * What a Space shows when it opens (mounted once, with the rail): onboarding first while I
 * still have to do it (`space.me.onboardedAt` null and the Space has onboarding on), then the
 * welcome screen — once per device and Space, the first time it opens while the screen is on.
 * The community settings are read only when one of the two may be due.
 */
import { Suspense, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ID, SpaceCommunity } from '@enbox/shared';
import { useSpace } from '@/stores/spaces';
import {
  getCommunity,
  markWelcomeSeen,
  onboardingActive,
  refreshMySpace,
  welcomeSeen,
} from './api';
import { lazyNamed } from '@/lib/lazy';

// Shown once per Space at most: loaded when needed, not with the rail.
const OnboardingFlow = lazyNamed(() => import('./OnboardingFlow'), 'OnboardingFlow');
const WelcomeModal = lazyNamed(() => import('./WelcomeModal'), 'WelcomeModal');

/** The Space a route shows (`/spaces/:spaceId[/:chatId]`, not its settings). */
export function openSpaceId(pathname: string): ID | null {
  const m = /^\/spaces\/([^/]+)(?:\/([^/]+))?\/?$/.exec(pathname);
  if (!m || m[2] === 'settings') return null;
  return decodeURIComponent(m[1]!);
}

type View = { kind: 'onboarding' | 'welcome'; spaceId: ID; community: SpaceCommunity };

/** Remounts the flow when its questions were reloaded. */
let flowVersion = 0;
const versioned = (v: View | null) => (v ? { ...v, version: ++flowVersion } : null);

export function CommunityGate() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const spaceId = openSpaceId(pathname);
  const space = useSpace(spaceId);
  const ready = !!space;
  const onboardedAt = space?.me.onboardedAt;
  const [view, setView] = useState<(View & { version: number }) | null>(null);

  useEffect(() => setView(null), [spaceId]);

  useEffect(() => {
    if (!spaceId || !ready) return;
    // `undefined`: a server without onboarding — nothing to do.
    const onboardingDue = onboardedAt === null;
    const welcomeDue = !welcomeSeen(spaceId);
    if (!onboardingDue && !welcomeDue) return;
    let live = true;
    void (async () => {
      const community = await getCommunity(spaceId);
      if (!live) return;
      if (onboardingDue && onboardingActive(community.onboarding)) {
        // My loaded copy may be older than my mark (finished on another device, or counted as
        // onboarded when the Space switched it on): ask before taking over the Space.
        const fresh = await refreshMySpace(spaceId).catch(() => null);
        if (!live) return; // the mark changed: this runs again
        if (!fresh || fresh.me.onboardedAt === null) {
          setView(versioned({ kind: 'onboarding', spaceId, community }));
          return;
        }
      }
      if (welcomeDue && community.welcomeScreen?.enabled) {
        markWelcomeSeen(spaceId);
        setView(versioned({ kind: 'welcome', spaceId, community }));
      }
    })().catch(() => undefined);
    return () => {
      live = false;
    };
  }, [spaceId, ready, onboardedAt]);

  if (!space || !view || view.spaceId !== space.id) return null;
  if (view.kind === 'onboarding' && view.community.onboarding)
    return (
      <Suspense fallback={null}>
        <OnboardingFlow
          key={view.version}
          space={space}
          onboarding={view.community.onboarding}
          // My Space now has `onboardedAt`: the welcome screen follows from the effect.
          onDone={() => setView(null)}
          onExit={() => {
            setView(null);
            void navigate('/chats');
          }}
          onStale={() =>
            void getCommunity(space.id, { force: true })
              .then((community) =>
                setView(
                  versioned(
                    onboardingActive(community.onboarding)
                      ? { kind: 'onboarding', spaceId: space.id, community }
                      : null,
                  ),
                ),
              )
              .catch(() => undefined)
          }
        />
      </Suspense>
    );
  if (view.kind === 'welcome' && view.community.welcomeScreen)
    return (
      <Suspense fallback={null}>
        <WelcomeModal
          space={space}
          screen={view.community.welcomeScreen}
          onClose={() => setView(null)}
        />
      </Suspense>
    );
  return null;
}
