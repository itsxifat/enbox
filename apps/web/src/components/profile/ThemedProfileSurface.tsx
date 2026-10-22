import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '@/lib/cn';
import type { ProfileTheme } from './theme';

export interface ThemedProfileSurfaceProps extends HTMLAttributes<HTMLDivElement> {
  /** `profileTheme(...)`; null = the app's own elevated surface. */
  theme: ProfileTheme | null;
  children: ReactNode;
}

/**
 * The root of a profile surface (popout, full profile): the primary → accent gradient with
 * the theme's ink tokens, or the plain elevated surface without a theme. `data-themed` says
 * which ink the theme chose.
 */
export function ThemedProfileSurface({
  theme,
  className,
  style,
  children,
  ...rest
}: ThemedProfileSurfaceProps) {
  return (
    <div
      {...rest}
      data-themed={theme ? theme.ink : undefined}
      className={cn(
        'relative isolate flex flex-col overflow-hidden text-left text-fg',
        !theme && 'bg-elevated',
        className,
      )}
      style={{ ...(theme ? { background: theme.background, ...theme.vars } : null), ...style }}
    >
      {children}
    </div>
  );
}

/** The inner panel below the banner: veils a themed gradient so the ink keeps its contrast. */
export function ProfilePanel({
  theme,
  className,
  children,
}: {
  theme: ProfileTheme | null;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={cn('relative flex min-h-0 flex-1 flex-col', className)}
      style={theme ? { background: theme.panel } : undefined}
    >
      {children}
    </div>
  );
}

/** The ring colour around the avatar (and the status bubble's fill) on this surface. */
export function surfaceRing(theme: ProfileTheme | null): string {
  return theme ? theme.ring : 'var(--elevated)';
}
