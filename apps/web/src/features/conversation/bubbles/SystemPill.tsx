import type { ReactNode } from 'react';
import { Timer } from 'lucide-react';
import { chatKindOf, systemEventText, type ChatSummary } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { formatDaySeparator } from '@/lib/format';
import type { ClientMessage } from '@/stores/messages';
import { nameOf, useUsers } from '@/stores/users';
import { AutoModAlertCard } from '@/features/spaces/automod/AutoModAlertCard';
import { RaidAlertCard } from '@/features/moderation/RaidAlertCard';

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

/** Discord's date divider: a hairline with the date in the middle. */
export function DaySeparator({ date }: { date: string }) {
  return (
    <div
      className="mx-3 mt-4 mb-1 flex items-center gap-2 lg:mx-5"
      role="separator"
      aria-label={formatDaySeparator(date)}
    >
      <span className="h-px flex-1 bg-line-strong" aria-hidden />
      <span className="text-[12px] font-semibold text-subtle">{formatDaySeparator(date)}</span>
      <span className="h-px flex-1 bg-line-strong" aria-hidden />
    </div>
  );
}

/** Discord's "new messages" line: red hairline with a NEW tag on the right. */
export function UnreadDivider({ count }: { count: number }) {
  return (
    <div
      className="relative mx-3 my-2 flex items-center lg:mx-5"
      role="separator"
      aria-label={`${count} unread message${count === 1 ? '' : 's'}`}
      data-testid="unread-divider"
    >
      <span className="h-px flex-1 bg-danger" aria-hidden />
      <span className="rounded-r-[4px] rounded-l-none bg-danger px-1 text-[10px] leading-[13px] font-bold text-white uppercase" aria-hidden>
        New
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
  // AutoMod alerts are a card, not a pill (features/spaces/automod).
  if (m.system.kind === 'automod_alert') return <AutoModAlertCard m={m} event={m.system} />;
  // Raid alerts too (features/moderation).
  if (m.system.kind === 'raid_alert') return <RaidAlertCard m={m} event={m.system} />;
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
