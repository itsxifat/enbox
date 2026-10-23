/**
 * A poll, Discord's card: the question, "Select one answer" / "Select one or more answers"
 * and the answers with their emoji; I pick answers, then Vote. Results stay hidden until I
 * vote (Show results peeks, Back to voting returns); after voting, or once the poll ended:
 * bars with shares and counts, my answers checked and, when it ended, the winners marked.
 * The footer counts the votes with the time left — ticking each minute, the poll reads as
 * closed the moment its end passes, before the server's update arrives — or "Poll closed",
 * with Remove vote while open and View votes where voters are named (direct chats, groups).
 */
import { useEffect, useState, type MouseEvent } from 'react';
import { Check, Trophy } from 'lucide-react';
import type { ChatSummary, Poll } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ICON_STROKE_BOLD } from '@/components/icons';
import { Button, Modal } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { useUserName } from '@/stores/users';
import { isActionable } from '../actions';
import { myVotesOf } from '../lib/optimistic';
import { useRowAppearance } from './appearance';
import {
  listsVoters,
  nextTickIn,
  percentOf,
  pollEnded,
  timeLeftLabel,
  votesLabel,
  winningOptionIds,
} from './polls/model';
import { castVote } from './polls/pollActions';
import { ReactionEmoji } from './reactions/ReactionEmoji';

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
              <span className="flex min-w-0 items-center gap-2">
                {o.emoji ? <ReactionEmoji emoji={o.emoji} size={18} /> : null}
                <span className="truncate">{o.text}</span>
              </span>
              <span className="shrink-0 text-[13px] font-medium text-muted">
                {votesLabel(o.voteCount)}
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

/** The time, read again when the countdown's minute changes and when the poll ends. */
function usePollClock(endsAt: string | null | undefined, running: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!endsAt || !running) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      setNow(Date.now());
      const wait = nextTickIn(endsAt);
      if (wait > 0) timer = setTimeout(tick, wait);
    };
    timer = setTimeout(tick, nextTickIn(endsAt));
    return () => clearTimeout(timer);
  }, [endsAt, running]);
  return now;
}

/** A click handler that keeps the click from reaching the row (selection, actions). */
const own = (fn: () => void) => (e: MouseEvent) => {
  e.stopPropagation();
  fn();
};

const LINK =
  'rounded font-semibold text-brand-ink hover:underline focus-visible:outline-2 focus-visible:outline-brand disabled:opacity-50';

