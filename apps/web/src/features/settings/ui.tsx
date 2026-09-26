/**
 * Building blocks for settings pages (agent 1): page scroller, grouped cards, rows,
 * switch rows and notes. Phones get flat full-width sections; desktop gets cards on the
 * app background, centered in the main pane.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { Switch, type IconType } from '@/components/ui';
import { cn } from '@/lib/cn';

export function SettingsScroller({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-surface scrollbar-thin lg:bg-app">
      <div
        className={cn(
          'mx-auto flex w-full max-w-2xl flex-col pb-[max(24px,env(safe-area-inset-bottom))] lg:gap-6 lg:px-6 lg:py-6',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function SettingsGroup({
  title,
  footer,
  children,
  className,
}: {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('border-b-8 border-app last:border-b-0 lg:border-0', className)}>
      {title ? (
        <h3 className="px-4 pt-4 pb-1 text-[13px] font-semibold tracking-wide text-brand-ink lg:px-1 lg:pt-0 lg:pb-2">
          {title}
        </h3>
      ) : null}
      <div className="flex flex-col bg-surface lg:divide-y lg:divide-line lg:overflow-hidden lg:rounded-2xl lg:border lg:border-line">
        {children}
      </div>
      {footer ? (
        <div className="px-4 pt-1 pb-4 text-[13px] leading-relaxed text-muted lg:px-1 lg:pt-2 lg:pb-0">
          {footer}
        </div>
      ) : null}
    </section>
  );
}

export interface SettingsRowProps {
  icon?: IconType;
  title: ReactNode;
  /** Secondary line (current value or explanation). */
  description?: ReactNode;
  to?: string;
  onClick?: () => void;
  danger?: boolean;
  /** Right slot (replaces the chevron). */
  end?: ReactNode;
  chevron?: boolean;
  disabled?: boolean;
  active?: boolean;
  'aria-label'?: string;
  testId?: string;
}

/** A tappable settings row: [icon] title / description … value › */
export function SettingsRow({
  icon: Icon,
  title,
  description,
  to,
  onClick,
  danger,
  end,
  chevron = !!(to || onClick),
  disabled,
  active,
  testId,
  ...aria
}: SettingsRowProps) {
  const body = (
    <>
      {Icon ? (
        <Icon
          size={22}
          className={cn('shrink-0', danger ? 'text-danger' : 'text-muted')}
          aria-hidden
        />
      ) : null}
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className={cn('text-[16px] leading-snug', danger ? 'text-danger' : 'text-fg')}>
          {title}
        </span>
        {description ? (
          <span className="text-[13.5px] leading-snug text-muted">{description}</span>
        ) : null}
      </span>
      {end}
      {chevron && !end ? (
        <ChevronRight size={18} className="shrink-0 text-subtle" aria-hidden />
      ) : null}
    </>
  );
  const classes = cn(
    'flex min-h-14 w-full items-center gap-4 px-4 py-3 text-left transition-colors lg:px-5',
    (to || onClick) && !disabled && 'cursor-pointer hover:bg-hover focus-visible:bg-hover',
    'outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
    active && 'bg-selected',
    disabled && 'pointer-events-none opacity-50',
  );
  if (to && !disabled)
    return (
      <Link to={to} className={classes} aria-label={aria['aria-label']} data-testid={testId}>
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
        data-testid={testId}
      >
        {body}
      </button>
    );
  return (
    <div className={classes} data-testid={testId}>
      {body}
    </div>
  );
}

/** A settings row with a switch (the whole row toggles). */
export function SwitchRow({
  icon: Icon,
  title,
  description,
  checked,
  onChange,
  disabled,
}: {
  icon?: IconType;
  title: ReactNode;
  description?: ReactNode;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-4 px-4 lg:px-5">
      {Icon ? <Icon size={22} className="shrink-0 text-muted" aria-hidden /> : null}
      <Switch
        label={<span className="text-[16px]">{title}</span>}
        description={description}
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        className="min-h-14 flex-1"
      />
    </div>
  );
}

/** Explanatory paragraph inside a page. */
export function SettingsNote({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn('px-4 py-3 text-[13.5px] leading-relaxed text-muted lg:px-1', className)}>
      {children}
    </p>
  );
}

/** Large centered header (illustration + text) at the top of some pages. */
export function SettingsHero({
  icon: Icon,
  title,
  children,
}: {
  icon: IconType;
  title: ReactNode;
  children?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-8 text-center lg:py-4">
      <div className="relative">
        <div className="absolute inset-0 scale-150 rounded-full bg-brand/10 blur-2xl" aria-hidden />
        <div className="relative flex size-20 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
          <Icon size={36} strokeWidth={1.6} nonScalingStroke={false} aria-hidden />
        </div>
      </div>
      <h2 className="text-lg font-semibold text-fg">{title}</h2>
      {children ? (
        <div className="max-w-md text-[14px] leading-relaxed text-muted">{children}</div>
      ) : null}
    </div>
  );
}
