/**
 * "Skip to content": the app shell's first tab stop, shown while it has focus (`.skip-link`,
 * index.css). It moves the focus to the main region (the open chat or page), so keyboard and
 * screen reader users don't tab through the rail and the sidebar first.
 */
import type { MouseEvent } from 'react';

/** The main region of the app around `from` (phones without one: the visible list pane). */
function mainRegion(from: HTMLElement): HTMLElement | null {
  const scope = from.closest<HTMLElement>('[data-testid="app-base"]') ?? document.body;
  return (
    scope.querySelector<HTMLElement>('main') ??
    scope.querySelector<HTMLElement>('section:not([aria-hidden="true"])')
  );
}

export function SkipToContent() {
  const skip = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    const target = mainRegion(e.currentTarget);
    if (!target) return;
    if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
    target.focus();
  };
  return (
    <a
      href="#main"
      onClick={skip}
      className="skip-link rounded-lg bg-brand px-4 py-2 text-[14px] font-semibold text-on-brand shadow-elevated"
    >
      Skip to content
    </a>
  );
}
