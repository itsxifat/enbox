import type { KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { Link } from 'react-router';
import { cn } from '@/lib/cn';

export interface ListItemProps {
  /** Left slot, usually an <Avatar/>. */
  leading?: ReactNode;
  title: ReactNode;
  /** Inline after the title (verified/muted icons). */
  titleAdornment?: ReactNode;
  subtitle?: ReactNode;
  /** Top-right (time). */
  meta?: ReactNode;
  /** Bottom-right (unread badge, pin/mute icons). */
  trailing?: ReactNode;
  /** Right slot vertically centered (checkbox, action button) — replaces meta/trailing layout. */
  end?: ReactNode;
  /** Render as a react-router Link. */
  to?: string;
  /** Render as a button. */
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  onContextMenu?: (e: MouseEvent<HTMLElement>) => void;
  /** Selected/current row (e.g. the open chat). */
  active?: boolean;
  /** Divider under the text column (default true). */
  divider?: boolean;
  /** Emphasize (bold title, brand meta) — e.g. unread chats. */
  highlight?: boolean;
  /** Tighter padding (member lists, pickers). */
  dense?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-current'?: 'page' | 'true' | boolean;
}

/**
 * Generic two-line list row (chats, contacts, calls, members, settings entries).
 * Layout: [leading] [title … meta] / [subtitle … trailing] [end].
 */
export function ListItem({
  leading,
  title,
  titleAdornment,
  subtitle,
  meta,
  trailing,
  end,
  to,
  onClick,
  onContextMenu,
  active,
  divider = true,
  highlight,
  dense,
  disabled,
  className,
  ...aria
}: ListItemProps) {
  const classes = cn(
    'group/li flex w-full items-center gap-3 text-left outline-none transition-colors duration-100',
    dense ? 'px-4 py-2' : 'px-3 py-0 lg:px-3.5',
    (to || onClick) && !disabled && 'cursor-pointer hover:bg-hover focus-visible:bg-hover',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
    active && 'bg-selected hover:bg-selected',
    disabled && 'opacity-50',
    className,
  );

  const body = (
    <>
      {leading ? <div className={cn('shrink-0', !dense && 'py-2.5')}>{leading}</div> : null}
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-3 self-stretch',
          dense ? 'py-1' : 'py-3',
          divider && 'border-b border-line group-last/li:border-transparent',
          active && 'border-transparent',
        )}
      >
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5">
          <div className="flex items-baseline gap-2">
            <span className="flex min-w-0 flex-1 items-center gap-1.5">
              <span
                className={cn(
                  'truncate text-[16px] leading-snug text-fg',
                  highlight ? 'font-semibold' : 'font-medium',
                )}
              >
                {title}
              </span>
              {titleAdornment}
            </span>
            {meta ? (
              <span
                className={cn(
                  'shrink-0 text-xs tabular-nums',
                  highlight ? 'font-medium text-brand-ink' : 'text-subtle',
                )}
              >
                {meta}
              </span>
            ) : null}
          </div>
          {subtitle || trailing ? (
            <div className="flex min-h-5 items-center gap-2">
              <span
                className={cn(
                  'min-w-0 flex-1 truncate text-[14px] leading-snug',
                  highlight ? 'text-fg' : 'text-muted',
                )}
              >
                {subtitle}
              </span>
              {trailing ? (
                <span className="flex shrink-0 items-center gap-1.5 text-subtle">{trailing}</span>
              ) : null}
            </div>
          ) : null}
        </div>
        {end ? <div className="flex shrink-0 items-center">{end}</div> : null}
      </div>
    </>
  );

  if (to && !disabled) {
    return (
      <Link
        to={to}
        className={classes}
        onClick={onClick}
        onContextMenu={onContextMenu}
        aria-current={active ? 'page' : undefined}
        aria-label={aria['aria-label']}
      >
        {body}
      </Link>
    );
  }
  if (onClick) {
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        onContextMenu={onContextMenu}
        disabled={disabled}
        aria-label={aria['aria-label']}
        aria-current={aria['aria-current']}
      >
        {body}
      </button>
    );
  }
  return (
    <div
      className={classes}
      onContextMenu={onContextMenu}
      onKeyDown={(e: KeyboardEvent<HTMLDivElement>) =>
        e.key === 'ContextMenu' && e.preventDefault()
      }
      aria-label={aria['aria-label']}
    >
      {body}
    </div>
  );
}

/** Small uppercase-ish section title inside lists. */
export function ListSection({
  title,
  children,
  className,
  action,
}: {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={className}>
      {title || action ? (
        <div className="flex items-center justify-between px-4 pt-4 pb-1.5">
          {title ? (
            <h3 className="text-[13px] font-semibold tracking-wide text-brand-ink">{title}</h3>
          ) : (
            <span />
          )}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}
