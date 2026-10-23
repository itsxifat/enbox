/**
 * Small states inside the message box, before its buttons: @silent's bell-off, slowmode's
 * timer (with the countdown after I send) and, near a Space chat's limit, the characters left
 * (red and negative over it).
 */
import { BellOff, Timer } from 'lucide-react';
import { cn } from '@/lib/cn';
import { SILENT_HINT } from './silent';
import { formatCooldown } from './slowmode';

export function BoxStatus({
  silent,
  slowmode,
  remaining,
}: {
  silent: boolean;
  /** `seconds` 0 = no slowmode for me; `left` until I may send again. */
  slowmode: { seconds: number; left: number };
  /** Characters left, null = no counter. */
  remaining: number | null;
}) {
  if (!silent && !slowmode.seconds && remaining === null) return null;
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 pl-1 text-[12px] text-muted select-none">
      {remaining !== null ? (
        <span
          className={cn('tabular-nums', remaining < 0 && 'font-semibold text-danger')}
          title={remaining < 0 ? 'Your message is too long' : 'Characters left'}
          data-testid="char-counter"
        >
          {remaining}
        </span>
      ) : null}
      {silent ? (
        <span role="img" aria-label={SILENT_HINT} title={SILENT_HINT} className="text-brand-ink">
          <BellOff size={16} aria-hidden />
        </span>
      ) : null}
      {slowmode.seconds ? (
        <span
          className={cn('flex items-center gap-1', slowmode.left > 0 && 'text-fg')}
          title="Slowmode is enabled"
          data-testid="slowmode"
        >
          {slowmode.left > 0 ? (
            <span className="tabular-nums" aria-hidden>
              {formatCooldown(slowmode.left)}
            </span>
          ) : null}
          <Timer size={16} aria-hidden />
          <span className="sr-only">
            {slowmode.left > 0
              ? `Slowmode is enabled. You can send another message in ${formatCooldown(slowmode.left)}`
              : 'Slowmode is enabled'}
          </span>
        </span>
      ) : null}
    </div>
  );
}
