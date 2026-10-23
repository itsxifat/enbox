import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useOnline } from '@/hooks/useOnline';
import { getSocket, useConnection, type ConnectionState } from '@/lib/socket';

/** Delay before showing a state, so quick reconnects don't flash a banner. */
const SHOW_AFTER_MS = 2_000;
/** How long the banner is up (or since the last Try again) before it offers Try again. */
export const RETRY_AFTER_MS = 10_000;

const CHIP =
  'flex shrink-0 items-center justify-center gap-2 px-4 pt-[max(6px,env(safe-area-inset-top))] pb-1.5 text-[13px] font-medium lg:mx-2 lg:mt-2 lg:rounded-xl lg:py-1.5';

export type ConnectionPhase = 'offline' | 'connecting' | 'reconnecting';

/**
 * What the banner is about: no network, the first connection of the session, or getting back
 * a connection that worked before (null: connected, or no session).
 */
export function connectionPhase(online: boolean, state: ConnectionState, readyCount: number): ConnectionPhase | null {
  if (!online) return 'offline';
  if (state !== 'connecting' && state !== 'disconnected') return null;
  return readyCount > 0 ? 'reconnecting' : 'connecting';
}

/** Try now instead of waiting for the next back-off attempt (a fresh attempt, back-off reset). */
export function retryConnection(): void {
  const s = getSocket();
  if (!s || s.connected) return;
  s.disconnect();
  s.connect();
  useConnection.setState({ state: 'connecting' });
}

/**
 * Global slim banner: "You're offline" (no network), "Connecting…" (the first connection) or
 * "Reconnecting to Enbox…" (a dropped one), shown after a moment so blips stay invisible, and
 * with Try again once it has been up a while.
 */
export function ConnectionBanner() {
  const online = useOnline();
  const state = useConnection((s) => s.state);
  const readyCount = useConnection((s) => s.readyCount);
  // A rejected token signs out; nothing to show.
  const rejected = useConnection((s) => s.lastError === 'unauthorized');
  const phase = rejected ? null : connectionPhase(online, state, readyCount);
  const down = phase === 'connecting' || phase === 'reconnecting';
  const [show, setShow] = useState(false);
  const [retry, setRetry] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!down) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [down]);

  useEffect(() => {
    setRetry(false);
    if (!show || !down) return;
    const t = setTimeout(() => setRetry(true), RETRY_AFTER_MS);
    return () => clearTimeout(t);
  }, [show, down, attempt]);

  if (phase === 'offline') {
    return (
      <div role="status" className={cn(CHIP, 'bg-warning-soft text-warning-ink')}>
        <WifiOff size={16} aria-hidden /> You're offline. Messages will send when you reconnect.
      </div>
    );
  }
  if (!show || !down) return null;
  return (
    <div role="status" className={cn(CHIP, 'animate-slide-down bg-brand-soft text-brand-ink')} data-testid="connection-banner">
      <Spinner size={14} label={null} />
      {phase === 'reconnecting' ? 'Reconnecting to Enbox…' : 'Connecting…'}
      {retry ? (
        <button
          type="button"
          onClick={() => {
            retryConnection();
            setAttempt((n) => n + 1);
          }}
          className="ml-1 font-semibold underline underline-offset-2 hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}
