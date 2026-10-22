/**
 * Discord's reaction chips under a message: one chip per emoji with its count (custom emoji
 * as 16 px images), mine outlined in the brand colour on a tint. Click toggles mine; hover
 * shows who reacted; right-click or a long press opens the Reactions list on that emoji. A
 * "+" chip (on row hover; always on touch) opens the emoji picker when I may add new emoji.
 * Counts pop when they change (not under reduced motion).
 */
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { SmilePlus } from 'lucide-react';
import type { ChatSummary, ReactionSummary } from '@enbox/shared';
import { useLongPress } from '@/features/chats/useLongPress';
import { useIsTouch, useReducedMotion } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { canReact } from '../../actions';
import { useSelecting } from '../../state';
import { canAddNewReaction, isMyReaction, reactionKey, reactionLabel } from './model';
import { ReactionEmoji } from './ReactionEmoji';
import { ReactionPickerPopover } from './ReactionPicker';
import { canAddReaction, canRemoveOwnReaction, toggleReaction } from './reactionActions';
import { ReactionsModal } from './ReactionsModal';
import { ReactionTooltip } from './ReactionTooltip';

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
  const [list, setList] = useState<string | null>(null);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [tip, setTip] = useState<{ emoji: string; anchor: HTMLElement } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (m.deletedAt || (!m.reactions.length && !list)) return null;

  const hover = (emoji: string, anchor: HTMLElement | null) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (!anchor) return setTip(null);
    timer.current = setTimeout(() => setTip({ emoji, anchor }), TOOLTIP_DELAY_MS);
  };
  const openList = (emoji: string) => {
    hover(emoji, null);
    setList(emoji);
  };
  const quickOnly = chat.type === 'channel' && chat.channelSettings?.reactions === 'quick';
  const canPick = canReact(chat, m) && canAddNewReaction(chat) && !quickOnly;
  const tipped = tip ? m.reactions.find((r) => r.emoji === tip.emoji) : undefined;

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
        const mine = isMyReaction(m, me, r.emoji);
        return (
          <ReactionChip
            key={reactionKey(r.emoji)}
            r={r}
            mine={mine}
            enabled={mine ? canRemoveOwnReaction(chat, m) : canAddReaction(chat, m, r.emoji)}
            onToggle={() => {
              hover(r.emoji, null);
              void toggleReaction(chat, m, r.emoji);
            }}
            onOpenList={() => openList(r.emoji)}
            onHover={(anchor) => hover(r.emoji, anchor)}
          />
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
        onClose={() => setPicker(null)}
        onPick={(emoji) => void toggleReaction(chat, m, emoji)}
      />
      {tip && tipped ? (
        <ReactionTooltip
          chat={chat}
          m={m}
          r={tipped}
          mine={isMyReaction(m, me, tipped.emoji)}
          anchor={tip.anchor}
        />
      ) : null}
      {list !== null ? (
        <ReactionsModal chat={chat} m={m} initialEmoji={list} onClose={() => setList(null)} />
      ) : null}
    </div>
  );
}

function ReactionChip({
  r,
  mine,
  enabled,
  onToggle,
  onOpenList,
  onHover,
}: {
  r: ReactionSummary;
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
  const prev = useRef(r.count);
  useEffect(() => {
    if (prev.current === r.count) return;
    prev.current = r.count;
    if (!reduced) setBump((n) => n + 1);
  }, [r.count, reduced]);

  const label = `${reactionLabel(r.emoji)}, ${r.count} ${r.count === 1 ? 'reaction' : 'reactions'}${
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
        {r.count}
      </span>
    </button>
  );
}
