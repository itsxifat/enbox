/**
 * Discord's bar pinned over the top of the message list while the NEW line is above the
 * viewport: "12 new messages since 3:14 PM" (a click jumps to the first of them) and Mark As
 * Read on the right. MessageList decides when it shows.
 */
import { MailCheck } from 'lucide-react';
import { formatSinceTime } from '../time/timeFormat';

/** "12 new messages since 3:14 PM" (`since`: the first unread message's time, when loaded). */
export function newMessagesText(count: number, since: string | null): string {
  const text = `${count} new message${count === 1 ? '' : 's'}`;
  return since ? `${text} since ${formatSinceTime(since)}` : text;
}

export function NewMessagesBar({
  count,
  since,
  onJump,
  onMarkRead,
}: {
  count: number;
  since: string | null;
  onJump: () => void;
  onMarkRead: () => void;
}) {
  return (
    <div
      className="pointer-events-none absolute inset-x-3 top-2 z-[3] flex justify-center lg:inset-x-5"
      data-testid="new-messages-bar"
    >
      <div className="pointer-events-auto flex w-full items-center gap-2 rounded-lg bg-brand pr-1 text-[13.5px] text-on-brand shadow-elevated">
        <button
          type="button"
          onClick={onJump}
          title="Jump to the first unread message"
          className="min-w-0 flex-1 truncate rounded-l-lg py-1.5 pl-3 text-left font-medium hover:underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
        >
          {newMessagesText(count, since)}
        </button>
        <button
          type="button"
          onClick={onMarkRead}
          className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-semibold transition-colors hover:bg-white/15 focus-visible:outline-2 focus-visible:outline-white"
        >
          Mark As Read
          <MailCheck size={16} aria-hidden />
        </button>
      </div>
    </div>
  );
}
