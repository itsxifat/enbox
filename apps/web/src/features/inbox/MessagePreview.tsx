/**
 * A compact, Discord-style message for the Inbox cards: the author's avatar and name (their
 * Space nickname and role colour in a Space, profile card on click), the time, and the text as
 * rich text (attachments as a one-line label). System messages are a muted line.
 */
import type { ID, Message } from '@enbox/shared';
import { PreviewLine, previewParts } from '@/features/chats/preview';
import { SenderAvatar, SenderName } from '@/features/conversation/MessageRow';
import { RichText } from '@/features/conversation/bubbles/RichText';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { formatInboxTime } from './lib';

export function MessagePreview({
  message: m,
  spaceId,
  className,
}: {
  message: Message;
  /** Space channels: nicknames, role colours and per-Space avatars of that Space. */
  spaceId: ID | null;
  className?: string;
}) {
  const me = useAuth((s) => s.user?.id);
  // Discord shows your own name, not "You".
  const myName = useAuth((s) => s.user?.displayName ?? 'You');
  if (m.type === 'system' || !m.senderId) {
    return (
      <div className={cn('flex min-w-0 items-center gap-2 text-[13px] text-muted', className)}>
        <PreviewLine parts={previewParts(m, { meId: me })} />
        <time dateTime={m.createdAt} className="shrink-0 text-[11.5px]">
          {formatInboxTime(m.createdAt)}
        </time>
      </div>
    );
  }
  return (
    <div className={cn('flex min-w-0 items-start gap-3', className)} data-animate-avatars>
      <span className="mt-0.5 shrink-0">
        <SenderAvatar userId={m.senderId} selecting={false} size={36} spaceId={spaceId} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2">
          <SenderName userId={m.senderId} selecting={false} you={myName} spaceId={spaceId} className="text-[14.5px]" />
          <time dateTime={m.createdAt} className="shrink-0 text-[11.5px] text-muted">
            {formatInboxTime(m.createdAt)}
          </time>
        </div>
        {m.deletedAt ? (
          <p className="text-[14px] text-muted italic">This message was deleted</p>
        ) : (
          <>
            {m.text ? (
              <div className="line-clamp-6 text-[14.5px] leading-[1.375] break-words text-fg [overflow-wrap:anywhere]">
                <RichText text={m.text} />
              </div>
            ) : null}
            {m.type !== 'text' ? (
              <PreviewLine
                parts={previewParts({ ...m, text: null }, { meId: me })}
                className="mt-0.5 text-[13px] text-muted"
              />
            ) : null}
            {m.editedAt ? <span className="text-[11px] text-subtle">(edited)</span> : null}
          </>
        )}
      </div>
    </div>
  );
}
