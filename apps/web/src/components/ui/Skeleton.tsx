import { cn } from '@/lib/cn';

/** Pulsing placeholder block. Size it with className (e.g. `h-4 w-32`). */
export function Skeleton({ className, circle }: { className?: string; circle?: boolean }) {
  return (
    <div
      className={cn(
        'animate-pulse bg-surface-2',
        circle ? 'rounded-full' : 'rounded-md',
        className,
      )}
      aria-hidden
    />
  );
}

/** Placeholder rows matching ListItem (avatar + two lines). */
export function ListItemSkeleton({ count = 6, className }: { count?: number; className?: string }) {
  const widths = ['w-2/5', 'w-1/2', 'w-1/3', 'w-3/5', 'w-2/5', 'w-1/2'];
  return (
    <div className={className} role="status" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div
          key={i}
          className="flex items-center gap-3 px-4 py-3"
          style={{ opacity: Math.max(0.25, 1 - i * 0.12) }}
        >
          <Skeleton circle className="size-12 shrink-0" />
          <div className="flex min-w-0 flex-1 flex-col gap-2.5">
            <div className="flex items-center justify-between gap-4">
              <Skeleton className={cn('h-3.5', widths[i % widths.length])} />
              <Skeleton className="h-3 w-9" />
            </div>
            <Skeleton className={cn('h-3', i % 2 ? 'w-4/5' : 'w-3/5')} />
          </div>
        </div>
      ))}
    </div>
  );
}
