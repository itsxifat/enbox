import type { ReactNode } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SelectRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  leading: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  disabled?: boolean;
}

/** A multi-select list row (whole row is the checkbox label), WhatsApp picker style. */
export function SelectRow({
  checked,
  onChange,
  leading,
  title,
  subtitle,
  disabled,
}: SelectRowProps) {
  return (
    <label
      className={cn(
        'flex w-full items-center gap-3 px-5 py-2 transition-colors duration-100',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-hover',
        'has-[:focus-visible]:bg-hover',
      )}
    >
      <span className="shrink-0">{leading}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-medium text-fg">{title}</span>
        {subtitle ? (
          <span className="block truncate text-[13px] text-muted">{subtitle}</span>
        ) : null}
      </span>
      <input
        type="checkbox"
        className="peer sr-only"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span
        aria-hidden
        className={cn(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand',
          checked ? 'border-brand bg-brand text-on-brand' : 'border-line-strong',
        )}
      >
        {checked ? <Check size={12} strokeWidth={3.5} /> : null}
      </span>
    </label>
  );
}
