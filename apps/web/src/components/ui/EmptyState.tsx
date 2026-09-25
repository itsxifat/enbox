import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { IconType } from './Button';

export interface EmptyStateProps {
  icon?: IconType;
  title: ReactNode;
  description?: ReactNode;
  /** Buttons / links under the text. */
  action?: ReactNode;
  className?: string;
  /** Compact variant for inside lists. */
  compact?: boolean;
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
  compact,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-6 py-8' : 'gap-3 px-8 py-14',
        className,
      )}
    >
      {Icon ? (
        <div
          className={cn(
            'mb-1 flex items-center justify-center rounded-full bg-brand-soft text-brand-ink',
            compact ? 'size-12' : 'size-16',
          )}
        >
          <Icon size={compact ? 22 : 28} strokeWidth={1.75} nonScalingStroke={false} aria-hidden />
        </div>
      ) : null}
      <h3 className={cn('font-semibold text-fg', compact ? 'text-[15px]' : 'text-lg')}>{title}</h3>
      {description ? (
        <p className="max-w-sm text-sm leading-relaxed text-muted">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}
