import { Radio } from 'lucide-react';
import { cn } from '@/lib/cn';
import { useStreamer } from '@/stores/streamer';

/** Same chip as the connection banner (full-bleed on phones, a rounded card on desktop). */
const CHIP =
  'flex shrink-0 items-center justify-center gap-2 px-4 pt-[max(6px,env(safe-area-inset-top))] pb-1.5 text-[13px] font-medium lg:mx-2 lg:mt-2 lg:rounded-xl lg:py-1.5';

/** Discord's notice while Streamer Mode is on: a slim violet bar on top of the app, with Disable. */
export function StreamerBanner() {
  const on = useStreamer((s) => s.enabled);
  if (!on) return null;
  return (
    <div role="status" className={cn(CHIP, 'bg-brand text-on-brand')} data-testid="streamer-banner">
      <Radio size={16} aria-hidden />
      <span>Streamer Mode is on</span>
      <button
        type="button"
        onClick={() => useStreamer.getState().setEnabled(false)}
        className="ml-1 h-6 shrink-0 rounded-full border border-current px-3 text-[12.5px] font-semibold transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-on-brand"
      >
        Disable
      </button>
    </div>
  );
}
