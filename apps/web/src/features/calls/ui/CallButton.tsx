import type { ComponentPropsWithRef } from 'react';
import { ICON_STROKE_ON_FILL } from '@/components/icons';
import type { IconType } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface CallButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  icon: IconType;
  label: string;
  /** Visible caption under the button (phones / incoming screen). */
  caption?: string;
  /** glass (default, over video), light (toggled on: white with dark icon), danger, success. */
  tone?: 'glass' | 'ghost' | 'light' | 'danger' | 'success';
  size?: 'md' | 'lg' | 'xl';
  /** Pill shape (the end-call button). */
  wide?: boolean;
  pressed?: boolean;
}

const SIZES = {
  md: { box: 'size-12', wide: 'h-12 w-16', icon: 22 },
  lg: { box: 'size-14', wide: 'h-14 w-[72px]', icon: 24 },
  xl: { box: 'size-16', wide: 'h-16 w-20', icon: 28 },
} as const;

const TONES = {
  glass: 'bg-white/14 text-white hover:bg-white/24 backdrop-blur-md',
  ghost: 'bg-transparent text-white hover:bg-white/10',
  light: 'bg-white text-[#15141c] hover:bg-white/90',
  danger: 'bg-[#ef4444] text-white hover:bg-[#dc2626] shadow-lg shadow-red-900/30',
  success: 'bg-[#22c55e] text-white hover:bg-[#16a34a] shadow-lg shadow-green-900/30',
} as const;

/** Round call control (mute, camera, end…). Always on the dark call surface. */
export function CallButton({
  icon: Icon,
  label,
  caption,
  tone = 'glass',
  size = 'lg',
  wide,
  pressed,
  className,
  type = 'button',
  ...rest
}: CallButtonProps) {
  const s = SIZES[size];
  const button = (
    <button
      type={type}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150 active:scale-95',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        'disabled:pointer-events-none disabled:opacity-40',
        wide ? s.wide : s.box,
        TONES[tone],
        !caption && className,
      )}
      {...rest}
    >
      <Icon size={s.icon} strokeWidth={ICON_STROKE_ON_FILL} aria-hidden />
    </button>
  );
  if (!caption) return button;
  return (
    <div className={cn('flex flex-col items-center gap-2', className)}>
      {button}
      <span className="text-[13px] font-medium text-white/80" aria-hidden>
        {caption}
      </span>
    </div>
  );
}
