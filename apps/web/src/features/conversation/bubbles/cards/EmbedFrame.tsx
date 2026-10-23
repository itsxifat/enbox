/**
 * Pieces every embed under a message shares: the frame with Discord's "Remove all embeds" X
 * (top-right, on hover or focus; always shown on touch screens), the accent-bar card shell,
 * and `useGrowNotice` (an embed that appears after its row was laid out tells the message
 * list to follow).
 */
import {
  useLayoutEffect,
  useRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { X } from 'lucide-react';
import { bus } from '@/lib/bus';
import { cn } from '@/lib/cn';

/** Removes every embed of the message (`shift`: Shift was held, skip the confirmation). */
export type RemoveEmbeds = (opts: { shift: boolean }) => void;

/** A theme colour that shows on both light and dark bubbles, else null (brand colour). */
export function accentOf(hex: string | null | undefined): string | null {
  const m = hex ? /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex) : null;
  if (!m) return null;
  const [r, g, b] = m.slice(1).map((h) => {
    const c = Number.parseInt(h, 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.7 || luminance < 0.02 ? null : hex!;
}

/** Card chrome: an accent bar on the left, a faint fill, no border lines. */
export function cardClasses(accent: string | null, className?: string): string {
  return cn(
    'block rounded-md border-l-4 bg-black/[0.04] px-2.5 py-2 whitespace-normal dark:bg-white/[0.05]',
    !accent && 'border-brand',
    className,
  );
}

export function cardStyle(accent: string | null): CSSProperties | undefined {
  return accent ? { borderLeftColor: accent } : undefined;
}

/** Wraps one embed; with `onRemove` it carries the X that removes all of the message's. */
export function EmbedFrame({
  onRemove,
  className,
  children,
}: {
  onRemove?: RemoveEmbeds;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div className={cn('group/embed relative mt-1.5 mb-0.5 w-fit max-w-full', className)}>
      {children}
      {onRemove ? (
        <button
          type="button"
          aria-label="Remove all embeds"
          title="Remove all embeds"
          onClick={(e: MouseEvent) => {
            e.stopPropagation();
            onRemove({ shift: e.shiftKey });
          }}
          className={cn(
            'absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full bg-elevated text-muted shadow-elevated transition-opacity',
            'opacity-0 group-hover/embed:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-100',
            'hover:text-fg focus-visible:outline-2 focus-visible:outline-brand',
          )}
        >
          <X size={14} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

/** An embed that shows up after its row was laid out grows the row: let the list follow. */
export function useGrowNotice(shown: boolean): void {
  const shownAtMount = useRef(shown);
  useLayoutEffect(() => {
    if (shown && !shownAtMount.current) bus.emit('conversation:row-grew');
  }, [shown]);
}
