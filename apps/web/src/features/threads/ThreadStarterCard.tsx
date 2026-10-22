import { ChevronRight, Lock, MessagesSquare } from 'lucide-react';
import type { Message } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { formatRelativeShort } from '@/lib/format';
import { useChat } from '@/stores/chats';
import { useSidePanel } from '@/stores/sidePanel';
import { openThread } from './actions';

/** "12 Messages" (Discord's wording under a starter message). */
export function messagesLabel(n: number): string {
  return `${n.toLocaleString()} ${n === 1 ? 'Message' : 'Messages'}`;
}

/** "active 5 minutes ago", "active today, 10:42", "active Mar 12, 10:42". */
export function lastActiveLabel(at: string): string {
  return `active ${formatRelativeShort(at).replace(/^(Just|Today|Yesterday)/, (w) => w.toLowerCase())}`;
}

/**
 * The thread card under a thread's starter message (Discord): the thread's name, "N Messages ›"
 * and when it was last active. Opens the thread beside the channel.
 */
export function ThreadStarterCard({ message }: { message: Message }) {
  const ref = message.thread;
  // The live thread when loaded (its count moves with every message), else the message's ref.
  const live = useChat(ref?.id);
  const open = useSidePanel((s) => s.panel?.kind === 'thread' && s.panel.threadId === ref?.id);
  if (!ref) return null;
  const name = live?.name ?? ref.name;
  const count = live?.thread?.messageCount ?? ref.messageCount;
  const archived = live?.thread ? live.thread.archived : ref.archived;
  const locked = !!live?.thread?.locked;
  const last = live?.lastActivityAt ?? ref.lastMessageAt;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        openThread(ref.id, message.chatId, message);
      }}
      aria-label={`Open thread ${name}`}
      aria-pressed={open}
      data-testid="thread-starter-card"
      className={cn(
        'mt-1 flex w-full max-w-[min(100%,480px)] items-center gap-3 rounded-lg bg-surface-2 px-3 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand',
        open && 'ring-1 ring-brand/50',
      )}
    >
      <MessagesSquare size={18} className="shrink-0 text-muted" aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-[14px] font-semibold text-fg">{name}</span>
          <span className="flex shrink-0 items-center text-[13px] font-semibold text-brand-ink">
            {messagesLabel(count)}
            <ChevronRight size={14} aria-hidden />
          </span>
        </span>
        <span className="flex items-center gap-1 truncate text-[12.5px] text-muted">
          {locked ? <Lock size={12} aria-label="Locked" /> : null}
          {archived ? 'Archived · ' : ''}
          {count === 0 ? 'No messages yet' : last ? `Last ${lastActiveLabel(last)}` : null}
        </span>
      </span>
    </button>
  );
}
