/**
 * Minimal anchored popover (portal, fixed): positions above the anchor when there is room,
 * else below; closes on outside pointer, Escape (top-most overlay) and resize.
 */
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Portal, useOverlay } from '@/components/ui';
import type { ActionAnchor } from './state';
import { cn } from '@/lib/cn';

const MARGIN = 8;

export function Popover({
  open,
  anchor,
  onClose,
  children,
  className,
  placement = 'top',
  'aria-label': ariaLabel,
}: {
  open: boolean;
  anchor: ActionAnchor | null;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  placement?: 'top' | 'bottom';
  'aria-label'?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useOverlay(open, onClose);

  useLayoutEffect(() => {
    if (!open || !anchor || !ref.current) {
      setPos(null);
      return;
    }
    const place = () => {
      const el = ref.current;
      if (!el) return;
      const box = el.getBoundingClientRect();
      const r =
        anchor instanceof HTMLElement
          ? anchor.getBoundingClientRect()
          : {
              left: anchor.x,
              right: anchor.x,
              top: anchor.y,
              bottom: anchor.y,
              width: 0,
              height: 0,
            };
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = placement === 'top' ? r.top - box.height - 6 : r.bottom + 6;
      if (placement === 'top' && top < MARGIN) top = r.bottom + 6;
      if (placement === 'bottom' && top + box.height > vh - MARGIN) top = r.top - box.height - 6;
      let left = r.left + r.width / 2 - box.width / 2;
      left = Math.max(MARGIN, Math.min(left, vw - box.width - MARGIN));
      top = Math.max(MARGIN, Math.min(top, vh - box.height - MARGIN));
      setPos({ top, left });
    };
    place();
    const ro = new ResizeObserver(place);
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, [open, anchor, placement]);

  useLayoutEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (ref.current?.contains(t)) return;
      if (anchor instanceof HTMLElement && anchor.contains(t)) return;
      onClose();
    };
    const onResize = () => onClose();
    document.addEventListener('pointerdown', onPointer, true);
    window.addEventListener('resize', onResize);
    return () => {
      document.removeEventListener('pointerdown', onPointer, true);
      window.removeEventListener('resize', onResize);
    };
  }, [open, anchor, onClose]);

  if (!open || !anchor) return null;
  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-label={ariaLabel}
        className={cn(
          'fixed z-[60] rounded-2xl border border-line bg-elevated shadow-elevated',
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
