/**
 * User Settings as a full-screen layer over the still-mounted app (desktop), Discord style —
 * the background-location pattern:
 *
 * - Opening `/settings/*` from inside the app (the user panel's gear, Ctrl+, any link) keeps
 *   the page it was opened from rendered behind the layer — inert, hidden from assistive tech,
 *   its state intact. A link may name that page with `state: { backgroundLocation }`; without
 *   one the page just left stays. A direct load of /settings/x shows the layer over Home.
 * - Esc or ✕ returns to exactly that page: back through history when the layer was opened from
 *   it (the entries pushed inside the layer are counted per history key), else a replace to the
 *   background location. Both are navigations, so the profile editor's unsaved-changes blocker
 *   stops them (and shakes its bar).
 * - The layer scales and fades in, and fades out over the page it returns to (no motion when
 *   reduced). Focus is trapped inside it and goes back where it was when it closes.
 *
 * AppShell calls `useSettingsLayer`, renders `base` as the app and `element` above it. Phones
 * keep the full-screen settings pages (no layer).
 */
import {
  Suspense,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ContextType,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  NavigationType,
  UNSAFE_DataRouterContext,
  UNSAFE_LocationContext,
  createPath,
  matchRoutes,
  renderMatches,
  useNavigate,
  type DataRouteObject,
  type Location,
  type UNSAFE_RouteContext,
} from 'react-router';
import { PageSpinner, useFocusTrap, useOverlay } from '@/components/ui';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { useInbox } from '@/stores/inbox';

export const SETTINGS_PATH = '/settings';

export function isSettingsPath(pathname: string): boolean {
  return pathname === SETTINGS_PATH || pathname.startsWith(`${SETTINGS_PATH}/`);
}

/** Location state naming the page the layer opens over. */
export interface SettingsLocationState {
  backgroundLocation?: Location;
}

/** The `backgroundLocation` of a settings entry's state, when it names an app page. */
export function backgroundLocationOf(state: unknown): Location | null {
  const bg = (state as SettingsLocationState | null | undefined)?.backgroundLocation;
  return bg &&
    typeof bg === 'object' &&
    typeof bg.pathname === 'string' &&
    !isSettingsPath(bg.pathname)
    ? bg
    : null;
}

/** State for a link into settings from `location`: open over it (or keep the current page). */
export function settingsLinkState(location: Location): SettingsLocationState {
  return isSettingsPath(location.pathname)
    ? { backgroundLocation: backgroundLocationOf(location.state) ?? undefined }
    : { backgroundLocation: location };
}

type LocationValue = ContextType<typeof UNSAFE_LocationContext>;
type RouteValue = ContextType<typeof UNSAFE_RouteContext>;

/** What the shell renders for one location: its location and route contexts and its outlet. */
export interface ShellScene {
  location: LocationValue;
  route: RouteValue;
  outlet: ReactNode;
  /** The outlet tree's identity: a scene rendered from scratch must not reuse another's. */
  key: string;
}

/** Behind a direct load (no page to return to): Home. */
const HOME: Location = {
  pathname: '/chats',
  search: '',
  hash: '',
  state: null,
  key: 'settings-home',
};

/**
 * History entries pushed inside the layer on top of its background entry, by location key
 * (0: the layer's first entry sits right above the page it was opened from). Unknown — a
 * direct load, or an entry restored after a reload — means there is no history to go back
 * through.
 */
const depthByKey = new Map<string, number>();

/** Record the depth of a newly committed settings entry (idempotent per key). */
function trackSettingsEntry(
  prev: { key: string; settings: boolean } | null,
  key: string,
  settings: boolean,
  action: NavigationType,
): void {
  if (!settings || depthByKey.has(key)) return;
  // First commit seen: the layer loads with the settings route, so the push from the app page
  // (and the index redirect's replace) happened before it mounted. Only a direct load or a
  // reload (a pop) has no app page below it.
  if (!prev) {
    if (action !== NavigationType.Pop) depthByKey.set(key, 0);
    return;
  }
  const from = prev.settings ? depthByKey.get(prev.key) : -1;
  if (from === undefined) return;
  if (action === NavigationType.Push) depthByKey.set(key, from + 1);
  // A replace inside the layer keeps the depth; one from an app page replaced the background.
  else if (action === NavigationType.Replace && prev.settings) depthByKey.set(key, from);
}

