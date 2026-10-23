/**
 * The fold of a run of messages from people I blocked: "2 blocked messages — Show messages"
 * (Hide once open), with the day separator and NEW line its first message would show.
 */
import { memo } from 'react';
import { Ban } from 'lucide-react';
import { DaySeparator, UnreadDivider } from '../bubbles/SystemPill';
import type { BlockedRun, ListRow } from './blockedRuns';

export const BlockedMessagesRow = memo(function BlockedMessagesRow({
  row,
  run,
  onToggle,
}: {
  row: ListRow;
  run: BlockedRun;
  onToggle: (key: string) => void;
}) {
  const noun = run.count === 1 ? 'message' : 'messages';
  return (
    <div data-testid="blocked-messages">
      {row.showDay ? <DaySeparator date={row.message.createdAt} /> : null}
      {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
      <div className="flex items-center gap-3 px-3 py-1 text-[13.5px] text-muted lg:px-5">
        <span className="flex w-10 shrink-0 justify-center" aria-hidden>
          <Ban size={16} />
        </span>
        <span>
          {run.count} blocked {noun}
        </span>
        <span aria-hidden>—</span>
        <button
          type="button"
          aria-expanded={run.expanded}
          onClick={(e) => {
            // The list's own click handling (select mode) must not see it.
            e.stopPropagation();
            onToggle(run.key);
          }}
          className="rounded font-semibold text-link outline-none hover:underline focus-visible:outline-2 focus-visible:outline-brand"
        >
          {run.expanded ? `Hide ${noun}` : `Show ${noun}`}
        </button>
      </div>
    </div>
  );
});
