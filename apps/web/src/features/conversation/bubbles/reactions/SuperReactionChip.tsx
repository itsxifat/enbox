/**
 * The chip of an emoji's super reactions (next to its normal chip, ReactionChips.tsx): a soft
 * glow and a gradient border in the emoji's two colours, a sparkle on the emoji, and its own
 * count. Click toggles my super reaction; hover shows who sent one and replays the burst; a
 * super reaction that comes in live (or that I add) plays the burst once. History never
 * plays (lib/arrivals marks), nor anything under reduced motion or with the
 * `superReactionAnimations` pref off.
 */
import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Sparkles } from 'lucide-react';
import type { ID, ReactionSummary } from '@enbox/shared';
import { useLongPress } from '@/features/chats/useLongPress';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { isFreshArrival } from '@/lib/arrivals';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';
import { useEmojiColors } from './emojiColors';
import { burstCountOf, reactionLabel, superArrivalKey } from './model';
import { ReactionEmoji } from './ReactionEmoji';
import { SuperBurst } from './SuperBurst';
import './superReactions.css';

/** Keyboard focus (not a click): `:focus-visible`, where the browser knows it. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

export function SuperReactionChip({
  messageId,
  r,
  mine,
  enabled,
  onToggle,
  onOpenList,
  onHover,
}: {
  messageId: ID;
  r: ReactionSummary;
  /** I super-reacted with it. */
  mine: boolean;
  enabled: boolean;
  onToggle: () => void;
  onOpenList: () => void;
  onHover: (anchor: HTMLElement | null) => void;
}) {
  const longPress = useLongPress(() => onOpenList());
  const reduced = useReducedMotion();
  const animations = useUi((s) => s.prefs.superReactionAnimations);
  const animate = animations && !reduced;
  const colors = useEmojiColors(r.emoji);
  const count = burstCountOf(r);
  const [emojiEl, setEmojiEl] = useState<HTMLSpanElement | null>(null);
  const [bursting, setBursting] = useState(false);
  const play = useCallback(() => {
    if (animate) setBursting(true);
  }, [animate]);
  const stop = useCallback(() => setBursting(false), []);

  // A super reaction that just came in (or that I just added) bursts; loaded ones don't.
  const key = superArrivalKey(messageId, r.emoji);
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const before = seen.current;
    seen.current = count;
    if ((before === null || count > before) && isFreshArrival(key)) play();
  }, [count, key, play]);

  // Bumped when the count changes after mount: re-keys the count so its pop replays.
  const [bump, setBump] = useState(0);
  const prev = useRef(count);
  useEffect(() => {
    if (prev.current === count) return;
    prev.current = count;
    if (!reduced) setBump((n) => n + 1);
  }, [count, reduced]);

  const label = `${reactionLabel(r.emoji)}, ${count} ${
    count === 1 ? 'Super Reaction' : 'Super Reactions'
  }${mine ? ', including yours' : ''}`;
  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-pressed={mine}
        aria-disabled={!enabled || undefined}
        data-animate={animate || undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (enabled) onToggle();
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
          onOpenList();
        }}
        onPointerDown={longPress.onPointerDown}
        onPointerMove={longPress.onPointerMove}
        onPointerUp={longPress.onPointerUp}
        onPointerCancel={longPress.onPointerCancel}
        onClickCapture={longPress.onClickCapture}
        onPointerEnter={(e) => {
          if (e.pointerType === 'touch') return;
          onHover(e.currentTarget);
          play();
        }}
        onPointerLeave={() => onHover(null)}
        onFocus={(e) => {
          if (focusVisible(e.currentTarget)) onHover(e.currentTarget);
        }}
        onBlur={() => onHover(null)}
        className={cn(
          'super-chip flex h-6 min-w-0 items-center gap-1.5 rounded-lg px-1.5 text-[13px] leading-none text-fg select-none',
          'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
          !enabled && 'cursor-default',
        )}
        style={{ '--sr-a': colors[0], '--sr-b': colors[1] } as CSSProperties}
      >
        <span
          ref={setEmojiEl}
          className="super-chip-emoji relative inline-flex shrink-0"
          data-bursting={bursting || undefined}
        >
          <ReactionEmoji emoji={r.emoji} size={16} />
          <Sparkles size={10} strokeWidth={2.25} aria-hidden className="super-chip-sparkle" />
        </span>
        <span
          key={bump}
          className={cn('font-semibold tabular-nums', bump > 0 && 'animate-icon-pop')}
        >
          {count}
        </span>
      </button>
      {bursting && emojiEl ? <SuperBurst anchor={emojiEl} colors={colors} onDone={stop} /> : null}
    </>
  );
}
