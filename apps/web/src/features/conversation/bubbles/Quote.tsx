/** Reply quote (inside bubbles and above the composer) and status-reply quote. */
import type { ReactNode } from 'react';
import { Play } from 'lucide-react';
import {
  chatTitle,
  formatDuration,
  renderMentions,
  type MessagePreview,
  type StatusReplyPayload,
} from '@enbox/shared';
import { UpdatesIcon } from '@/components/icons';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { useUserName, useUsers } from '@/stores/users';
import { mentionName, typeIcon } from '@/features/chats/preview';
import { senderColor } from '../lib/senderColor';

function QuoteFrame({
  color,
  children,
  thumb,
  onClick,
  className,
  label,
}: {
  color: string;
  children: ReactNode;
  thumb?: ReactNode;
  onClick?: () => void;
  className?: string;
  label?: string;
}) {
  const inner = (
    <>
      <span className="w-1 shrink-0 self-stretch" style={{ backgroundColor: color }} aria-hidden />
      <span className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-2.5 py-1.5 text-left">
        {children}
      </span>
      {thumb}
    </>
  );
  const classes = cn(
    'flex min-h-12 w-full min-w-0 overflow-hidden rounded-lg bg-black/[0.05] dark:bg-white/[0.07]',
    className,
  );
  return onClick ? (
    <button
      type="button"
      aria-label={label}
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className={cn(
        classes,
        'outline-none hover:bg-black/[0.08] focus-visible:ring-2 focus-visible:ring-brand dark:hover:bg-white/[0.1]',
      )}
    >
      {inner}
    </button>
  ) : (
    <div className={classes}>{inner}</div>
  );
}

function quoteText(p: MessagePreview): string {
  if (p.deleted) return 'This message was deleted';
  const text = p.text ? renderMentions(p.text, mentionName).replace(/\s+/g, ' ').trim() : '';
  if (text) return text;
  switch (p.type) {
    case 'image':
      return 'Photo';
    case 'video':
      return 'Video';
    case 'voice':
      return `Voice message${p.media?.durationMs ? ` (${formatDuration(p.media.durationMs)})` : ''}`;
    case 'audio':
      return p.media?.fileName ?? 'Audio';
    case 'file':
      return p.media?.fileName ?? 'Document';
    case 'location':
      return 'Location';
    case 'contact':
      return 'Contact';
    case 'poll':
      return 'Poll';
    case 'call':
      return 'Call';
    default:
      return 'Message';
  }
}

export function ReplyQuote({
  preview,
  onClick,
  className,
  chatId,
}: {
  preview: MessagePreview;
  onClick?: () => void;
  className?: string;
  /** The chat the quote is shown in: a quote from another chat ("reply privately") names it. */
  chatId?: string;
}) {
  const me = useAuth((s) => s.user?.id);
  const origin = useChats((s) =>
    chatId && preview.chatId !== chatId ? s.byId[preview.chatId] : undefined,
  );
  const dark = useUi((s) => s.resolvedTheme === 'dark');
  const name = useUserName(preview.senderId, { you: 'You' });
  useUsers((s) => s.byId); // mentions inside the quote
  const color = preview.senderId
    ? preview.senderId === me
      ? 'var(--brand)'
      : senderColor(preview.senderId, dark)
    : 'var(--brand)';
  const Icon = preview.deleted ? null : typeIcon(preview.type);
  const thumbSrc =
    !preview.deleted && preview.media && (preview.type === 'image' || preview.type === 'video')
      ? (preview.media.thumbnailUrl ?? (preview.type === 'image' ? preview.media.url : null))
      : null;
  return (
    <QuoteFrame
      color={color}
      onClick={onClick}
      className={className}
      label={
        onClick ? `Go to replied message from ${preview.senderId ? name : 'channel'}` : undefined
      }
      thumb={
        thumbSrc ? (
          <span className="relative size-12 shrink-0">
            <img
              src={mediaUrl(thumbSrc)}
              alt=""
              className="size-full object-cover"
              loading="lazy"
            />
            {preview.type === 'video' ? (
              <Play
                size={14}
                className="absolute inset-0 m-auto fill-white text-white drop-shadow"
                aria-hidden
              />
            ) : null}
          </span>
        ) : null
      }
    >
      <span className="truncate text-[13px] font-semibold" style={{ color }}>
        {preview.senderId ? name : 'Channel'}
        {origin ? <span className="font-normal text-muted"> · {chatTitle(origin, me)}</span> : null}
      </span>
      <span
        className={cn(
          'flex min-w-0 items-center gap-1 text-[13px] text-muted',
          preview.deleted && 'italic',
        )}
      >
        {Icon ? <Icon size={14} className="shrink-0" aria-hidden /> : null}
        <span className="line-clamp-2 break-words">{quoteText(preview)}</span>
      </span>
    </QuoteFrame>
  );
}

export function StatusReplyQuote({ status }: { status: StatusReplyPayload }) {
  const author = useUserName(status.authorId, { you: 'You' });
  const unavailable = !status.available;
  return (
    <QuoteFrame
      color="var(--brand)"
      thumb={
        !unavailable ? (
          status.type === 'text' ? (
            <span
              className="flex size-12 shrink-0 items-center justify-center p-1 text-center text-[8px] leading-tight font-semibold text-white"
              style={{ backgroundColor: status.backgroundColor ?? 'var(--brand)' }}
              aria-hidden
            >
              <span className="line-clamp-3">{status.text}</span>
            </span>
          ) : status.mediaUrl ? (
            <img
              src={mediaUrl(status.mediaUrl)}
              alt=""
              className="size-12 shrink-0 object-cover"
              loading="lazy"
            />
          ) : null
        ) : null
      }
    >
      <span className="flex items-center gap-1 truncate text-[13px] font-semibold text-brand-ink">
        <UpdatesIcon size={14} aria-hidden />
        {author} · Status
      </span>
      <span className={cn('truncate text-[13px] text-muted', unavailable && 'italic')}>
        {unavailable
          ? 'Status unavailable'
          : status.text ||
            (status.type === 'video' ? 'Video' : status.type === 'image' ? 'Photo' : 'Status')}
      </span>
    </QuoteFrame>
  );
}
