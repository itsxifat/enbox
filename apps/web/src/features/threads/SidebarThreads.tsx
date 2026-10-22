import { useNavigate, useParams } from 'react-router';
import { isMuted, type ChatSummary } from '@enbox/shared';
import { Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useSidePanel } from '@/stores/sidePanel';
import { useSidebarThreads } from '@/stores/threads';
import { openThread } from './actions';

/**
 * The active threads I joined or recently viewed, nested under their channel in the channel
 * sidebar (Discord: indented rows on a branch line; unread ones bold). A click opens the
 * thread beside its channel (going to the channel first when another one is open).
 */
export function SidebarThreads({ channel }: { channel: ChatSummary }) {
  const threads = useSidebarThreads(channel.id);
  const openId = useSidePanel((s) => (s.panel?.kind === 'thread' ? s.panel.threadId : null));
  const { chatId } = useParams<{ chatId?: string }>();
  const navigate = useNavigate();
  if (channel.type !== 'space_text' || threads.length === 0) return null;
  const spaceId = channel.space?.spaceId;
  return (
    <ul className="relative mt-0.5 ml-[18px] flex flex-col" aria-label={`Threads in ${channel.name ?? 'channel'}`}>
      {threads.map((t, i) => {
        const active = t.id === openId;
        const unread = t.lastSeq > t.lastReadSeq && !isMuted(t.mutedUntil);
        return (
          <li key={t.id} className="relative">
            {/* Discord's branch: a curve into each row, the trunk on to the next one. */}
            <span aria-hidden className="pointer-events-none absolute top-0 left-0 h-1/2 w-3 rounded-bl-lg border-b-2 border-l-2 border-line-strong" />
            {i < threads.length - 1 ? (
              <span aria-hidden className="pointer-events-none absolute top-1/2 bottom-0 left-0 border-l-2 border-line-strong" />
            ) : null}
            <button
              type="button"
              onClick={() => {
                if (spaceId && chatId !== channel.id) navigate(`/spaces/${spaceId}/${channel.id}`);
                openThread(t.id, channel.id);
              }}
              aria-current={active ? 'true' : undefined}
              title={t.name ?? undefined}
              data-testid="sidebar-thread-row"
              data-unread={unread || undefined}
              className={cn(
                'ml-4 flex h-8 w-[calc(100%-1rem)] min-w-0 items-center gap-1.5 rounded-lg px-2 text-left text-[14px] transition-colors outline-none focus-visible:outline-2 focus-visible:outline-brand',
                active
                  ? 'bg-selected font-semibold text-fg'
                  : unread
                    ? 'font-semibold text-fg hover:bg-hover'
                    : 'text-muted hover:bg-hover hover:text-fg',
              )}
            >
              <span className="min-w-0 flex-1 truncate">{t.name}</span>
              {t.unreadMentionCount > 0 ? <Badge count={t.unreadMentionCount} size="sm" tone="danger" /> : null}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
