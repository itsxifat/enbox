import { useContext, useEffect, useRef, useState } from 'react';
import { UNSAFE_DataRouterContext, useBlocker } from 'react-router';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface UnsavedChangesBarProps {
  open: boolean;
  saving?: boolean;
  /** Save blocked (an invalid field). */
  saveDisabled?: boolean;
  onReset: () => void;
  onSave: () => void;
  /** Bump to shake the bar (a blocked attempt to leave). */
  shakeKey?: number;
  className?: string;
}

const SHAKE: Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-10px)' },
  { transform: 'translateX(9px)' },
  { transform: 'translateX(-7px)' },
  { transform: 'translateX(5px)' },
  { transform: 'translateX(-2px)' },
  { transform: 'translateX(0)' },
];

/**
 * The sticky "Careful — you have unsaved changes!" bar with Reset and Save Changes. A blocked
 * attempt to leave (`shakeKey` changes) shakes it and flashes it red for a moment.
 */
export function UnsavedChangesBar({
  open,
  saving,
  saveDisabled,
  onReset,
  onSave,
  shakeKey = 0,
  className,
}: UnsavedChangesBarProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [alerting, setAlerting] = useState(false);

  useEffect(() => {
    if (!shakeKey) return;
    const el = ref.current;
    // Web Animations: no CSS keyframes needed (jsdom has no `animate`).
    if (el && typeof el.animate === 'function')
      el.animate(SHAKE, { duration: 420, easing: 'ease-out' });
    setAlerting(true);
    const t = setTimeout(() => setAlerting(false), 1600);
    return () => clearTimeout(t);
  }, [shakeKey]);

  if (!open) return null;
  return (
    <div
      ref={ref}
      role="region"
      aria-label="Unsaved changes"
      data-testid="unsaved-bar"
      data-alert={alerting || undefined}
      className={cn(
        'sticky bottom-3 z-20 flex animate-slide-down items-center gap-3 rounded-2xl p-2.5 pl-4 shadow-elevated transition-colors',
        alerting ? 'bg-danger-fill text-white' : 'bg-elevated text-fg',
        className,
      )}
    >
      <span className="min-w-0 flex-1 text-[14px] font-medium" aria-live="polite">
        {alerting ? 'Save or reset your changes first!' : 'Careful — you have unsaved changes!'}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onReset}
        disabled={saving}
        className={alerting ? 'text-white hover:bg-white/15' : undefined}
      >
        Reset
      </Button>
      <Button size="sm" loading={saving} disabled={saveDisabled} onClick={onSave}>
        Save Changes
      </Button>
    </div>
  );
}

/**
 * While `when`: a reload / tab close asks the browser's "Leave site?" question, and in-app
 * navigation away from this page is blocked and reported through `onBlocked` (the editor
 * shakes the bar). The router blocker needs a data router; elsewhere (tests with a plain
 * MemoryRouter) only the unload warning applies.
 */
export function UnsavedChangesGuard({ when, onBlocked }: { when: boolean; onBlocked: () => void }) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  useEffect(() => {
    if (!when) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [when]);
  // Mounted only while dirty: a router runs one blocker at a time.
  return dataRouter && when ? <RouteBlocker onBlocked={onBlocked} /> : null;
}

function RouteBlocker({ onBlocked }: { onBlocked: () => void }) {
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => currentLocation.pathname !== nextLocation.pathname,
  );
  const onBlockedRef = useRef(onBlocked);
  onBlockedRef.current = onBlocked;
  useEffect(() => {
    if (blocker.state !== 'blocked') return;
    blocker.reset();
    onBlockedRef.current();
  }, [blocker]);
  return null;
}
