import { cn } from '@/lib/cn';

export interface SpinnerProps {
  /** Pixel size (default 20). */
  size?: number;
  className?: string;
  /** Accessible label (default "Loading"). Pass `null` when decorative (e.g. inside a busy button). */
  label?: string | null;
}

/** Indeterminate ring spinner; inherits `currentColor`. */
export function Spinner({ size = 20, className, label = 'Loading' }: SpinnerProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      className={cn('animate-spin', className)}
      role={label ? 'status' : undefined}
      aria-label={label ?? undefined}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21.5 12A9.5 9.5 0 0 0 12 2.5"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Centered spinner filling its container (pane/page loading). */
export function PageSpinner({
  className,
  label = 'Loading',
}: {
  className?: string;
  label?: string;
}) {
  return (
    <div className={cn('flex flex-1 items-center justify-center p-8 text-brand-ink', className)}>
      <Spinner size={28} label={label} />
    </div>
  );
}
