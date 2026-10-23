/** A button of a message's hover toolbar (MessageRow's MessageToolbar and its add-ons). */
import type { MouseEvent } from 'react';
import type { IconType } from '@/components/ui';
import { cn } from '@/lib/cn';

export function ToolButton({
  icon: Icon,
  label,
  onClick,
  danger,
  active,
  ...rest
}: {
  icon: IconType;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  active?: boolean;
  'aria-haspopup'?: 'menu' | 'dialog';
  /** The toolbar's one tab stop (More); arrow keys reach the rest. */
  tabStop?: boolean;
}) {
  const { tabStop, ...props } = rest;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={tabStop ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
        danger ? 'text-danger hover:bg-danger/10' : 'text-muted hover:bg-hover hover:text-fg',
        active && 'bg-hover text-fg',
      )}
      {...props}
    >
      <Icon size={20} aria-hidden />
    </button>
  );
}
