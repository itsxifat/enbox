import type { ReactNode } from 'react';
import { Timer } from 'lucide-react';
import { chatKindOf, systemEventText, type ChatSummary } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { formatDaySeparator } from '@/lib/format';
import type { ClientMessage } from '@/stores/messages';
import { nameOf, useUsers } from '@/stores/users';

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className="flex justify-center px-4 py-1">
      <div
        className={cn(
          'max-w-[min(90%,520px)] rounded-lg bg-surface/95 px-3 py-1.5 text-center text-[12.5px] leading-snug text-muted shadow-bubble backdrop-blur-sm',
          className,
        )}
      >
        {children}
      </div>
    </div>
  );
}

export function DaySeparator({ date }: { date: string }) {
  return (
    <div
      className="flex justify-center py-2"
      role="separator"
      aria-label={formatDaySeparator(date)}
    >
      <span className="rounded-lg bg-surface/95 px-3 py-1 text-[12.5px] font-medium text-muted shadow-bubble backdrop-blur-sm">
        {formatDaySeparator(date)}
      </span>
    </div>
  );
}

export function UnreadDivider({ count }: { count: number }) {
  return (
    <div
      className="my-2 flex justify-center bg-surface/60 py-1 backdrop-blur-sm"
      role="separator"
      data-testid="unread-divider"
    >
      <span className="rounded-full bg-surface px-3 py-0.5 text-[12.5px] font-semibold text-brand-ink shadow-bubble">
        {count} unread message{count === 1 ? '' : 's'}
      </span>
    </div>
  );
}

export function SystemPill({
  m,
  chat,
  onJump,
}: {
  m: ClientMessage;
  chat: Pick<ChatSummary, 'type' | 'isAnnouncement'>;
  onJump?: (messageId: string) => void;
}) {
  // Re-render when the actors' profiles arrive.
  useUsers((s) => s.byId);
  if (!m.system) return null;
  const text = systemEventText(m.system, (id) => nameOf(id), chatKindOf(chat));
  const pinned = m.system.kind === 'message_pinned' ? m.system.messageId : null;
  const timer = m.system.kind === 'disappearing_changed';
  return (
    <Pill>
      {pinned && onJump ? (
        <button type="button" className="hover:underline" onClick={() => onJump(pinned)}>
          {text}
        </button>
      ) : (
        <span className="inline-flex items-center gap-1.5">
          {timer ? <Timer size={14} aria-hidden /> : null}
          {text}
        </span>
      )}
    </Pill>
  );
}
