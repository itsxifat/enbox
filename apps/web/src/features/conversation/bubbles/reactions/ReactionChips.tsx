/**
 * Discord's reaction chips under a message: one chip per emoji with its count (custom emoji
 * as 16 px images), mine outlined in the brand colour on a tint, and before it the emoji's
 * super chip when it has super reactions (SuperReactionChip.tsx). Click toggles mine; hover
 * shows who reacted; right-click or a long press opens the Reactions list on that emoji. A
 * "+" chip (on row hover; always on touch) opens the emoji picker, with its Super Reaction
 * switch, when I may add new emoji. Counts pop when they change (not under reduced motion).
 */
import { Fragment, useEffect, useRef, useState, type MouseEvent } from 'react';
import { SmilePlus } from 'lucide-react';
import type { ChatSummary, ReactionSummary } from '@enbox/shared';
import { useLongPress } from '@/features/chats/useLongPress';
import { useIsTouch, useReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { canReact } from '../../actions';
import { useSelecting } from '../../state';
import {
  burstCountOf,
  canAddNewReaction,
  isMyBurstReaction,
  isMyReaction,
  normalCountOf,
  reactionKey,
  reactionLabel,
} from './model';
import { ReactionEmoji } from './ReactionEmoji';
import { ReactionPickerPopover } from './ReactionPicker';
import { canAddReaction, canRemoveOwnReaction, toggleReaction } from './reactionActions';
import { ReactionsModal } from './ReactionsModal';
import { ReactionTooltip } from './ReactionTooltip';
import { SuperReactionChip } from './SuperReactionChip';

/** Hover this long before the tooltip shows. */
const TOOLTIP_DELAY_MS = 300;

/** Keyboard focus (not a click): `:focus-visible`, where the browser knows it. */
function focusVisible(el: Element): boolean {
  try {
    return el.matches(':focus-visible');
  } catch {
    return false;
  }
}

/** One chip: an emoji and a kind. */
interface ChipRef {
  emoji: string;
  burst: boolean;
}

export function ReactionChips({
  m,
  chat,
  className,
}: {
  m: ClientMessage;
  chat: ChatSummary;
  className?: string;
}) {
  const me = useAuth((s) => s.user?.id);
  const touch = useIsTouch();
  // Select mode: a click on the row selects it, the chips stand still.
  const selecting = useSelecting(chat.id);
  const [list, setList] = useState<ChipRef | null>(null);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [tip, setTip] = useState<(ChipRef & { anchor: HTMLElement }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (m.deletedAt || (!m.reactions.length && !list)) return null;

  const hover = (chip: ChipRef, anchor: HTMLElement | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!anchor) return setTip(null);
    timer.current = setTimeout(() => setTip({ ...chip, anchor }), TOOLTIP_DELAY_MS);
  };
  const openList = (chip: ChipRef) => {
    hover(chip, null);
    setList(chip);
  };
  const quickOnly = chat.type === 'channel' && chat.channelSettings?.reactions === 'quick';
  const canPick = canReact(chat, m) && canAddNewReaction(chat) && !quickOnly;
  const tipped = tip ? m.reactions.find((r) => r.emoji === tip.emoji) : undefined;
  const tipCount = tip && tipped ? (tip.burst ? burstCountOf(tipped) : normalCountOf(tipped)) : 0;

  return (
    <div
      role="group"
      aria-label="Reactions"
      className={cn(
        'flex flex-wrap items-center gap-1',
        selecting && 'pointer-events-none',
        className,
      )}
      data-testid="reactions"
    >
      {m.reactions.map((r) => {
        const normal = { emoji: r.emoji, burst: false };
        const supers = { emoji: r.emoji, burst: true };
        const mine = isMyReaction(m, me, r.emoji);
        const mineBurst = isMyBurstReaction(m, me, r.emoji);
        const may = (own: boolean) =>
          own ? canRemoveOwnReaction(chat, m) : canAddReaction(chat, m, r.emoji);
        return (
          <Fragment key={reactionKey(r.emoji)}>
            {burstCountOf(r) > 0 ? (
              <SuperReactionChip
                messageId={m.id}
                r={r}
                mine={mineBurst}
                enabled={may(mineBurst)}
                onToggle={() => {
                  hover(supers, null);
                  void toggleReaction(chat, m, r.emoji, { burst: true });
                }}
                onOpenList={() => openList(supers)}
                onHover={(anchor) => hover(supers, anchor)}
              />
            ) : null}
            {normalCountOf(r) > 0 ? (
              <ReactionChip
                r={r}
                count={normalCountOf(r)}
                mine={mine}
                enabled={may(mine)}
                onToggle={() => {
                  hover(normal, null);
                  void toggleReaction(chat, m, r.emoji);
                }}
                onOpenList={() => openList(normal)}
                onHover={(anchor) => hover(normal, anchor)}
              />
            ) : null}
          </Fragment>
        );
      })}
      {canPick ? (
        <button
          type="button"
          aria-label="Add reaction"
          title="Add reaction"
          onClick={(e) => {
            e.stopPropagation();
            setPicker(e.currentTarget);
          }}
          className={cn(
            'flex h-6 items-center rounded-lg border border-transparent bg-surface-2 px-1.5 text-muted transition-opacity hover:border-line-strong hover:text-fg',
            'focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-brand',
            !touch && !picker && 'opacity-0 group-hover/msg:opacity-100',
          )}
        >
          <SmilePlus size={16} aria-hidden />
        </button>
      ) : null}
      <ReactionPickerPopover
        chat={chat}
        anchor={picker}
        modeSwitch
        onClose={() => setPicker(null)}
        onPick={(emoji, { burst }) => void toggleReaction(chat, m, emoji, { burst })}
      />
      {tip && tipped && tipCount > 0 ? (
        <ReactionTooltip
          chat={chat}
          m={m}
          r={tipped}
          burst={tip.burst}
          mine={
            tip.burst ? isMyBurstReaction(m, me, tipped.emoji) : isMyReaction(m, me, tipped.emoji)
          }
          anchor={tip.anchor}
        />
      ) : null}
      {list !== null ? (
        <ReactionsModal
          chat={chat}
          m={m}
          initialEmoji={list.emoji}
          initialBurst={list.burst}
          onClose={() => setList(null)}
        />
      ) : null}
    </div>
  );
}

function ReactionChip({
  r,
  count,
  mine,
  enabled,
  onToggle,
  onOpenList,
  onHover,
}: {
  r: ReactionSummary;
  /** Its normal reactions (`r.count` includes the super ones). */
  count: number;
  mine: boolean;
  enabled: boolean;
  onToggle: () => void;
  onOpenList: () => void;
  onHover: (anchor: HTMLElement | null) => void;
}) {
  const longPress = useLongPress(() => onOpenList());
  const reduced = useReducedMotion();
  // Bumped when the count changes after mount: re-keys the count so its pop replays.
  const [bump, setBump] = useState(0);
  const prev = useRef(count);
  useEffect(() => {
    if (prev.current === count) return;
    prev.current = count;
    if (!reduced) setBump((n) => n + 1);
  }, [count, reduced]);

  const label = `${reactionLabel(r.emoji)}, ${count} ${count === 1 ? 'reaction' : 'reactions'}${
    mine ? ', including yours' : ''
  }`;
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={mine}
      aria-disabled={!enabled || undefined}
      onClick={(e: MouseEvent) => {
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
        if (e.pointerType !== 'touch') onHover(e.currentTarget);
      }}
      onPointerLeave={() => onHover(null)}
      onFocus={(e) => {
        if (focusVisible(e.currentTarget)) onHover(e.currentTarget);
      }}
      onBlur={() => onHover(null)}
      className={cn(
        'flex h-6 min-w-0 items-center gap-1.5 rounded-lg border px-1.5 text-[13px] leading-none transition-colors select-none',
        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand',
        mine
          ? 'border-brand bg-brand/15 text-brand-ink'
          : 'border-transparent bg-surface-2 text-muted hover:border-line-strong',
        !enabled && 'cursor-default',
      )}
    >
      <ReactionEmoji emoji={r.emoji} size={16} />
      <span key={bump} className={cn('font-semibold tabular-nums', bump > 0 && 'animate-icon-pop')}>
        {count}
      </span>
    </button>
  );
}
