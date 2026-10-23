/**
 * Keyboard navigation of a message list (MessageList; rows from messageRowA11y). On a focused
 * row: ↑ / ↓ move to the previous / next loaded row and Home / End to the first / last one (a
 * row outside the rendered window is scrolled in first), Enter or Tab enter its toolbar and
 * Escape goes back to the composer; Escape in the toolbar returns to the row. Tabbing into the
 * list from outside lands on the last row in view.
 */
import { useRef, type FocusEvent, type KeyboardEvent } from 'react';

const ROW = '[role="article"][data-message-id]';

export interface RowNavigator {
  /** Ids of the loaded messages whose rows take focus (system rows don't), in list order. */
  rowIds(): string[];
  /** Scroll a loaded row into the rendered window. */
  reveal(id: string, align: 'start' | 'end'): void;
  /** The list's scroller (it takes the focus when tabbed to). */
  scroller(): HTMLElement | null;
}

function renderedRow(list: HTMLElement, id: string): HTMLElement | null {
  for (const el of list.querySelectorAll<HTMLElement>(ROW))
    if (el.dataset.messageId === id) return el;
  return null;
}

/** Focus a loaded row, scrolling it into the rendered window first when it isn't there. */
export function focusRow(
  list: HTMLElement,
  id: string,
  nav: Pick<RowNavigator, 'reveal'>,
  align: 'start' | 'end',
): void {
  const el = renderedRow(list, id);
  if (el) {
    el.focus();
    return;
  }
  nav.reveal(id, align);
  let frames = 0;
  const retry = () => {
    const row = renderedRow(list, id);
    if (row) row.focus();
    else if (++frames < 30) requestAnimationFrame(retry);
  };
  requestAnimationFrame(retry);
}

/** The message box of the conversation around `list` (never another chat's). */
function composerOf(list: HTMLElement): HTMLElement | null {
  for (let el = list.parentElement; el; el = el.parentElement) {
    if (el.querySelectorAll('[data-testid="message-list"]').length > 1) return null;
    const box = el.querySelector<HTMLElement>('textarea[aria-label="Message"]');
    if (box) return box;
  }
  return null;
}

/** Where Enter / Tab land in a row's toolbar: its tab stop (More), else its first button. */
function toolbarTarget(row: HTMLElement): HTMLElement | null {
  const bar = row.querySelector<HTMLElement>('[role="toolbar"]');
  if (!bar) return null;
  return (
    bar.querySelector<HTMLElement>('button[tabindex="0"]:not([disabled])') ??
    bar.querySelector<HTMLElement>('button:not([disabled])')
  );
}

function onKeyDown(e: KeyboardEvent<HTMLElement>, nav: RowNavigator): void {
  if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
  const list = e.currentTarget;
  const target = e.target instanceof HTMLElement ? e.target : null;
  if (!target) return;
  if (!target.matches(ROW)) {
    // Escape in a row's toolbar (not in a menu it opened: those render elsewhere).
    const row = target.closest<HTMLElement>(ROW);
    if (e.key === 'Escape' && row && target.closest('[role="toolbar"]')) {
      e.preventDefault();
      row.focus();
    }
    return;
  }
  const id = target.dataset.messageId!;
  switch (e.key) {
    case 'ArrowUp':
    case 'ArrowDown':
    case 'Home':
    case 'End': {
      if (e.shiftKey) return;
      e.preventDefault();
      const ids = nav.rowIds();
      const i = ids.indexOf(id);
      if (i < 0) return;
      const up = e.key === 'ArrowUp' || e.key === 'Home';
      const next =
        e.key === 'Home' ? ids[0] : e.key === 'End' ? ids[ids.length - 1] : ids[i + (up ? -1 : 1)];
      if (next && next !== id) focusRow(list, next, nav, up ? 'start' : 'end');
      return;
    }
    case 'Enter':
    case 'Tab': {
      if (e.shiftKey) return;
      const button = toolbarTarget(target);
      if (!button) return;
      e.preventDefault();
      button.focus();
      return;
    }
    case 'Escape':
      // Not prevented: the conversation still leaves select mode or closes its search.
      composerOf(list)?.focus();
      return;
  }
}

/** The last row in the scroller's view (the last rendered one when none measures in view). */
function lastRowInView(scroller: HTMLElement): HTMLElement | null {
  const rows = Array.from(scroller.querySelectorAll<HTMLElement>(ROW));
  const box = scroller.getBoundingClientRect();
  const inView = rows.filter((r) => {
    const b = r.getBoundingClientRect();
    return b.bottom > box.top && b.top < box.bottom;
  });
  return inView[inView.length - 1] ?? rows[rows.length - 1] ?? null;
}

/**
 * Handlers for the element around the list (`onKeyDown`, `onFocus`, `onPointerDown`). A click on
 * the scroller focuses it too: that one stays there.
 */
export function useRowNavigation(nav: RowNavigator) {
  const pointerAt = useRef(Number.NEGATIVE_INFINITY);
  return {
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => onKeyDown(e, nav),
    onPointerDown: () => {
      pointerAt.current = performance.now();
    },
    onFocus: (e: FocusEvent<HTMLElement>) => {
      const scroller = nav.scroller();
      if (!scroller || e.target !== scroller) return;
      if (performance.now() - pointerAt.current < 600) return;
      const from = e.relatedTarget instanceof Node ? e.relatedTarget : null;
      // Shift+Tab out of a row stops on the scroller (the next one leaves the list).
      if (from && scroller.contains(from)) return;
      lastRowInView(scroller)?.focus({ preventScroll: true });
    },
  };
}
