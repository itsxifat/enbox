import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { formatDuration } from '@enbox/shared';

/** "0:42" since `connectedAt`, ticking every second (null while not connected). */
export function useCallDuration(connectedAt: number | null): string | null {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!connectedAt) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [connectedAt]);
  return connectedAt ? formatDuration(Math.max(0, now - connectedAt)) : null;
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br';

export interface DraggableOptions {
  /** Starting corner. */
  initial?: Corner;
  /** Distance from the container edges (px). */
  margin?: number;
  /** Extra bottom margin (e.g. above a controls bar). */
  bottomInset?: number;
  topInset?: number;
  /** Tap (pointer up without moving) handler. */
  onTap?: () => void;
}

/**
 * Drag an absolutely/fixed positioned element with the pointer; on release it snaps to the
 * nearest corner of its offset parent (or the viewport for fixed elements).
 */
export function useDraggable<T extends HTMLElement>(opts: DraggableOptions = {}) {
  const { initial = 'br', margin = 12, bottomInset = 0, topInset = 0, onTap } = opts;
  const ref = useRef<T>(null);
  const [corner, setCorner] = useState<Corner>(initial);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const start = useRef<{ px: number; py: number; x: number; y: number; moved: boolean } | null>(
    null,
  );
  const tapRef = useRef(onTap);
  useEffect(() => {
    tapRef.current = onTap;
  });

  const bounds = () => {
    const el = ref.current;
    const parent = el?.offsetParent as HTMLElement | null;
    const w = parent?.clientWidth ?? window.innerWidth;
    const h = parent?.clientHeight ?? window.innerHeight;
    return { w, h, ew: el?.offsetWidth ?? 0, eh: el?.offsetHeight ?? 0 };
  };

  const onPointerDown = (e: ReactPointerEvent<T>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    // Buttons inside the draggable keep their own clicks.
    if ((e.target as HTMLElement).closest?.('button, a, input, [role="menuitem"]')) return;
    const el = ref.current;
    if (!el) return;
    el.setPointerCapture?.(e.pointerId);
    start.current = {
      px: e.clientX,
      py: e.clientY,
      x: el.offsetLeft,
      y: el.offsetTop,
      moved: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<T>) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.px;
    const dy = e.clientY - s.py;
    if (!s.moved && Math.hypot(dx, dy) < 6) return;
    s.moved = true;
    const { w, h, ew, eh } = bounds();
    setDrag({
      x: Math.min(Math.max(0, s.x + dx), w - ew),
      y: Math.min(Math.max(0, s.y + dy), h - eh),
    });
  };

  const onPointerUp = (e: ReactPointerEvent<T>) => {
    const s = start.current;
    start.current = null;
    ref.current?.releasePointerCapture?.(e.pointerId);
    if (!s) return;
    if (!s.moved) {
      tapRef.current?.();
      return;
    }
    const { w, h, ew, eh } = bounds();
    const x = drag?.x ?? s.x;
    const y = drag?.y ?? s.y;
    const right = x + ew / 2 > w / 2;
    const bottom = y + eh / 2 > h / 2;
    setCorner(`${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as Corner);
    setDrag(null);
  };

  const style: CSSProperties = drag
    ? { left: drag.x, top: drag.y, transition: 'none' }
    : {
        ...(corner[0] === 't' ? { top: margin + topInset } : { bottom: margin + bottomInset }),
        ...(corner[1] === 'l' ? { left: margin } : { right: margin }),
      };

  return {
    ref,
    style,
    dragging: !!drag,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