function ResultRow({
  option: o,
  poll,
  mine,
  winner,
  surface,
}: {
  option: Poll['options'][number];
  poll: Poll;
  mine: boolean;
  winner: boolean;
  surface: string;
}) {
  const pct = percentOf(o.voteCount, poll.totalVoters);
  const label = [
    `${o.text}: ${votesLabel(o.voteCount)}, ${pct}%`,
    mine ? 'your vote' : null,
    winner ? 'winning answer' : null,
  ];
  return (
    <li
      className={cn(
        'relative flex items-center gap-2.5 overflow-hidden rounded-lg px-3 py-2',
        surface,
      )}
      aria-label={label.filter(Boolean).join(', ')}
      data-testid="poll-result"
      data-winner={winner || undefined}
    >
      <span
        className={cn(
          'absolute inset-y-0 left-0 transition-[width] duration-300',
          winner ? 'bg-brand/35' : mine ? 'bg-brand/25' : 'bg-brand/15',
        )}
        style={{ width: `${pct}%` }}
        aria-hidden
      />
      <span className="relative flex min-w-0 flex-1 items-center gap-2" aria-hidden>
        {o.emoji ? <ReactionEmoji emoji={o.emoji} size={20} /> : null}
        <span
          className={cn(
            'min-w-0 text-[14.5px] leading-snug break-words',
            winner && 'font-semibold',
          )}
        >
          {o.text}
        </span>
        {mine ? (
          <span className="flex size-4 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand">
            <Check size={11} strokeWidth={ICON_STROKE_BOLD} />
          </span>
        ) : null}
        {winner ? <Trophy size={15} className="shrink-0 text-brand-ink" /> : null}
      </span>
      <span className="relative flex shrink-0 items-baseline gap-1.5 tabular-nums" aria-hidden>
        <span className="text-[12px] opacity-70">{votesLabel(o.voteCount)}</span>
        <span className="text-[13.5px] font-semibold">{pct}%</span>
      </span>
    </li>
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
  const cozy = useRowAppearance().bubbleStyle === 'cozy';
  const now = usePollClock(poll.endsAt, !poll.closedAt);
  const [peek, setPeek] = useState(false);
  const [draft, setDraft] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [votesOpen, setVotesOpen] = useState(false);
  const ended = pollEnded(poll, now);
  const myVotes = myVotesOf(poll, me);
  const voted = myVotes.length > 0;
  const canVote = !ended && isActionable(m) && chat.membership === 'active';
  const results = ended || voted || peek || chat.membership !== 'active';
  const winners = ended ? winningOptionIds(poll) : null;
  const meta = cozy ? 'text-muted' : mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta';
  // Answers sit on the card (Space rows) or on the bubble's own colour.
  const surface = cozy ? 'bg-surface' : 'bg-black/[0.05] dark:bg-white/[0.07]';
  const hover = cozy
    ? 'enabled:hover:bg-hover'
    : 'enabled:hover:bg-black/[0.09] dark:enabled:hover:bg-white/[0.11]';
  const status = ended ? 'Poll closed' : poll.endsAt ? timeLeftLabel(poll.endsAt, now) : null;

  const pick = (id: string) =>
    setDraft((d) =>
      poll.allowMultiple
        ? d.includes(id)
          ? d.filter((x) => x !== id)
          : [...d, id]
        : d.includes(id)
          ? []
          : [id],
    );
  const submit = async (optionIds: string[]) => {
    setBusy(true);
    const ok = await castVote(chat, m, optionIds);
    setBusy(false);
    if (ok) {
      setDraft([]);
      setPeek(false);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-2',
        cozy ? 'card-inset w-full max-w-[440px] p-3' : 'w-[min(340px,72vw)] pt-1',
      )}
      role="group"
      aria-label={`Poll: ${poll.question}`}
      data-testid="poll"
    >
      <div>
        <p className="text-[15px] leading-snug font-semibold break-words">{poll.question}</p>
        <p className={cn('mt-0.5 text-[12.5px]', meta)}>
          {poll.allowMultiple ? 'Select one or more answers' : 'Select one answer'}
        </p>
      </div>
      {results ? (
        <ul className="flex flex-col gap-1.5" aria-label="Results">
          {poll.options.map((o) => (
            <ResultRow
              key={o.id}
              option={o}
              poll={poll}
              mine={myVotes.includes(o.id)}
              winner={!!winners?.has(o.id)}
              surface={surface}
            />
          ))}
        </ul>
      ) : (
        <div
          className="flex flex-col gap-1.5"
          role={poll.allowMultiple ? 'group' : 'radiogroup'}
          aria-label="Answers"
        >
          {poll.options.map((o) => {
            const selected = draft.includes(o.id);
            return (
              <button
                key={o.id}
                type="button"
                role={poll.allowMultiple ? 'checkbox' : 'radio'}
                aria-checked={selected}
                disabled={!canVote || busy}
                onClick={own(() => pick(o.id))}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-[box-shadow,background-color] outline-none focus-visible:outline-2 focus-visible:outline-brand disabled:cursor-default',
                  selected ? 'bg-brand/10 ring-2 ring-brand ring-inset' : [surface, hover],
                )}
              >
                {o.emoji ? <ReactionEmoji emoji={o.emoji} size={20} /> : null}
                <span className="min-w-0 flex-1 text-[14.5px] leading-snug break-words">
                  {o.text}
                </span>
                <span
                  className={cn(
                    'flex size-5 shrink-0 items-center justify-center border-2 transition-colors',
                    poll.allowMultiple ? 'rounded-md' : 'rounded-full',
                    selected ? 'border-brand bg-brand text-on-brand' : 'border-current opacity-40',
                  )}
                  aria-hidden
                >
                  {selected ? <Check size={13} strokeWidth={ICON_STROKE_BOLD} /> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}
      <div
        className={cn('flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 text-[12.5px]', meta)}
      >
        <span data-testid="poll-status">
          {votesLabel(poll.totalVoters)}
          {status ? ` · ${status}` : ''}
        </span>
        {canVote && !voted ? (
          <button type="button" className={LINK} onClick={own(() => setPeek((p) => !p))}>
            {peek ? 'Back to voting' : 'Show results'}
          </button>
        ) : null}
        {canVote && voted ? (
          <button
            type="button"
            className={LINK}
            disabled={busy}
            onClick={own(() => void submit([]))}
          >
            Remove vote
          </button>
        ) : null}
        {results && listsVoters(chat) && poll.totalVoters > 0 ? (
          <button type="button" className={LINK} onClick={own(() => setVotesOpen(true))}>
            View votes
          </button>
        ) : null}
        {!results ? (
          <Button
            size="sm"
            className="ml-auto"
            disabled={!canVote || draft.length === 0}
            loading={busy}
            onClick={own(() => void submit(draft))}
          >
            Vote
          </Button>
        ) : null}
      </div>
      {votesOpen ? <PollVotesDialog m={m} open onClose={() => setVotesOpen(false)} /> : null}
    </div>
  );
}
