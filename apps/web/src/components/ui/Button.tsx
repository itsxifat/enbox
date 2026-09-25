import type { ComponentPropsWithRef, ComponentType, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Spinner } from './Spinner';

/** Props every icon component used with the kit must accept (lucide icons fit). */
export interface IconProps {
  className?: string;
  size?: number | string;
  strokeWidth?: number | string;
  'aria-hidden'?: boolean | 'true' | 'false';
}
export type IconType = ComponentType<IconProps>;

export type ButtonVariant = 'primary' | 'secondary' | 'soft' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand shadow-sm hover:bg-brand-strong active:brightness-95',
  secondary: 'bg-surface-2 text-fg hover:bg-line active:bg-line-strong',
  soft: 'bg-brand-soft text-brand-ink hover:brightness-[0.97] dark:hover:brightness-110',
  outline: 'border border-line-strong bg-transparent text-brand-ink hover:bg-hover',
  ghost: 'bg-transparent text-fg hover:bg-hover',
  danger: 'bg-danger-fill text-white shadow-sm hover:brightness-110 active:brightness-95',
};

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3.5 text-sm',
  md: 'h-10 gap-2 px-5 text-[15px]',
  lg: 'h-12 gap-2 px-6 text-base',
};

const ICON_SIZES: Record<ButtonSize, number> = { sm: 16, md: 18, lg: 20 };

/** Class string for button-looking elements (e.g. a react-router `<Link>`). */
export function buttonClasses(
  variant: ButtonVariant = 'primary',
  size: ButtonSize = 'md',
  fullWidth = false,
): string {
  return cn(
    'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold whitespace-nowrap',
    'transition-[background-color,color,filter,box-shadow] duration-150',
    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
    'disabled:pointer-events-none disabled:opacity-50',
    VARIANTS[variant],
    SIZES[size],
    fullWidth && 'w-full',
  );
}

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Shows a spinner, disables the button and sets aria-busy. */
  loading?: boolean;
  leftIcon?: IconType;
  rightIcon?: IconType;
  fullWidth?: boolean;
  children?: ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  leftIcon: Left,
  rightIcon: Right,
  fullWidth,
  className,
  disabled,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  const iconSize = ICON_SIZES[size];
  return (
    <button
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonClasses(variant, size, fullWidth), className)}
      {...rest}
    >
      {loading ? (
        <Spinner size={iconSize} label={null} />
      ) : Left ? (
        <Left size={iconSize} aria-hidden />
      ) : null}
      {children}
      {Right && !loading ? <Right size={iconSize} aria-hidden /> : null}
    </button>
  );
}

export type IconButtonVariant = 'ghost' | 'solid' | 'brand' | 'danger' | 'success' | 'glass';
export type IconButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const ICON_BTN_VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'text-muted hover:bg-hover hover:text-fg',
  solid: 'bg-surface-2 text-fg hover:bg-line',
  brand: 'bg-brand text-on-brand shadow-sm hover:bg-brand-strong',
  danger: 'bg-danger-fill text-white shadow-sm hover:brightness-110',
  success: 'bg-success text-white shadow-sm hover:brightness-110',
  /** Translucent, for use over media / call video. */
  glass: 'bg-black/35 text-white backdrop-blur hover:bg-black/50',
};

const ICON_BTN_SIZES: Record<IconButtonSize, { box: string; icon: number }> = {
  xs: { box: 'size-7', icon: 16 },
  sm: { box: 'size-8', icon: 18 },
  md: { box: 'size-10', icon: 22 },
  lg: { box: 'size-12', icon: 24 },
  xl: { box: 'size-16', icon: 28 },
};

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  icon: IconType;
  /** Accessible name; also shown as the native tooltip. */
  label: string;
  variant?: IconButtonVariant;
  size?: IconButtonSize;
  /** Pressed/selected look (e.g. toggles, the open menu's trigger). */
  active?: boolean;
  loading?: boolean;
  /** Hide the native tooltip (e.g. when a visible label sits next to it). */
  noTooltip?: boolean;
  /** Optional badge/dot rendered at the top-right corner. */
  badge?: ReactNode;
  /** circle (default) or rounded square (floating action buttons). */
  shape?: 'circle' | 'square';
}

export function IconButton({
  icon: Icon,
  label,
  variant = 'ghost',
  size = 'md',
  active,
  loading,
  noTooltip,
  badge,
  shape = 'circle',
  className,
  disabled,
  type = 'button',
  ...rest
}: IconButtonProps) {
  const s = ICON_BTN_SIZES[size];
  return (
    <button
      type={type}
      aria-label={label}
      title={noTooltip ? undefined : label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(
        'relative inline-flex shrink-0 items-center justify-center transition-colors duration-150',
        shape === 'square' ? 'rounded-2xl' : 'rounded-full',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        'disabled:pointer-events-none disabled:opacity-45',
        s.box,
        ICON_BTN_VARIANTS[variant],
        active && variant === 'ghost' && 'bg-hover text-fg',
        className,
      )}
      {...rest}
    >
      {loading ? (
        <Spinner size={s.icon - 2} label={null} />
      ) : (
        <Icon size={s.icon} strokeWidth={1.9} aria-hidden />
      )}
      {badge ? (
        <span className="pointer-events-none absolute -top-0.5 -right-0.5">{badge}</span>
      ) : null}
    </button>
  );
}
