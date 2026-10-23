import { cn } from '@/lib/cn';

/** The red LIVE pill of someone streaming (the channel list's, stream tiles, Active Now). */
export function LivePill({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        'shrink-0 rounded bg-danger px-1 text-[10px] leading-4 font-bold tracking-wide text-white',
        className,
      )}
    >
      LIVE
    </span>
  );
}
