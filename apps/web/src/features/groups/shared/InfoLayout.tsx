/**
 * Building blocks for info panels (group, channel, community): WhatsApp-style stacked cards
 * on the app background with icon rows.
 */
import type { MouseEvent, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import type { IconType } from '@/components/ui';
import { cn } from '@/lib/cn';

/** Scroll container with the grey app background between cards. */
export function InfoPage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('flex min-h-full flex-1 flex-col gap-2 bg-app pb-6', className)}>
      {children}
    </div>
  );
}

export function InfoSection({
  title,
  action,
  children,
  className,
  flush,
  'aria-label': ariaLabel,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No vertical padding (lists that manage their own rows). */
  flush?: boolean;
  'aria-label'?: string;
}) {
  return (
    <section className={cn('bg-surface', flush ? '' : 'py-2', className)} aria-label={ariaLabel}>
      {title || action ? (
        <div className="flex min-h-10 items-center justify-between gap-3 px-5 pt-2 pb-1">
          {title ? <h3 className="text-[14px] font-medium text-muted">{title}</h3> : <span />}
          {action}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export interface InfoRowProps {
  icon?: IconType;
  label: ReactNode;
  description?: ReactNode;
  /** Right-aligned value text (e.g. "Off", "7 days"). */
  value?: ReactNode;
  /** Custom right slot (switch, badge). Replaces the chevron. */
  trailing?: ReactNode;
  onClick?: (e: MouseEvent<HTMLButtonElement>) => void;
  to?: string;
  danger?: boolean;
  /** Show a chevron (default when clickable and no trailing). */
  chevron?: boolean;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function InfoRow({
  icon: Icon,
  label,
  description,
  value,
  trailing,
  onClick,
  to,
  danger,
  chevron,
  disabled,
  className,
  ...aria
}: InfoRowProps) {
  const clickable = !!(onClick || to) && !disabled;
  const showChevron = chevron ?? (clickable && !trailing && !danger);
  const body = (
    <>
      {Icon ? (
        <Icon
          size={21}
          strokeWidth={1.9}
          className={cn('shrink-0', danger ? 'text-danger' : 'text-muted')}
          aria-hidden
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={cn('text-[15.5px] leading-snug', danger ? 'text-danger' : 'text-fg')}>
          {label}
        </span>
        {description ? (
          <span className="mt-0.5 text-[13px] leading-snug text-muted">{description}</span>
        ) : null}
      </span>
      {value ? <span className="shrink-0 text-[14px] text-muted">{value}</span> : null}
      {trailing}
      {showChevron ? <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden /> : null}
    </>
  );
  const classes = cn(
    'flex w-full items-center gap-5 px-5 py-3 text-left outline-none',
    clickable && 'cursor-pointer transition-colors hover:bg-hover focus-visible:bg-hover',
    'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
    disabled && 'opacity-50',
    className,
  );
  if (to && !disabled)
    return (
      <Link to={to} className={classes} aria-label={aria['aria-label']}>
        {body}
      </Link>
    );
  if (onClick)
    return (
      <button
        type="button"
        className={classes}
        onClick={onClick}
        disabled={disabled}
        aria-label={aria['aria-label']}
      >
        {body}
      </button>
    );
  return <div className={classes}>{body}</div>;
}

/** Round quick-action button under the info header (Audio / Video / Add / Share…). */
export function QuickAction({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: IconType;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-[84px] flex-col items-center gap-1.5 rounded-2xl border border-line px-2 py-2.5 text-[13px] font-medium text-brand-ink transition-colors outline-none hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-40"
    >
      <Icon size={22} strokeWidth={1.9} aria-hidden />
      <span className="text-fg">{label}</span>
    </button>
  );
}

/** Small pill (roles, "Admin", "You"). */
export function RolePill({
  children,
  tone = 'brand',
}: {
  children: ReactNode;
  tone?: 'brand' | 'muted';
}) {
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2.5 text-[12px] font-medium',
        tone === 'brand' ? 'bg-brand-soft text-brand-ink' : 'bg-surface-2 text-muted',
      )}
    >
      {children}
    </span>
  );
}
