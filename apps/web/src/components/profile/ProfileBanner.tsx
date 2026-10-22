import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface ProfileBannerProps {
  /** The banner image to show now (animated or its poster); none = the solid colour. */
  src?: string | null;
  /** Fill behind (and without) the image: the profile colour, else the brand colour. */
  color: string;
  height: number;
  className?: string;
  /** Overlaid on the banner (e.g. the popout's top-right buttons). */
  children?: ReactNode;
  'data-testid'?: string;
}

/** A profile banner: the uploaded image, or the profile colour as a solid strip. */
export function ProfileBanner({ src, color, height, className, children, ...rest }: ProfileBannerProps) {
  return (
    <div
      className={cn('relative w-full shrink-0 overflow-hidden', className)}
      style={{ height, background: color }}
      data-testid={rest['data-testid']}
    >
      {src ? <img src={src} alt="" className="size-full object-cover" draggable={false} /> : null}
      {children}
    </div>
  );
}
