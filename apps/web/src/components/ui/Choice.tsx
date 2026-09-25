import { useId, useRef, useEffect, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Switch
// ---------------------------------------------------------------------------

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Visible label: renders a full-width settings row (label left, switch right). */
  label?: ReactNode;
  description?: ReactNode;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  disabled?: boolean;
  className?: string;
  id?: string;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  disabled,
  className,
  id,
  ...aria
}: SwitchProps) {
  const autoId = useId();
  const switchId = id ?? autoId;
  const control = (
    <button
      id={switchId}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : aria['aria-label']}
      aria-labelledby={label ? `${switchId}-label` : undefined}
      aria-describedby={description ? `${switchId}-desc` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-200',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:opacity-50',
        checked ? 'bg-brand' : 'bg-line-strong',
      )}
    >
      <span
        className={cn(
          'inline-block size-5 rounded-full bg-white shadow-sm transition-transform duration-200',
          checked ? 'translate-x-[18px]' : 'translate-x-0.5',
        )}
      />
    </button>
  );
  if (!label) return <span className={className}>{control}</span>;
  return (
    <div className={cn('flex items-center justify-between gap-4 py-3', className)}>
      <div className="min-w-0 flex-1">
        <label
          id={`${switchId}-label`}
          htmlFor={switchId}
          className="block cursor-pointer text-[15px] text-fg"
        >
          {label}
        </label>
        {description ? (
          <p id={`${switchId}-desc`} className="mt-0.5 text-[13px] leading-snug text-muted">
            {description}
          </p>
        ) : null}
      </div>
      {control}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checkbox
// ---------------------------------------------------------------------------

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  description?: ReactNode;
  indeterminate?: boolean;
  disabled?: boolean;
  /** Round style (multi-select pickers, like WhatsApp's contact picker). */
  round?: boolean;
  className?: string;
  'aria-label'?: string;
  id?: string;
}

export function Checkbox({
  checked,
  onChange,
  label,
  description,
  indeterminate,
  disabled,
  round,
  className,
  id,
  ...aria
}: CheckboxProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = !!indeterminate;
  }, [indeterminate]);
  const on = checked || indeterminate;
  return (
    <label
      htmlFor={inputId}
      className={cn(
        'inline-flex cursor-pointer items-start gap-3',
        disabled && 'cursor-not-allowed opacity-50',
        className,
      )}
    >
      <span className="relative mt-0.5 inline-flex size-5 shrink-0">
        <input
          ref={ref}
          id={inputId}
          type="checkbox"
          checked={checked}
          disabled={disabled}
          aria-label={label ? undefined : aria['aria-label']}
          onChange={(e) => onChange(e.target.checked)}
          className={cn(
            'peer size-5 appearance-none border-2 transition-colors duration-150',
            round ? 'rounded-full' : 'rounded-md',
            on ? 'border-brand bg-brand' : 'border-line-strong bg-surface',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
          )}
        />
        {on ? (
          indeterminate ? (
            <Minus
              size={14}
              strokeWidth={3}
              className="pointer-events-none absolute inset-0 m-auto text-on-brand"
              aria-hidden
            />
          ) : (
            <Check
              size={14}
              strokeWidth={3}
              className="pointer-events-none absolute inset-0 m-auto text-on-brand"
              aria-hidden
            />
          )
        ) : null}
      </span>
      {label || description ? (
        <span className="min-w-0">
          {label ? <span className="block text-[15px] text-fg">{label}</span> : null}
          {description ? (
            <span className="mt-0.5 block text-[13px] text-muted">{description}</span>
          ) : null}
        </span>
      ) : null}
    </label>
  );
}

// ---------------------------------------------------------------------------
// RadioGroup
// ---------------------------------------------------------------------------

export interface RadioOption<T extends string> {
  value: T;
  label: ReactNode;
  description?: ReactNode;
  disabled?: boolean;
}

export interface RadioGroupProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  /** Visible group label (legend). */
  label?: ReactNode;
  /** Accessible name when there is no visible label. */
  'aria-label'?: string;
  name?: string;
  className?: string;
}

export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  label,
  name,
  className,
  ...aria
}: RadioGroupProps<T>) {
  const autoName = useId();
  const groupName = name ?? autoName;
  return (
    <fieldset
      className={cn('flex flex-col', className)}
      aria-label={label ? undefined : aria['aria-label']}
    >
      {label ? <legend className="mb-1 text-sm font-medium text-muted">{label}</legend> : null}
      {options.map((opt) => {
        const id = `${groupName}-${opt.value}`;
        const selected = opt.value === value;
        return (
          <label
            key={opt.value}
            htmlFor={id}
            className={cn(
              'flex cursor-pointer items-start gap-3.5 rounded-xl px-1 py-2.5',
              opt.disabled && 'cursor-not-allowed opacity-50',
            )}
          >
            <span className="relative mt-0.5 inline-flex size-5 shrink-0">
              <input
                id={id}
                type="radio"
                name={groupName}
                value={opt.value}
                checked={selected}
                disabled={opt.disabled}
                onChange={() => onChange(opt.value)}
                className={cn(
                  'peer size-5 appearance-none rounded-full border-2 transition-colors',
                  selected ? 'border-brand' : 'border-line-strong',
                  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
                )}
              />
              {selected ? (
                <span className="pointer-events-none absolute inset-[5px] rounded-full bg-brand" />
              ) : null}
            </span>
            <span className="min-w-0">
              <span className="block text-[15px] text-fg">{opt.label}</span>
              {opt.description ? (
                <span className="mt-0.5 block text-[13px] text-muted">{opt.description}</span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
