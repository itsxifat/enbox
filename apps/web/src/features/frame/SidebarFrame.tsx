import {
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { cn } from '@/lib/cn';
import { SIDEBAR_MAX, SIDEBAR_MIN, useSidebarWidth } from './sidebarWidth';

/** Arrow-key step; with Shift, a bigger one. */
const STEP = 10;
const BIG_STEP = 40;

/**
 * The resize handle on the sidebar's right edge (a window splitter): drag, or ←/→ (Shift for
 * bigger steps), Home / End for the limits; double-click goes back to the default width.
 */
function SidebarResizer({ frame, defaultWidth }: { frame: RefObject<HTMLDivElement | null>; defaultWidth: number }) {
  const width = useSidebarWidth((s) => s.width);
  const setWidth = useSidebarWidth((s) => s.setWidth);
  const drag = useRef<{ x: number; from: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const now = width ?? defaultWidth;

  const at = (e: PointerEvent) => (drag.current ? drag.current.from + e.clientX - drag.current.x : now);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, from: frame.current?.getBoundingClientRect().width || now };
    setDragging(true);
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setWidth(at(e), { persist: false });
  };
  const onPointerEnd = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    setWidth(at(e));
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? BIG_STEP : STEP;
    const next =
      e.key === 'ArrowLeft' ? now - step : e.key === 'ArrowRight' ? now + step : e.key === 'Home' ? SIDEBAR_MIN : e.key === 'End' ? SIDEBAR_MAX : null;
    if (next === null) return;
    e.preventDefault();
    setWidth(next);
  };

  return (
    <>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        aria-valuemin={SIDEBAR_MIN}
        aria-valuemax={SIDEBAR_MAX}
        aria-valuenow={now}
        tabIndex={0}
        title="Drag to resize, double-click to reset"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onMouseDown={(e) => e.preventDefault()}
        onDoubleClick={() => setWidth(null)}
        onKeyDown={onKeyDown}
        className={cn(
          // In the gap between the panes, over the card's edge.
          'absolute inset-y-3 -right-[calc(var(--pane-gap)/2_+_3px)] z-20 w-1.5 cursor-col-resize rounded-full transition-colors outline-none hover:bg-brand/40 focus-visible:bg-brand',
          dragging && 'bg-brand/60',
        )}
        data-testid="sidebar-resizer"
      />
      {/* Keeps the cursor and stops hover effects and text selection while dragging. */}
      {dragging ? <div aria-hidden className="fixed inset-0 z-[60] cursor-col-resize select-none" /> : null}
    </>
  );
}

/**
 * A desktop sidebar in its frame: the width I dragged it to (Home's DM list and a Space's
 * channel list share it; until then the sidebar's own width, `defaultWidth`), with the resize
 * handle on its right edge. The sidebar is the frame's first child; a set width overrides its own.
 */
export function SidebarFrame({ children, defaultWidth }: { children: ReactNode; defaultWidth: number }) {
  const width = useSidebarWidth((s) => s.width);
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={ref}
      className={cn('relative flex shrink-0', width !== null && '[&>:first-child]:w-full!')}
      style={width !== null ? { width } : undefined}
      data-testid="sidebar-frame"
    >
      {children}
      <SidebarResizer frame={ref} defaultWidth={defaultWidth} />
    </div>
  );
}
