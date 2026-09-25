/**
 * Overlay plumbing shared by Modal, Sheet and Menu: a portal, an overlay stack so Escape
 * closes only the top-most layer, body scroll locking and a lightweight focus trap.
 */
import { useEffect, useId, useLayoutEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';

export function Portal({ children }: { children: ReactNode }) {
  if (typeof document === 'undefined') return null;
  return createPortal(children, document.body);
}

const stack: string[] = [];

/** True when the overlay with this id is the top-most open overlay. */
export function isTopOverlay(id: string): boolean {
  return stack[stack.length - 1] === id;
}

/**
 * Register an open overlay; Escape calls `onEscape` only for the top-most one.
 * Returns the overlay id.
 */
export function useOverlay(open: boolean, onEscape?: () => void): string {
  const id = useId();
  const cb = useRef(onEscape);
  useEffect(() => {
    cb.current = onEscape;
  });
  useEffect(() => {
    if (!open) return;
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isTopOverlay(id) && cb.current) {
        e.stopPropagation();
        e.preventDefault();
        cb.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [open, id]);
  return id;
}

let locks = 0;
let savedOverflow = '';

/** Prevent the page behind a modal from scrolling. */
export function useScrollLock(active: boolean): void {
  useLayoutEffect(() => {
    if (!active) return;
    if (locks++ === 0) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    return () => {
      if (--locks === 0) document.body.style.overflow = savedOverflow;
    };
  }, [active]);
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"]),[contenteditable="true"]';

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) =>
      !el.hasAttribute('disabled') &&
      el.getAttribute('aria-hidden') !== 'true' &&
      el.offsetParent !== null,
  );
}

/**
 * Focus-trap-lite: focuses `initialFocus` (or the first focusable, or the container) on
 * open, keeps Tab/Shift+Tab inside, and restores focus to the previously focused element.
 */
export function useFocusTrap(
  containerRef: RefObject<HTMLElement | null>,
  active: boolean,
  initialFocus?: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!active) return;
    const container = containerRef.current;
    if (!container) return;
    const previous = document.activeElement as HTMLElement | null;
    const target = initialFocus?.current ?? focusableIn(container)[0] ?? container;
    // Defer so the element is laid out (animations) before focusing.
    const raf = requestAnimationFrame(() => target.focus({ preventScroll: true }));

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;
      const items = focusableIn(container);
      if (!items.length) {
        e.preventDefault();
        container.focus();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || !container.contains(activeEl))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (activeEl === last || !container.contains(activeEl))) {
        e.preventDefault();
        first.focus();
      }
    };
    container.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(raf);
      container.removeEventListener('keydown', onKey);
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true });
    };
  }, [active, containerRef, initialFocus]);
}
