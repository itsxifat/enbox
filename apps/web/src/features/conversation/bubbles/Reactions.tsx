/**
 * Reactions under a message. Discord rows (cozy, Space channels) show the per-emoji chips
 * (`ReactionChips`, ./reactions/); bubbles keep the compact pill overlapping the bubble,
 * which opens the same Reactions list (`ReactionsDialog`).
 */
import type { ChatSummary, ReactionSummary } from '@enbox/shared';
import { cn } from '@/lib/cn';
import type { ClientMessage } from '@/stores/messages';
import { ReactionEmoji } from './reactions/ReactionEmoji';
import { ReactionsModal } from './reactions/ReactionsModal';
import { reactionKey, reactionLabel } from './reactions/model';

export { ReactionChips } from './reactions/ReactionChips';

/** The bubble pill: the three most used emoji and the total; tinted when I reacted. */
export function ReactionPill({
  reactions,
  mine,
  onClick,
  myReaction,
}: {
  reactions: ReactionSummary[];
  /** The message is mine (pill on the right). */
  mine: boolean;
  onClick: () => void;
  /** Any reaction of mine (`Message.myReaction`: the first of `myReactions`). */
  myReaction: string | null | undefined;
}) {
  const total = reactions.reduce((n, r) => n + r.count, 0);
  const top = [...reactions].sort((a, b) => b.count - a.count).slice(0, 3);
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      aria-label={`Reactions: ${reactions.map((r) => `${reactionLabel(r.emoji)} ${r.count}`).join(', ')}`}
      className={cn(
        'flex h-6 items-center gap-0.5 rounded-full border border-surface bg-elevated px-1.5 text-[13px] leading-none shadow-bubble transition-transform motion-safe:hover:scale-105',
        myReaction && 'bg-brand-soft',
        mine ? 'self-end' : 'self-start',
      )}
    >
      {top.map((r) => (
        <ReactionEmoji key={reactionKey(r.emoji)} emoji={r.emoji} size={14} />
      ))}
      {total > 1 ? (
        <span className="ml-0.5 text-[12px] font-medium text-muted tabular-nums">{total}</span>
      ) : null}
    </button>
  );
}

/** The Reactions list of a message (tabs per emoji, reactors, Remove). */
export function ReactionsDialog({
  m,
  chat,
  open,
  onClose,
}: {
  m: ClientMessage;
  chat: ChatSummary;
  open: boolean;
  onClose: () => void;
}) {
  if (!open) return null;
  return <ReactionsModal chat={chat} m={m} onClose={onClose} />;
}
