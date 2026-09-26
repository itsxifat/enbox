import { forwardRef, useId, type ReactNode } from 'react';
import { useLucideContext, type LucideIcon, type LucideProps } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface IconRenderContext {
  /** Unique, CSS-safe id prefix for this instance (masks, gradients). */
  uid: string;
  /** Effective stroke width in viewBox units (after `absoluteStrokeWidth`). */
  sw: number;
}

/**
 * Builds an Enbox icon that behaves exactly like a lucide icon: same props, same 24-unit
 * grid, and the same defaults from `<LucideProvider>` (size, stroke width, absolute stroke),
 * so custom and lucide glyphs render with an identical line weight side by side.
 *
 * `render` returns the SVG children. Outline parts inherit the root stroke; filled parts set
 * `fill="currentColor"` (plus the root stroke, so their silhouette matches the outline
 * version). Cut-outs use a mask keyed by `uid`.
 */
export function createIcon(name: string, render: (ctx: IconRenderContext) => ReactNode) {
  const Icon = forwardRef<SVGSVGElement, LucideProps>(function EnboxIcon(
    { size, strokeWidth, absoluteStrokeWidth, nonScalingStroke, color, className, ...rest },
    ref,
  ) {
    const ctx = useLucideContext() ?? {};
    const px = Number(size ?? ctx.size ?? 24);
    const stroke = Number(strokeWidth ?? ctx.strokeWidth ?? 2);
    const absolute =
      absoluteStrokeWidth ?? nonScalingStroke ?? ctx.absoluteStrokeWidth ?? ctx.nonScalingStroke;
    const sw = absolute ? (stroke * 24) / px : stroke;
    const uid = `ei${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    const labelled = Object.keys(rest).some(
      (k) => k === 'aria-label' || k === 'aria-labelledby' || k === 'title' || k === 'role',
    );
    return (
      <svg
        ref={ref}
        xmlns="http://www.w3.org/2000/svg"
        width={px}
        height={px}
        viewBox="0 0 24 24"
        fill="none"
        stroke={color ?? ctx.color ?? 'currentColor'}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={cn('lucide', `lucide-${name}`, ctx.className, className)}
        aria-hidden={labelled ? undefined : true}
        {...rest}
      >
        {render({ uid, sw })}
      </svg>
    );
  });
  Icon.displayName = name;
  return Icon as LucideIcon;
}