function sameEntry(a: Location, b: Location): boolean {
  return (
    (a.key === b.key && a.key !== 'default') ||
    (a.pathname === b.pathname && a.search === b.search && a.hash === b.hash)
  );
}

/** The shell's child routes rendered for `target` (a background nothing rendered yet). */
function sceneFor(
  routes: DataRouteObject[] | undefined,
  shellId: string | undefined,
  target: Location,
): ShellScene | null {
  if (!routes || !shellId) return null;
  const matches = matchRoutes(routes, target);
  const at = matches ? matches.findIndex((m) => m.route.id === shellId) : -1;
  if (!matches || at < 0) return null;
  return {
    location: { location: target, navigationType: NavigationType.Pop },
    route: { outlet: null, matches: matches.slice(0, at + 1), isDataRoute: true },
    outlet: renderMatches(matches.slice(at + 1)),
    key: `bg:${target.key}:${createPath(target)}`,
  };
}

export interface SettingsLayer {
  /** The layer is up: the app underneath is inert and hidden. */
  open: boolean;
  /** What the app renders: the current route, or the page behind the layer. */
  base: ShellScene;
  /** The layer (open, or fading out); null when there is none. */
  element: ReactNode;
}

/** The shell's side of the layer; `live` is the shell's current scene (key 'app'). */
export function useSettingsLayer(live: ShellScene, desktop: boolean): SettingsLayer {
  const navigate = useNavigate();
  const routes = useContext(UNSAFE_DataRouterContext)?.router.routes;
  const reduced = useReducedMotion();
  const { location, navigationType } = live.location;
  const inSettings = isSettingsPath(location.pathname);
  const open = desktop && inSettings;
  const shellId = live.route.matches[live.route.matches.length - 1]?.route.id;

  const prev = useRef<{ key: string; settings: boolean } | null>(null);
  useLayoutEffect(() => {
    trackSettingsEntry(prev.current, location.key, inSettings, navigationType);
    prev.current = { key: location.key, settings: inSettings };
  }, [location.key, inSettings, navigationType]);

  // The last committed app page, and the last committed layer content (it fades out).
  const lastApp = useRef<ShellScene | null>(null);
  const lastLayer = useRef<ShellScene | null>(null);
  useLayoutEffect(() => {
    if (!inSettings) lastApp.current = live;
    else if (open) lastLayer.current = live;
  });

  // The background is picked when the layer opens and kept for the visit (sub-pages pushed
  // without state keep it), unless an explicit backgroundLocation names another entry.
  const visit = useRef<ShellScene | null>(null);
  const requested = open ? backgroundLocationOf(location.state) : null;
  const fits = (s: ShellScene | null): s is ShellScene =>
    !!s && (!requested || sameEntry(requested, s.location.location));
  const kept = open && fits(visit.current) ? visit.current : null;
  const left = open && !kept && fits(lastApp.current) ? lastApp.current : null;
  const target = open && !kept && !left ? (requested ?? HOME) : null;
  const fresh = useMemo(
    () =>
      target
        ? (sceneFor(routes, shellId, target) ?? { ...live, outlet: null, key: 'bg:none' })
        : null,
    // `live` only seeds the empty fallback; a new location object means a new target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [target, routes, shellId],
  );
  const base = open ? (kept ?? left ?? fresh!) : live;
  useLayoutEffect(() => {
    visit.current = open ? base : null;
  });

  // Leaving settings fades the layer out over the page; focus returns where it was.
  const returnFocus = useRef<HTMLElement | null>(null);
  const [exit, setExit] = useState<ShellScene | null>(null);
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open && typeof document !== 'undefined')
      returnFocus.current = document.activeElement as HTMLElement | null;
    setExit(!open && desktop && !inSettings && !reduced ? lastLayer.current : null);
  }

  const baseLocation = base.location.location;
  const close = useCallback(() => {
    const depth = depthByKey.get(location.key);
    if (depth !== undefined) void navigate(-(depth + 1));
    else void navigate(createPath(baseLocation), { replace: true, state: baseLocation.state });
  }, [navigate, location.key, baseLocation]);
  const onExited = useCallback(() => setExit(null), []);

  const scene = open ? live : exit;
  const element = scene ? (
    <SettingsLayerFrame
      closing={!open}
      onClose={close}
      onExited={onExited}
      returnFocus={returnFocus}
    >
      <UNSAFE_LocationContext.Provider value={scene.location}>
        <Suspense fallback={<PageSpinner />}>{scene.outlet}</Suspense>
      </UNSAFE_LocationContext.Provider>
    </SettingsLayerFrame>
  ) : null;

  return { open, base, element };
}

