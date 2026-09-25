import { useId, useLayoutEffect, useRef, type ComponentPropsWithRef, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { IconType } from './Button';

export interface FieldProps {
  label?: ReactNode;
  /** Error message (sets aria-invalid on the control via the render prop ids). */
  error?: ReactNode;
  hint?: ReactNode;
  /** id of the control the label points to. */
  htmlFor?: string;
  className?: string;
  children: ReactNode;
  /** Right side of the label row (e.g. "Forgot password?" link or a counter). */
  aside?: ReactNode;
}

/** Label + control + hint/error layout. `Input`/`Textarea` render this for you when given `label`. */
export function Field({ label, error, hint, htmlFor, className, children, aside }: FieldProps) {
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      {label || aside ? (
        <div className="flex items-baseline justify-between gap-2">
          {label ? (
            <label htmlFor={htmlFor} className="text-sm font-medium text-fg">
              {label}
            </label>
          ) : (
            <span />
          )}
          {aside ? <span className="text-xs text-muted">{aside}</span> : null}
        </div>
      ) : null}
      {children}
      {error ? (
        <p
          id={htmlFor ? `${htmlFor}-error` : undefined}
          role="alert"
          className="text-[13px] text-danger"
        >
          {error}
        </p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-[13px] text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const controlBase = cn(
  'w-full text-[15px] text-fg transition-[border-color,box-shadow,background-color] duration-150',
  'placeholder:text-subtle focus:outline-none focus-visible:outline-none',
  'disabled:cursor-not-allowed disabled:opacity-60',
);

/**
 * - `outline` (default): bordered form field
 * - `filled`: borderless pill on `surface-2` (composers, inline search) — use this instead of
 *   overriding border/background/radius through className (there is no tailwind-merge).
 */
export type ControlVariant = 'outline' | 'filled';

function controlClasses(variant: ControlVariant, error: boolean): string {
  if (variant === 'filled') {
    return cn(
      'rounded-3xl border border-transparent bg-surface-2 focus:bg-surface focus:ring-2',
      error ? 'focus:ring-danger/30' : 'focus:ring-brand/30',
    );
  }
  return cn(
    'rounded-xl border bg-surface focus:ring-3',
    error
      ? 'border-danger focus:border-danger focus:ring-danger/20'
      : 'border-line-strong focus:border-brand focus:ring-brand/20',
  );
}

export interface InputProps extends ComponentPropsWithRef<'input'> {
  label?: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  leftIcon?: IconType;
  /** Content inside the right edge (e.g. a show-password IconButton). */
  rightSlot?: ReactNode;
  /** Text prefix inside the field (e.g. "@"). */
  prefix?: string;
  variant?: ControlVariant;
  containerClassName?: string;
}

export function Input({
  label,
  error,
  hint,
  aside,
  leftIcon: Left,
  rightSlot,
  prefix,
  variant = 'outline',
  id,
  className,
  containerClassName,
  ...rest
}: InputProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined;
  const control = (
    <div className="relative flex items-center">
      {Left ? (
        <Left size={18} className="pointer-events-none absolute left-3.5 text-subtle" aria-hidden />
      ) : null}
      {prefix ? (
        <span className="pointer-events-none absolute left-3.5 text-[15px] text-muted" aria-hidden>
          {prefix}
        </span>
      ) : null}
      <input
        id={inputId}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cn(
          controlBase,
          controlClasses(variant, !!error),
          'h-11 px-3.5',
          Left ? 'pl-10' : prefix ? (prefix.length === 1 ? 'pl-8' : 'pl-12') : undefined,
          rightSlot ? 'pr-11' : undefined,
          className,
        )}
        {...rest}
      />
      {rightSlot ? <div className="absolute right-1 flex items-center">{rightSlot}</div> : null}
    </div>
  );
  if (!label && !error && !hint && !aside)
    return <div className={containerClassName}>{control}</div>;
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      aside={aside}
      htmlFor={inputId}
      className={containerClassName}
    >
      {control}
    </Field>
  );
}

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  label?: ReactNode;
  error?: ReactNode;
  hint?: ReactNode;
  aside?: ReactNode;
  /** Grow with content up to `maxRows` (default 6). */
  autoResize?: boolean;
  maxRows?: number;
  variant?: ControlVariant;
  containerClassName?: string;
}

export function Textarea({
  label,
  error,
  hint,
  aside,
  autoResize = false,
  maxRows = 6,
  variant = 'outline',
  id,
  className,
  containerClassName,
  ref,
  onInput,
  ...rest
}: TextareaProps) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);
  const value = rest.value;

  const resize = () => {
    const el = innerRef.current;
    if (!autoResize || !el) return;
    const cs = getComputedStyle(el);
    const line = parseFloat(cs.lineHeight) || 20;
    const padding = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const border = parseFloat(cs.borderTopWidth) + parseFloat(cs.borderBottomWidth);
    const max = line * maxRows + padding + border;
    el.style.height = 'auto';
    const wanted = el.scrollHeight + border;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? 'auto' : 'hidden';
  };

  // Re-measure when the controlled value or limits change.
  useLayoutEffect(resize, [autoResize, maxRows, value]);

  const setRef = (el: HTMLTextAreaElement | null) => {
    innerRef.current = el;
    if (typeof ref === 'function') ref(el);
    else if (ref) ref.current = el;
  };

  const control = (
    <textarea
      id={inputId}
      ref={setRef}
      rows={rest.rows ?? (autoResize ? 1 : 3)}
      aria-invalid={error ? true : undefined}
      aria-describedby={error ? `${inputId}-error` : hint ? `${inputId}-hint` : undefined}
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
      className={cn(
        controlBase,
        controlClasses(variant, !!error),
        'resize-none px-3.5 py-2.5 leading-snug',
        className,
      )}
      {...rest}
    />
  );
  if (!label && !error && !hint && !aside)
    return <div className={containerClassName}>{control}</div>;
  return (
    <Field
      label={label}
      error={error}
      hint={hint}
      aside={aside}
      htmlFor={inputId}
      className={containerClassName}
    >
      {control}
    </Field>
  );
}
