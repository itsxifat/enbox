/** Poll: options with vote bars, single/multiple choice, voter avatars and a "View votes" dialog. */
import { useState } from 'react';
import { Check, ListChecks } from 'lucide-react';
import type { ChatSummary } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { useUserName } from '@/stores/users';
import { isActionable, vote } from '../actions';
import { myVotesOf } from '../lib/optimistic';

function VoterRow({ userId }: { userId: string }) {
  const name = useUserName(userId, { you: 'You' });
  return (
    <li className="flex items-center gap-3 py-1.5">
      <UserAvatar userId={userId} size="sm" />
      <span className="truncate text-[15px]">{name}</span>
    </li>
  );
}

export function PollVotesDialog({
  m,
  open,
  onClose,
}: {
  m: ClientMessage;
  open: boolean;
  onClose: () => void;
}) {
  const poll = m.poll!;
  return (
    <Modal open={open} onClose={onClose} title="Poll details" description={poll.question} size="sm">
      <div className="flex flex-col gap-4 pb-2">
        {poll.options.map((o) => (
          <section key={o.id}>
            <h3 className="flex items-center justify-between gap-2 text-[14px] font-semibold">
              <span className="truncate">{o.text}</span>
              <span className="shrink-0 text-[13px] font-medium text-muted">
                {o.voteCount} vote{o.voteCount === 1 ? '' : 's'}
              </span>
            </h3>
            {o.voterIds.length ? (
              <ul className="mt-1">
                {o.voterIds.map((id) => (
                  <VoterRow key={id} userId={id} />
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[13px] text-subtle">No votes</p>
            )}
          </section>
        ))}
      </div>
    </Modal>
  );
}

export function PollBody({
  m,
  chat,
  mine,
}: {
  m: ClientMessage;
  chat: ChatSummary;
  mine: boolean;
}) {
  const me = useAuth((s) => s.user?.id) ?? '';
  const poll = m.poll!;
  const [votesOpen, setVotesOpen] = useState(false);
  const mineVotes = myVotesOf(poll, me);
  const canVote = isActionable(m) && chat.membership === 'active';
  const anonymous = chat.type === 'channel';
  const maxVotes = Math.max(1, ...poll.options.map((o) => o.voteCount));
  return (
    <div
      className="flex w-[min(320px,72vw)] flex-col gap-1 pt-1"
      role="group"
      aria-label={`Poll: ${poll.question}`}
    >
      <p className="text-[15px] leading-snug font-semibold break-words">{poll.question}</p>
      <p
        className={cn(
          'mb-1 flex items-center gap-1 text-[12px]',
          mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta',
        )}
      >
        <ListChecks size={14} aria-hidden />
        {poll.allowMultiple ? 'Select one or more' : 'Select one'}
      </p>
      {poll.options.map((o) => {
        const selected = mineVotes.includes(o.id);
        const pct = poll.totalVoters ? o.voteCount / poll.totalVoters : 0;
        return (
          <button
            key={o.id}
            type="button"
            role={poll.allowMultiple ? 'checkbox' : 'radio'}
            aria-checked={selected}
            disabled={!canVote}
            onClick={(e) => {
              e.stopPropagation();
              void vote(chat, m, o.id);
            }}
            className="group/opt flex w-full items-start gap-2.5 rounded-lg px-1 py-1.5 text-left enabled:hover:bg-black/[0.04] disabled:cursor-default dark:enabled:hover:bg-white/5"
          >
            <span
              className={cn(
                'mt-0.5 flex size-5 shrink-0 items-center justify-center border-2 transition-colors',
                poll.allowMultiple ? 'rounded-md' : 'rounded-full',
                selected ? 'border-brand bg-brand text-on-brand' : 'border-current opacity-50',
              )}
              aria-hidden
            >
              {selected ? <Check size={14} strokeWidth={ICON_STROKE_BOLD} /> : null}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-1.5">
              <span className="flex items-start justify-between gap-2">
                <span className="text-[14px] leading-snug break-words">{o.text}</span>
                <span className="flex shrink-0 items-center gap-1">
                  {!anonymous && o.voterIds.length ? (
                    <span className="flex -space-x-1.5">
                      {o.voterIds.slice(0, 3).map((id) => (
                        <UserAvatar
                          key={id}
                          userId={id}
                          size={18}
                          className="rounded-full ring-2 ring-bubble-in"
                        />
                      ))}
                    </span>
                  ) : null}
                  <span className="min-w-4 text-right text-[13px] font-medium tabular-nums">
                    {o.voteCount}
                  </span>
                </span>
              </span>
              <span
                className="relative h-1.5 w-full overflow-hidden rounded-full bg-black/10 dark:bg-white/15"
                aria-hidden
              >
                <span
                  className={cn(
                    'absolute inset-y-0 left-0 rounded-full transition-[width] duration-300',
                    o.voteCount === maxVotes && o.voteCount > 0 ? 'bg-brand' : 'bg-brand/60',
                  )}
                  style={{ width: `${pct * 100}%` }}
                />
              </span>
            </span>
          </button>
        );
      })}
      <div className="mt-1 flex items-center justify-between border-t border-black/10 pt-1.5 dark:border-white/10">
        <span className={cn('text-[12px]', mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta')}>
          {poll.totalVoters} voter{poll.totalVoters === 1 ? '' : 's'}
        </span>
        {!anonymous && poll.totalVoters > 0 ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setVotesOpen(true);
            }}
            className="rounded-full px-2.5 py-1 text-[13px] font-semibold text-brand-ink hover:bg-black/5 dark:hover:bg-white/10"
          >
            View votes
          </button>
        ) : null}
      </div>
      {votesOpen ? <PollVotesDialog m={m} open onClose={() => setVotesOpen(false)} /> : null}
    </div>
  );
}
