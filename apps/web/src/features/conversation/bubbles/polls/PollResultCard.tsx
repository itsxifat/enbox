/**
 * The message posted when a poll ends: who asked what, the winning answer with its emoji and
 * share ("It's a tie" / "No one voted") and View Poll, which jumps to the poll (loading
 * around it when it is not in the loaded window). SystemPill renders it for
 * `system.kind === 'poll_result'`.
 */
import { BarChart3 } from 'lucide-react';
import type { Message, SystemEvent } from '@enbox/shared';
import { Button } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/stores/auth';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { useUserName } from '@/stores/users';
import { useConversationUi } from '../../state';
import { ReactionEmoji } from '../reactions/ReactionEmoji';
import { percentOf } from './model';

type PollResult = Extract<SystemEvent, { kind: 'poll_result' }>;

function Asker({ authorId }: { authorId: string | null }) {
  const me = useAuth((s) => s.user?.id);
  const name = useUserName(authorId);
  if (!authorId) return <>A poll</>;
  if (authorId === me) return <>Your poll</>;
  return (
    <>
      <b className="font-semibold text-fg">{name}</b>’s poll
    </>
  );
}

function Outcome({ event }: { event: PollResult }) {
  const [top, ...tied] = event.winners;
  if (!top || event.totalVoters === 0) return <span className="text-muted">No one voted</span>;
  if (tied.length)
    return (
      <span className="min-w-0 truncate">
        <span className="font-semibold">It’s a tie</span>
        <span className="text-muted"> · {event.winners.map((w) => w.text).join(', ')}</span>
      </span>
    );
  return (
    <span className="flex min-w-0 items-center gap-1.5">
      {top.emoji ? <ReactionEmoji emoji={top.emoji} size={16} /> : null}
      <span className="truncate font-semibold">{top.text}</span>
      <span className="shrink-0 text-muted">
        · Winning answer · {percentOf(top.votes, event.totalVoters)}%
      </span>
    </span>
  );
}

export function PollResultCard({
  m,
  event,
  onJump,
}: {
  m: ClientMessage;
  event: PollResult;
  onJump?: (messageId: string) => void;
}) {
  const view = () => {
    const id = event.pollMessageId;
    const loaded = useMessages.getState().byChat[m.chatId]?.items.some((x) => x.id === id);
    if (loaded && onJump) {
      onJump(id);
      return;
    }
    void api.get<Message>(`/api/messages/${id}`).then(
      (poll) => useConversationUi.getState().requestJump(m.chatId, poll.seq, poll.id),
      (e: unknown) => toast.error(e),
    );
  };
  return (
    <div className="flex justify-center px-4 py-1" data-testid="poll-result-card">
      <div className="flex w-full max-w-[min(92%,460px)] items-center gap-3 rounded-lg bg-surface/95 px-3 py-2 shadow-bubble backdrop-blur-sm">
        <span
          className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink"
          aria-hidden
        >
          <BarChart3 size={18} />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5 text-[13px] leading-snug">
          <p className="break-words text-muted">
            <Asker authorId={event.authorId} />{' '}
            <b className="font-semibold text-fg">{event.question}</b> has closed
          </p>
          <p className="flex min-w-0 text-fg">
            <Outcome event={event} />
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={view}>
          View Poll
        </Button>
      </div>
    </div>
  );
}
