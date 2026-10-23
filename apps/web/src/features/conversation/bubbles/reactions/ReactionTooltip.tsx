/**
 * The chip tooltip (Discord): the emoji large and "Ann, Bo and 3 others reacted with :x:";
 * a super chip's says "Super Reaction" above its own reactors. Floats above the chip in a
 * portal (message rows clip overflow), never takes the pointer.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { ChatSummary, ReactionSummary } from '@enbox/shared';
import { Portal, placePopover } from '@/components/ui';
import type { ClientMessage } from '@/stores/messages';
import { burstCountOf, normalCountOf, reactorsSentence } from './model';
import { useFirstReactors, useReactorNames } from './names';
import { ReactionEmoji } from './ReactionEmoji';

export function ReactionTooltip({
  chat,
  m,
  r,
  mine,
  anchor,
  burst = false,
}: {
  chat: ChatSummary;
  m: ClientMessage;
  r: ReactionSummary;
  mine: boolean;
  anchor: HTMLElement;
  /** The super chip's tooltip. */
  burst?: boolean;
}) {
  const ids = useFirstReactors(chat, m.id, r, mine, true, burst);
  const names = useReactorNames(ids, chat.space?.spaceId);
  const text = reactorsSentence(names, burst ? burstCountOf(r) : normalCountOf(r), r.emoji);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setPos(
      placePopover(
        anchor.getBoundingClientRect(),
        { width: el.offsetWidth, height: el.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight },
        'top',
        'center',
      ),
    );
  }, [anchor, text]);

  return (
    <Portal>
      <div
        ref={ref}
        role="tooltip"
        data-testid="reaction-tooltip"
        className="pointer-events-none fixed z-[70] flex max-w-[260px] items-center gap-2.5 rounded-lg bg-elevated px-3 py-2 text-[13px] leading-snug font-medium text-fg shadow-elevated"
        style={{ top: pos?.top ?? 0, left: pos?.left ?? 0, visibility: pos ? undefined : 'hidden' }}
      >
        <ReactionEmoji emoji={r.emoji} size={32} />
        <span className="flex min-w-0 flex-col gap-0.5">
          {burst ? (
            <span className="flex items-center gap-1 text-[12px] font-semibold text-brand-ink">
              <Sparkles size={12} aria-hidden />
              Super Reaction
            </span>
          ) : null}
          <span>{text}</span>
        </span>
      </div>
    </Portal>
  );
}
