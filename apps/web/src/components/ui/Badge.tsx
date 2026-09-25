import { cn } from '@/lib/cn';

export interface BadgeProps {
  /** Number to show; nothing renders for 0/undefined unless `dot`. */
  count?: number;
  /** Cap (default 99 → "99+"). */
  max?: number;
  /** brand = unread; muted = unread in a muted chat; danger = missed/error. */
  tone?: 'brand' | 'muted' | 'danger' | 'success';
  /** A small dot instead of a number. */
  dot?: boolean;
  size?: 'sm' | 'md';
  className?: string;
  /** Accessible text, e.g. "3 unread messages". */
  label?: string;
}

const TONES = {
  brand: 'bg-unread text-on-brand',
  muted: 'bg-unread-muted text-white dark:text-fg',
  danger: 'bg-danger-fill text-white',
  success: 'bg-success text-white',
} as const;

/** Unread counter / status dot. */
export function Badge({
  count,
  max = 99,
  tone = 'brand',
  dot,
  size = 'md',
  className,
  label,
}: BadgeProps) {
  if (dot) {
    return (
      <span
        className={cn(
          'inline-block rounded-full',
          size === 'sm' ? 'size-2' : 'size-2.5',
          TONES[tone],
          className,
        )}
        role={label ? 'status' : undefined}
        aria-label={label}
        aria-hidden={label ? undefined : true}
      />
    );
  }
  if (!count || count <= 0) return null;
  const text = count > max ? `${max}+` : String(count);
  return (
    <span
      className={cn(
        'inline-flex items-center justify-center rounded-full font-semibold tabular-nums leading-none',
        size === 'sm' ? 'h-[18px] min-w-[18px] px-1 text-[11px]' : 'h-5 min-w-5 px-1.5 text-xs',
        TONES[tone],
        className,
      )}
      aria-label={label}
    >
      {text}
    </span>
  );
}
