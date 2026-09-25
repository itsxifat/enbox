import { Suspense, type ReactNode } from 'react';
import { useOutlet } from 'react-router';
import { useRouteHandle } from '@/app/routeHandle';
import { PageSpinner } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { MainEmpty } from './MainEmpty';

export interface SplitViewProps {
  /** The list pane (chat list, updates, calls, settings menu…). */
  list: ReactNode;
  /** Main pane when no child route matches (desktop). Defaults to the branded <MainEmpty/>. */
  empty?: ReactNode;
}

/**
 * Two-pane section layout used as a route element; child routes render in the main pane.
 *
 * - Desktop: list pane (fixed width) | main pane (child route or `empty`)
 * - Phone:   the list pane, or — when the matched child route has `handle.detail` — the
 *            child full screen. The list stays mounted (hidden) to keep its scroll position.
 */
export function SplitView({ list, empty }: SplitViewProps) {
  const outlet = useOutlet();
  const desktop = useIsDesktop();
  const { detail } = useRouteHandle();

  if (desktop) {
    return (
      <div className="flex min-h-0 min-w-0 flex-1">
        <section className="relative flex w-[clamp(320px,30vw,440px)] shrink-0 flex-col border-r border-line bg-surface">
          <Suspense fallback={<PageSpinner />}>{list}</Suspense>
        </section>
        <main className="relative flex min-w-0 flex-1 flex-col bg-app">
          <Suspense fallback={<PageSpinner />}>{outlet ?? empty ?? <MainEmpty />}</Suspense>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <section
        className={detail ? 'hidden' : 'relative flex min-h-0 flex-1 flex-col bg-surface'}
        aria-hidden={detail || undefined}
      >
        <Suspense fallback={<PageSpinner />}>{list}</Suspense>
      </section>
      {detail ? (
        <main className="relative flex min-h-0 flex-1 flex-col bg-surface">
          <Suspense fallback={<PageSpinner />}>{outlet}</Suspense>
        </main>
      ) : null}
    </div>
  );
}

/**
 * A route element that uses the whole content area (no list pane), e.g. the invite
 * landing page. On phones it's full screen when the route has `handle.detail`.
 */
export function FullView({ children }: { children: ReactNode }) {
  return (
    <main className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-app">
      <Suspense fallback={<PageSpinner />}>{children}</Suspense>
    </main>
  );
}
