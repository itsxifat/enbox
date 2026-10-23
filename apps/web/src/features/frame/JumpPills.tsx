/**
 * "NEW UNREADS" / "NEW MENTIONS" pills over a scrolling list (the channel sidebar, the Space
 * rail): rows marked `data-jump="mention" | "unread"` that are scrolled out of view above or
 * below show a pill on that edge; clicking it brings the nearest one into view.
 */
import { useCallback, useEffect, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';

export type JumpKind = 'mention' | 'unread';
export type JumpSide = 'top' | 'bottom';

export interface JumpBox {
  top: number;
  bottom: number;
  kind: JumpKind;
}

export interface Offscreen {
  above: JumpKind | null;
  below: JumpKind | null;
}

const NONE: Offscreen = { above: null, below: null };

/** Mentions win over unreads. */
const stronger = (a: JumpKind | null, b: JumpKind): JumpKind => (a === 'mention' ? a : b);

/** What is out of view above and below `view`: the strongest kind on each side (pure). */
export function offscreenJumps(view: { top: number; bottom: number }, boxes: readonly JumpBox[]): Offscreen {
  let above: JumpKind | null = null;
  let below: JumpKind | null = null;
  for (const b of boxes) {
    if (b.bottom <= view.top) above = stronger(above, b.kind);
    else if (b.top >= view.bottom) below = stronger(below, b.kind);
  }
  return above || below ? { above, below } : NONE;
}

/** The marked row of `kind` nearest to the view on `side`, out of view. */
function nearest(scroller: HTMLElement, side: JumpSide, kind: JumpKind): HTMLElement | null {
  const view = scroller.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let gap = Infinity;
  for (const el of scroller.querySelectorAll<HTMLElement>(`[data-jump="${kind}"]`)) {
    const r = el.getBoundingClientRect();
    const d = side === 'top' ? view.top - r.bottom : r.top - view.bottom;
    if (d >= 0 && d < gap) {
      best = el;
      gap = d;
    }
  }
  return best;
}

/** What is out of view in `scroller` now (nothing while it isn't laid out). */
function measure(scroller: HTMLElement): Offscreen {
  const view = scroller.getBoundingClientRect();
  if (view.height <= 0) return NONE;
  return offscreenJumps(
    view,
    Array.from(scroller.querySelectorAll<HTMLElement>('[data-jump]'), (row) => {
      const r = row.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, kind: row.dataset.jump as JumpKind };
    }),
  );
}

/**
 * Watch the marked rows of a scroller (pass `ref` to it): measured when it mounts, then on
 * scroll, resize and whenever rows or their marks change (one measure per frame).
 */
export function useJumpPills(): Offscreen & {
  ref: (el: HTMLElement | null) => void;
  jump(side: JumpSide): void;
} {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  const [state, setState] = useState<Offscreen>(NONE);
  const reduced = useReducedMotion();

  useEffect(() => {
    const update = () => {
      const next = scroller ? measure(scroller) : NONE;
      setState((cur) => (cur.above === next.above && cur.below === next.below ? cur : next));
    };
    update();
    if (!scroller) return;
    let frame = 0;
    const later = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          update();
        });
    };
    scroller.addEventListener('scroll', later, { passive: true });
    const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(later);
    resize?.observe(scroller);
    const changes = new MutationObserver(later);
    changes.observe(scroller, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-jump'] });
    return () => {
      scroller.removeEventListener('scroll', later);
      resize?.disconnect();
      changes.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [scroller]);

  const jump = useCallback(
    (side: JumpSide) => {
      const kind = side === 'top' ? state.above : state.below;
      if (!scroller || !kind) return;
      nearest(scroller, side, kind)?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
    },
    [scroller, state, reduced],
  );

  return { ...state, ref: setScroller, jump };
}

const TEXT: Record<JumpKind, string> = { mention: 'New mentions', unread: 'New unreads' };

/**
 * A pill on the top or bottom edge of a `relative` box around the scroller. `compact` (the
 * 72px rail): mentions only, on two lines.
 */
export function JumpPill({
  side,
  kind,
  onJump,
  compact = false,
}: {
  side: JumpSide;
  kind: JumpKind | null;
  onJump: (side: JumpSide) => void;
  compact?: boolean;
}) {
  if (!kind) return null;
  const Arrow = side === 'top' ? ArrowUp : ArrowDown;
  return (
    <button
      type="button"
      onClick={() => onJump(side)}
      aria-label={`${TEXT[kind]} ${side === 'top' ? 'above' : 'below'}`}
      className={cn(
        'absolute left-1/2 z-10 flex -translate-x-1/2 animate-fade-in items-center gap-1 rounded-full font-bold tracking-wide whitespace-nowrap uppercase shadow-elevated focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand',
        side === 'top' ? 'top-2' : 'bottom-2',
        kind === 'mention' ? 'bg-danger-fill text-white' : 'bg-brand text-on-brand',
        compact ? 'flex-col gap-0 rounded-[10px] px-1.5 py-1 text-[9px] leading-[1.15]' : 'px-3 py-1 text-[11px]',
      )}
      data-testid={`jump-pill-${side}`}
      data-kind={kind}
    >
      {compact ? (
        <>
          <span>New</span>
          <span>mentions</span>
        </>
      ) : (
        <>
          <Arrow size={12} strokeWidth={2.5} aria-hidden />
          {TEXT[kind]}
        </>
      )}
    </button>
  );
}
