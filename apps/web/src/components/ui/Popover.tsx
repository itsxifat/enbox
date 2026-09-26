/**
 * Anchored popover (portal, fixed, z-[60]): `placement` top/bottom/left/right with a flip to
 * the opposite side when there is no room and a clamp to the viewport; `align` sets the
 * cross-axis alignment against an element anchor. Closes on outside pointer (a menu or dialog
 * opened from inside it is not outside), Escape (top-most overlay only) and resize. Used by the
 * emoji picker, quick reactions, the attach menu and the profile card.
 *
 *   <Popover open={!!anchor} anchor={anchor} onClose={close} placement="right" aria-label="Profile">
 *     …
 *   </Popover>
 *
 * Focus: moves into the popover once it is positioned (unless its content already took focus,
 * e.g. the emoji picker's search), Tab stays inside, and closing returns focus to where it was
 * (the trigger) when it was still inside the popover.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Portal, focusableIn, isInOverlayAbove, useOverlay } from './overlay';

const MARGIN = 8;
const GAP = 6;

export type PopoverAnchor = HTMLElement | { x: number; y: number };
export type PopoverPlacement = 'top' | 'bottom' | 'left' | 'right';
export type PopoverAlign = 'start' | 'center' | 'end';

export interface PopoverProps {
  open: boolean;
  /** Element or viewport point; the popover is hidden while null. */
  anchor: PopoverAnchor | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Preferred side; flips to the opposite side when it does not fit (default 'top'). */
  placement?: PopoverPlacement;
  /** Cross-axis alignment against the anchor (default 'center'). */
  align?: PopoverAlign;
  'aria-label'?: string;
}

interface Rect {
  left: number;
  right: number;
  top: number;
  bottom: number;
  width: number;
  height: number;
}

/** Pure placement: the popover's fixed position and the side it ended up on. */
export function placePopover(
  anchor: Rect,
  box: { width: number; height: number },
  viewport: { width: number; height: number },
  placement: PopoverPlacement,
  align: PopoverAlign,
): { top: number; left: number; placement: PopoverPlacement } {
  const r = anchor;
  const vw = viewport.width;
  const vh = viewport.height;
  let side = placement;
  let top: number;
  let left: number;
  if (side === 'top' || side === 'bottom') {
    if (side === 'top') {
      top = r.top - box.height - GAP;
      if (top < MARGIN) {
        side = 'bottom';
        top = r.bottom + GAP;
      }
    } else {
      top = r.bottom + GAP;
      if (top + box.height > vh - MARGIN) {
        side = 'top';
        top = r.top - box.height - GAP;
      }
    }
    left =
      align === 'start'
        ? r.left
        : align === 'end'
          ? r.right - box.width
          : r.left + r.width / 2 - box.width / 2;
  } else {
    if (side === 'left') {
      left = r.left - box.width - GAP;
      if (left < MARGIN) {
        side = 'right';
        left = r.right + GAP;
      }
    } else {
      left = r.right + GAP;
      if (left + box.width > vw - MARGIN) {
        side = 'left';
        left = r.left - box.width - GAP;
      }
    }
    top =
      align === 'start'
        ? r.top
        : align === 'end'
          ? r.bottom - box.height
          : r.top + r.height / 2 - box.height / 2;
  }
  left = Math.max(MARGIN, Math.min(left, vw - box.width - MARGIN));
  top = Math.max(MARGIN, Math.min(top, vh - box.height - MARGIN));
  return { top, left, placement: side };
}

function anchorRect(anchor: PopoverAnchor): Rect {
  return anchor instanceof HTMLElement
    ? anchor.getBoundingClientRect()
    : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
}

export function Popover({
  open,
  anchor,
  onClose,
  children,
  className,
  placement = 'top',
  align = 'center',
  'aria-label': ariaLabel,
}: PopoverProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{
    top: number;
    left: number;
    placement: PopoverPlacement;
  } | null>(null);
  const overlayId = useOverlay(open, onClose, ref);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      setPos(
        placePopover(
          anchorRect(anchor),
          box,
          { width: window.innerWidth, height: window.innerHeight },
          placement,
          align,
        ),
      );
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [open, anchor, placement, align]);

  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      if (isInOverlayAbove(overlayId, t)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, anchor, onClose, overlayId]);

  // Focus management (see the header). `previous` is captured when the popover opens.
  const shown = open && !!anchor;
  const positioned = shown && !!pos;
  const previous = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!shown) return;
    previous.current = document.activeElement as HTMLElement | null;
    const box = ref.current;
    return () => {
      const prev = previous.current;
      previous.current = null;
      const active = document.activeElement;
      // Only give focus back when it was in the popover (now gone) — not when the user
      // clicked somewhere else to close it.
      const lost =
        !active || active === document.body || !active.isConnected || !!box?.contains(active);
      if (lost && prev && prev.isConnected) prev.focus({ preventScroll: true });
    };
  }, [shown]);
  useEffect(() => {
    if (!positioned) return;
    const el = ref.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      if (el.contains(document.activeElement)) return;
      (focusableIn(el)[0] ?? el).focus({ preventScroll: true });
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusableIn(el);
      if (!items.length) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('keydown', onKey);
    };
  }, [positioned]);

  if (!open || !anchor) return null;
  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-label={ariaLabel}
        tabIndex={-1}
        data-placement={pos?.placement ?? placement}
        className={cn(
          'fixed z-[60] rounded-2xl border border-line bg-elevated shadow-elevated outline-none',
          pos ? 'animate-scale-in' : 'invisible',
          className,
        )}
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0 }}
      >
        {children}
      </div>
    </Portal>
  );
}
