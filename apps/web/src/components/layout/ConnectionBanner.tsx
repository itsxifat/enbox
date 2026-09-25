import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { Spinner } from '@/components/ui';
import { useOnline } from '@/hooks/useOnline';
import { useConnection } from '@/lib/socket';

/** Delay before showing "Connecting…" so quick reconnects don't flash a banner. */
const SHOW_AFTER_MS = 2_000;

/** Global slim banner: "Offline" (no network) or "Connecting…" (socket down). */
export function ConnectionBanner() {
  const online = useOnline();
  const state = useConnection((s) => s.state);
  const down = state === 'connecting' || state === 'disconnected';
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!down) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), SHOW_AFTER_MS);
    return () => clearTimeout(t);
  }, [down]);

  if (!online) {
    return (
      <div
        role="status"
        className="flex shrink-0 items-center justify-center gap-2 bg-warning-soft px-4 pt-[max(6px,env(safe-area-inset-top))] pb-1.5 text-[13px] font-medium text-warning"
      >
        <WifiOff size={15} aria-hidden /> You're offline. Messages will send when you reconnect.
      </div>
    );
  }
  if (!show) return null;
  return (
    <div
      role="status"
      className="flex shrink-0 animate-slide-down items-center justify-center gap-2 bg-brand-soft px-4 pt-[max(6px,env(safe-area-inset-top))] pb-1.5 text-[13px] font-medium text-brand-ink"
    >
      <Spinner size={14} label={null} /> Connecting…
    </div>
  );
}