/** The layer's close action for its ✕ button; null outside the layer. */
const CloseContext = createContext<(() => void) | null>(null);
/**
 * True while the layer fades out over the page it closed to: its content must not navigate
 * any more (the `/settings` index redirect would replace the app page's entry).
 */
const ClosingContext = createContext(false);

export function useSettingsClosing(): boolean {
  return useContext(ClosingContext);
}

export function useSettingsClose(): (() => void) | null {
  return useContext(CloseContext);
}

const ENTER: Keyframe[] = [
  { opacity: 0, transform: 'scale(1.04)' },
  { opacity: 1, transform: 'none' },
];
const EXIT: Keyframe[] = [
  { opacity: 1, transform: 'none' },
  { opacity: 0, transform: 'scale(1.04)' },
];

/**
 * The full-screen layer: a modal dialog (Escape closes it while it is the top-most overlay, so
 * a dialog or menu opened from settings closes first), focus trapped, animated in and out.
 */
function SettingsLayerFrame({
  closing,
  onClose,
  onExited,
  returnFocus,
  children,
}: {
  closing: boolean;
  onClose: () => void;
  onExited: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useOverlay(!closing, onClose, ref);
  useFocusTrap(ref, !closing, ref);

  // The page behind may have its Inbox popout open: it would float above the layer.
  useEffect(() => {
    if (useInbox.getState().open) useInbox.getState().setOpen(false);
  }, []);

  useLayoutEffect(() => {
    const el = ref.current;
    if (reduced || !el || typeof el.animate !== 'function') return;
    el.animate(ENTER, { duration: 200, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
    // Once, when the layer appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Give focus back when the layer starts closing (or goes away while open). Skipped while
  // the page is still inert (StrictMode's mount check).
  useEffect(() => {
    if (closing) return;
    return () => {
      const el = returnFocus.current;
      if (!el || !el.isConnected || el.closest('[inert]')) return;
      returnFocus.current = null;
      el.focus({ preventScroll: true });
    };
  }, [closing, returnFocus]);

  const exited = useRef(onExited);
  useEffect(() => {
    exited.current = onExited;
  });
  useEffect(() => {
    if (!closing) return;
    const el = ref.current;
    if (reduced || !el || typeof el.animate !== 'function') {
      exited.current();
      return;
    }
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      exited.current();
    };
    const anim = el.animate(EXIT, { duration: 140, easing: 'ease-in', fill: 'forwards' });
    anim.onfinish = finish;
    const timer = setTimeout(finish, 400);
    return () => {
      clearTimeout(timer);
      anim.onfinish = null;
      anim.cancel();
    };
  }, [closing, reduced]);

  // While it fades out the layer is inert and hidden (the app is live again underneath); the ✕
  // stays put rather than vanishing first.
  return (
    <CloseContext.Provider value={onClose}>
      <ClosingContext.Provider value={closing}>
        <div
          ref={ref}
          role="dialog"
          aria-modal="true"
          aria-label="User Settings"
          tabIndex={-1}
          inert={closing}
          aria-hidden={closing || undefined}
          data-state={closing ? 'closing' : 'open'}
          className="fixed inset-0 z-40 flex bg-app p-[var(--pane-gap)] text-fg outline-none"
          data-testid="settings-layer"
        >
          {children}
        </div>
      </ClosingContext.Provider>
    </CloseContext.Provider>
  );
}
