import { useCallback, useState, type FocusEvent, type PointerEvent } from 'react';
import { Portal } from '@/components/ui';

interface Tip {
  text: string;
  x: number;
  y: number;
}

function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/**
 * The rail's tooltip: one fixed bubble to the right of the item under the mouse (or focused
 * from the keyboard) that is marked `data-rail-tip`, so the scrolling rail never clips it.
 * Spread `handlers` on the rail and call `hide` when it scrolls; nothing shows while `off`.
 */
export function useRailTooltip(off: boolean) {
  const [tip, setTip] = useState<Tip | null>(null);
  const show = useCallback((target: EventTarget | null) => {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-rail-tip]') : null;
    if (!el) {
      setTip(null);
      return;
    }
    const r = el.getBoundingClientRect();
    setTip({ text: el.dataset.railTip ?? '', x: r.right + 12, y: r.top + r.height / 2 });
  }, []);
  const hide = useCallback(() => setTip(null), []);
  const handlers = {
    onPointerOver: (e: PointerEvent) => {
      if (e.pointerType === 'mouse') show(e.target);
    },
    onPointerLeave: hide,
    onFocus: (e: FocusEvent) => {
      if (focusVisible(e.target)) show(e.target);
    },
    onBlur: hide,
  };
  const element =
    tip && !off ? (
      <Portal>
        <span
          role="tooltip"
          className="pointer-events-none fixed z-50 -translate-y-1/2 animate-fade-in rounded-lg bg-fg px-2.5 py-1.5 text-[13px] font-semibold whitespace-nowrap text-surface shadow-elevated"
          style={{ left: tip.x, top: tip.y }}
          data-testid="rail-tooltip"
        >
          {tip.text}
        </span>
      </Portal>
    ) : null;
  return { handlers, hide, element };
}
