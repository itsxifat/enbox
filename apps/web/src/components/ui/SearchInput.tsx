import { useRef, type ComponentPropsWithRef } from 'react';
import { ArrowLeft, Search, X } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SearchInputProps extends Omit<
  ComponentPropsWithRef<'input'>,
  'onChange' | 'value' | 'type'
> {
  value: string;
  onChange: (value: string) => void;
  /** When provided, a back arrow replaces the search icon while focused/non-empty (WhatsApp style). */
  onBack?: () => void;
  className?: string;
}

/** Pill search field with clear button. Escape clears (then blurs). */
export function SearchInput({
  value,
  onChange,
  onBack,
  className,
  placeholder = 'Search',
  onKeyDown,
  ref,
  ...rest
}: SearchInputProps) {
  const inner = useRef<HTMLInputElement | null>(null);
  const active = value.length > 0;
  return (
    <div
      className={cn(
        'group relative flex h-10 items-center rounded-full bg-surface-2 transition-shadow duration-150',
        'focus-within:ring-2 focus-within:ring-brand/30',
        className,
      )}
    >
      {onBack && active ? (
        <button
          type="button"
          aria-label="Back"
          onClick={() => {
            onChange('');
            onBack();
          }}
          className="absolute left-1.5 flex size-7 items-center justify-center rounded-full text-brand-ink hover:bg-hover"
        >
          <ArrowLeft size={18} aria-hidden />
        </button>
      ) : (
        <Search
          size={17}
          strokeWidth={2}
          className="pointer-events-none absolute left-3.5 text-subtle group-focus-within:text-brand-ink"
          aria-hidden
        />
      )}
      <input
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type="search"
        role="searchbox"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            if (value) {
              e.stopPropagation();
              onChange('');
            } else inner.current?.blur();
          }
          onKeyDown?.(e);
        }}
        className="h-full w-full min-w-0 appearance-none bg-transparent pr-9 pl-10 text-[15px] text-fg outline-none placeholder:text-subtle [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {active ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            onChange('');
            inner.current?.focus();
          }}
          className="absolute right-1.5 flex size-7 items-center justify-center rounded-full text-muted hover:bg-hover hover:text-fg"
        >
          <X size={16} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
