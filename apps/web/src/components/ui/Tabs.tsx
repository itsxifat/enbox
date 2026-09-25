import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Badge } from './Badge';

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** Unread-style count badge next to the label. */
  count?: number;
  disabled?: boolean;
}

export interface TabsProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  items: TabItem<T>[];
  /**
   * - `underline`: full-width tabs with an indicator (media/docs/links, section tabs)
   * - `chips`: rounded filter chips (All / Unread / Groups)
   */
  variant?: 'underline' | 'chips';
  'aria-label'?: string;
  className?: string;
  /** Prefix for tab/panel ids: tab = `${idBase}-tab-${value}`, panel = `${idBase}-panel-${value}`. */
  idBase?: string;
}

/** Accessible tablist (roving focus with ←/→/Home/End). Render the panel yourself. */
export function Tabs<T extends string>({
  value,
  onChange,
  items,
  variant = 'underline',
  className,
  idBase,
  ...aria
}: TabsProps<T>) {
  const listRef = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = items.filter((i) => !i.disabled);
    const idx = enabled.findIndex((i) => i.value === value);
    let next: TabItem<T> | undefined;
    if (e.key === 'ArrowRight') next = enabled[(idx + 1) % enabled.length];
    else if (e.key === 'ArrowLeft') next = enabled[(idx - 1 + enabled.length) % enabled.length];
    else if (e.key === 'Home') next = enabled[0];
    else if (e.key === 'End') next = enabled[enabled.length - 1];
    if (!next) return;
    e.preventDefault();
    onChange(next.value);
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLButtonElement>(`[data-value="${CSS.escape(next.value)}"]`)
        ?.focus(),
    );
  };

  return (
    <div
      ref={listRef}
      role="tablist"
      aria-label={aria['aria-label']}
      onKeyDown={onKeyDown}
      className={cn(
        variant === 'underline'
          ? 'flex border-b border-line'
          : 'flex gap-2 overflow-x-auto scrollbar-none',
        className,
      )}
    >
      {items.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            data-value={item.value}
            id={idBase ? `${idBase}-tab-${item.value}` : undefined}
            aria-controls={idBase ? `${idBase}-panel-${item.value}` : undefined}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onChange(item.value)}
            className={cn(
              'inline-flex shrink-0 items-center justify-center gap-1.5 text-[14px] font-medium whitespace-nowrap transition-colors duration-150',
              'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:opacity-45',
              variant === 'underline'
                ? cn(
                    'relative h-11 flex-1 px-3',
                    selected ? 'text-brand-ink' : 'text-muted hover:text-fg',
                    selected &&
                      'after:absolute after:inset-x-3 after:bottom-0 after:h-[3px] after:rounded-t-full after:bg-brand',
                  )
                : cn(
                    'h-8 rounded-full px-3.5',
                    selected
                      ? 'bg-brand-soft text-brand-ink'
                      : 'bg-surface-2 text-muted hover:bg-line hover:text-fg',
                  ),
            )}
          >
            {item.label}
            {item.count ? (
              <Badge count={item.count} tone={selected ? 'brand' : 'muted'} size="sm" />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
