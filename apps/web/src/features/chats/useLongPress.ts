import {
  useCallback,
  useEffect,
  useRef,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (e: ReactMouseEvent<HTMLElement>) => void;
}

/**
 * Touch long-press (≈450 ms without moving): calls `onLongPress` and swallows the click
 * that follows so links/rows don't also activate. Mouse input is ignored (desktop uses
 * right-click / hover menus).
 */
export function useLongPress(
  onLongPress: (target: HTMLElement, point: { x: number; y: number }) => void,
  { ms = 450, enabled = true }: { ms?: number; enabled?: boolean } = {},
): LongPressHandlers {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cb = useRef(onLongPress);
  useEffect(() => {
    cb.current = onLongPress;
  });

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    start.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  return {
    onPointerDown: (e) => {
      fired.current = false;
      if (!enabled || e.pointerType === 'mouse' || e.button !== 0) return;
      const target = e.currentTarget;
      start.current = { x: e.clientX, y: e.clientY };
      const point = { x: e.clientX, y: e.clientY };
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = null;
        fired.current = true;
        if (navigator.vibrate) navigator.vibrate(12);
        cb.current(target, point);
      }, ms);
    },
    onPointerMove: (e) => {
      if (!start.current) return;
      if (Math.hypot(e.clientX - start.current.x, e.clientY - start.current.y) > 10) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onClickCapture: (e) => {
      if (fired.current) {
        e.preventDefault();
        e.stopPropagation();
        fired.current = false;
      }
    },
  };
}
