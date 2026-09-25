/** Reaction pill under a bubble and the "who reacted" dialog. */
import { useMemo, useState } from 'react';
import type { ChatSummary, ReactionSummary } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Modal, Tabs } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { useUserName } from '@/stores/users';
import { canReact, react } from '../actions';

export function ReactionPill({
  reactions,
  mine,
  onClick,
  myReaction,
}: {
  reactions: ReactionSummary[];
  mine: boolean;
  onClick: () => void;
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
      aria-label={`Reactions: ${reactions.map((r) => `${r.emoji} ${r.count}`).join(', ')}`}
      className={cn(
        'flex h-6 items-center gap-0.5 rounded-full border border-surface bg-elevated px-1.5 text-[13px] leading-none shadow-bubble transition-transform hover:scale-105',
        myReaction && 'bg-brand-soft',
        mine ? 'self-end' : 'self-start',
      )}
    >
      {top.map((r) => (
        <span key={r.emoji} aria-hidden>
          {r.emoji}
        </span>
      ))}
      {total > 1 ? (
        <span className="ml-0.5 text-[12px] font-medium text-muted tabular-nums">{total}</span>
      ) : null}
    </button>
  );
}

function ReactorRow({
  userId,
  emoji,
  onRemove,
}: {
  userId: string;
  emoji: string;
  onRemove?: () => void;
}) {
  const name = useUserName(userId, { you: 'You' });
  return (
    <li>
      <button
        type="button"
        disabled={!onRemove}
        onClick={onRemove}
        className="flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left enabled:hover:bg-hover disabled:cursor-default"
      >
        <UserAvatar userId={userId} size="md" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-[15px] font-medium">{name}</span>
          {onRemove ? <span className="text-[12px] text-muted">Tap to remove</span> : null}
        </span>
        <span className="text-2xl" aria-label={`reacted ${emoji}`}>
          {emoji}
        </span>
      </button>
    </li>
  );
}

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
  const me = useAuth((s) => s.user?.id);
  const [tab, setTab] = useState('all');
  const anonymous = chat.type === 'channel';
  const total = m.reactions.reduce((n, r) => n + r.count, 0);
  const entries = useMemo(() => {
    const out: { userId: string; emoji: string }[] = [];
    for (const r of m.reactions) for (const u of r.userIds) out.push({ userId: u, emoji: r.emoji });
    // Mine first, like WhatsApp.
    return out.sort((a, b) => (a.userId === me ? -1 : b.userId === me ? 1 : 0));
  }, [m.reactions, me]);
  const shown = tab === 'all' ? entries : entries.filter((e) => e.emoji === tab);
  // Former members (and anyone else who can't react any more) can't remove theirs either.
  const removable = canReact(chat, m);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${total} reaction${total === 1 ? '' : 's'}`}
      size="sm"
    >
      <Tabs
        variant="underline"
        aria-label="Reactions"
        value={m.reactions.some((r) => r.emoji === tab) ? tab : 'all'}
        onChange={setTab}
        items={[
          { value: 'all', label: `All ${total}` },
          ...m.reactions.map((r) => ({ value: r.emoji, label: `${r.emoji} ${r.count}` })),
        ]}
        className="-mx-2"
      />
      {anonymous ? (
        <ul className="flex flex-col gap-1 py-3">
          {m.reactions.map((r) => (
            <li key={r.emoji} className="flex items-center justify-between px-2 py-1.5 text-[15px]">
              <span className="text-2xl">{r.emoji}</span>
              <span className="text-muted tabular-nums">{r.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="flex flex-col py-2">
          {shown.map((e) => (
            <ReactorRow
              key={`${e.userId}:${e.emoji}`}
              userId={e.userId}
              emoji={e.emoji}
              onRemove={
                e.userId === me && removable
                  ? () => {
                      onClose();
                      void react(chat, m, null);
                    }
                  : undefined
              }
            />
          ))}
        </ul>
      )}
    </Modal>
  );
}
