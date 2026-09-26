/** Bubble footer: [star] [edited] time [ticks]. */
import { Star } from 'lucide-react';
import { tickStatus, type ChatSummary } from '@enbox/shared';
import { cn } from '@/lib/cn';
import { formatTime } from '@/lib/format';
import type { ClientMessage } from '@/stores/messages';
import { Ticks } from './Ticks';

export type MetaVariant = 'inline' | 'overlay' | 'pill';

export function MetaContent({
  m,
  mine,
  chat,
  spacer = false,
}: {
  m: ClientMessage;
  mine: boolean;
  chat: Pick<ChatSummary, 'type' | 'readWatermark' | 'deliveredWatermark'>;
  /** Invisible layout copy: same width, no semantics. */
  spacer?: boolean;
}) {
  const status = mine && !m.deletedAt ? (m.failed ? 'failed' : tickStatus(m, chat)) : null;
  return (
    <>
      {m.starred ? (
        spacer ? (
          <span className="inline-block w-3" />
        ) : (
          <Star size={12} className="shrink-0 fill-current" aria-label="Starred" />
        )
      ) : null}
      {m.editedAt && !m.deletedAt ? <span>Edited</span> : null}
      <time dateTime={m.createdAt} className="tabular-nums">
        {formatTime(m.createdAt)}
      </time>
      {status ? (
        spacer ? (
          <span className="inline-block w-4" />
        ) : (
          <Ticks status={status} size={16} />
        )
      ) : null}
    </>
  );
}

export function Meta({
  m,
  mine,
  chat,
  variant = 'inline',
  className,
}: {
  m: ClientMessage;
  mine: boolean;
  chat: Pick<ChatSummary, 'type' | 'readWatermark' | 'deliveredWatermark'>;
  variant?: MetaVariant;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'pointer-events-none inline-flex items-center gap-1 text-[11px] leading-none whitespace-nowrap select-none',
        variant === 'inline' && (mine ? 'text-bubble-out-meta' : 'text-bubble-in-meta'),
        variant === 'overlay' &&
          'rounded-full bg-black/35 px-1.5 py-1 text-white [&_[data-status=read]]:text-sky-300',
        variant === 'pill' &&
          (mine
            ? 'rounded-full bg-bubble-out px-2 py-1 text-bubble-out-meta shadow-bubble'
            : 'rounded-full bg-bubble-in px-2 py-1 text-bubble-in-meta shadow-bubble'),
        className,
      )}
    >
      <MetaContent m={m} mine={mine} chat={chat} />
    </span>
  );
}

/**
 * Inline spacer + absolutely positioned meta (WhatsApp layout): the invisible copy reserves
 * room at the end of the last text line so the visible meta never overlaps text.
 */
export function InlineMeta({
  m,
  mine,
  chat,
}: {
  m: ClientMessage;
  mine: boolean;
  chat: Pick<ChatSummary, 'type' | 'readWatermark' | 'deliveredWatermark'>;
}) {
  return (
    <>
      <span
        aria-hidden
        className="invisible ml-2 inline-flex items-center gap-1 text-[11px] leading-none"
      >
        <MetaContent m={m} mine={mine} chat={chat} spacer />
      </span>
      <Meta m={m} mine={mine} chat={chat} className="absolute right-2 bottom-1.5" />
    </>
  );
}
