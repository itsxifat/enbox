import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TooltipProps {
  label: ReactNode;
  children: ReactNode;
  side?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
}

/**
 * CSS-only tooltip shown on hover and keyboard focus within. Lightweight: it can be clipped
 * by `overflow-hidden` ancestors — for icon buttons prefer IconButton's native `title`.
 */
export function Tooltip({ label, children, side = 'top', className }: TooltipProps) {
  const pos = {
    top: 'bottom-full left-1/2 mb-2 -translate-x-1/2',
    bottom: 'top-full left-1/2 mt-2 -translate-x-1/2',
    left: 'right-full top-1/2 mr-2 -translate-y-1/2',
    right: 'left-full top-1/2 ml-2 -translate-y-1/2',
  }[side];
  return (
    <span className={cn('group/tooltip relative inline-flex', className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          'pointer-events-none absolute z-50 rounded-lg bg-fg px-2.5 py-1.5 text-xs font-medium whitespace-nowrap text-surface opacity-0 shadow-elevated',
          'transition-opacity delay-300 duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100',
          pos,
        )}
      >
        {label}
      </span>
    </span>
  );
}
