/**
 * A message from someone I ignore, collapsed: "Ignored message — Show" in place of its body
 * (both row styles render bodies through `MessageContent`). Show reveals that one message for
 * the rest of the session; my own messages never collapse.
 */
import type { MouseEvent } from 'react';
import { EyeOff } from 'lucide-react';
import type { ID } from '@enbox/shared';
import { useIgnores, useIsIgnored, useIsRevealed } from '@/stores/ignores';

/** True while `MessageContent` should show the ignored line instead of the body. */
export function useIgnoredCollapse(m: { id: ID; senderId: ID | null }, mine: boolean): boolean {
  const ignored = useIsIgnored(mine ? null : m.senderId);
  const revealed = useIsRevealed(m.id);
  return ignored && !revealed;
}

export function IgnoredMessageLine({ messageId }: { messageId: ID }) {
  const show = (e: MouseEvent) => {
    // The row's own click (select mode) and long-press must not see it.
    e.stopPropagation();
    useIgnores.getState().reveal(messageId);
  };
  return (
    <div
      className="flex items-center gap-1.5 px-1.5 py-1 text-[13.5px] text-muted"
      data-testid="ignored-message"
    >
      <EyeOff size={15} className="shrink-0" aria-hidden />
      <span className="italic">Ignored message</span>
      <span aria-hidden>—</span>
      <button
        type="button"
        onClick={show}
        aria-label="Show ignored message"
        className="rounded font-semibold text-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-brand"
      >
        Show
      </button>
    </div>
  );
}
