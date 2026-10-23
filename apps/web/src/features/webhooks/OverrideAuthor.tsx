/**
 * Message rows for messages no user sent (`Message.authorOverride`; docs/design/
 * discord-parity.md W10-E, W10-F): a webhook's or a followed channel's name and avatar as
 * snapshotted on the message, an APP tag (webhooks) or SERVER tag (crossposts), and under a
 * crosspost's header the "#channel • Space" it came from, which opens the original. The name
 * and the avatar open a small card — the name, what it is, and "Go to original" for
 * crossposts. No profile, DM or mention actions: there is no user behind these.
 */
import { useState, type MouseEvent } from 'react';
import { ArrowUpRight, Megaphone } from 'lucide-react';
import type { Message, MessageAuthorOverride } from '@enbox/shared';
import { Avatar, Button, Popover } from '@/components/ui';
import { messageLink } from '@/features/chats/links';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { cn } from '@/lib/cn';

type Source = NonNullable<MessageAuthorOverride['source']>;

/** What the card calls it. */
export function overrideKindLabel(o: Pick<MessageAuthorOverride, 'kind'>): string {
  return o.kind === 'crosspost' ? 'Followed channel' : 'Webhook';
}

/**
 * "Go to original": the original message in its channel — at its position when I can see
 * it (its seq comes from `GET /api/messages/:id`), else the channel itself.
 */
export async function openOriginal(source: Source): Promise<void> {
  let seq = 0;
  try {
    seq = (await api.get<Message>(`/api/messages/${source.messageId}`)).seq;
  } catch {
    // Not visible to me (or gone): the channel opens without a jump.
  }
  bus.emit('navigate', {
    to: messageLink(source.channelId, seq, source.messageId, `/spaces/${source.spaceId}`),
  });
}

/** APP for webhooks, SERVER for crossposts (the brand pill next to the name). */
export function AuthorTag({
  kind,
  className,
}: {
  kind: MessageAuthorOverride['kind'];
  className?: string;
}) {
  return (
    <span
      data-testid="author-tag"
      className={cn(
        'inline-flex h-[15px] shrink-0 items-center self-center rounded-[3px] bg-brand px-1 text-[10px] leading-none font-semibold tracking-wide text-on-brand',
        className,
      )}
    >
      {kind === 'crosspost' ? 'SERVER' : 'APP'}
    </span>
  );
}

function OverrideAvatarImage({ o, size }: { o: MessageAuthorOverride; size: number }) {
  return (
    <Avatar
      src={o.avatarUrl}
      name={o.name}
      colorSeed={o.webhookId ?? o.name}
      kind={o.kind === 'crosspost' ? 'community' : 'user'}
      size={size}
      decorative
    />
  );
}

/** The card a click on the name or avatar opens. */
function AuthorCard({
  o,
  anchor,
  onClose,
}: {
  o: MessageAuthorOverride;
  anchor: HTMLElement | null;
  onClose: () => void;
}) {
  const source = o.kind === 'crosspost' ? (o.source ?? null) : null;
  return (
    <Popover
      open={!!anchor}
      anchor={anchor}
      onClose={onClose}
      placement="right"
      align="start"
      aria-label={o.name}
      className="w-[280px] max-w-[calc(100vw-16px)]"
    >
      <div className="flex flex-col gap-3 p-4" data-testid="author-card">
        <div className="flex min-w-0 items-center gap-3">
          <OverrideAvatarImage o={o} size={56} />
          <div className="min-w-0">
            <p className="flex min-w-0 items-center gap-1.5 text-[16px] font-bold">
              <span className="truncate">{o.name}</span>
              <AuthorTag kind={o.kind} />
            </p>
            <p className="text-[13px] text-muted">{overrideKindLabel(o)}</p>
          </div>
        </div>
        {source ? (
          <>
            <p className="text-[13px] text-muted">
              Published in <span className="font-semibold text-fg">#{source.channelName}</span> •{' '}
              {source.spaceName}
            </p>
            <Button
              size="sm"
              variant="soft"
              leftIcon={ArrowUpRight}
              onClick={() => {
                onClose();
                void openOriginal(source);
              }}
            >
              Go to original
            </Button>
          </>
        ) : o.kind === 'webhook' ? (
          <p className="text-[13px] text-muted">
            Posted by an app or a service through this channel’s webhook, not by a member.
          </p>
        ) : null}
      </div>
    </Popover>
  );
}

/** Opens the card from a click (a plain click in select mode does nothing here). */
function useAuthorCard(selecting: boolean) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const onClick = (e: MouseEvent<HTMLElement>) => {
    if (selecting) return;
    e.stopPropagation();
    setAnchor(anchor ? null : e.currentTarget);
  };
  return { anchor, onClick, close: () => setAnchor(null) };
}

/** The header's name with its tag (the row's first message). */
export function OverrideAuthorName({
  override: o,
  selecting,
  className,
}: {
  override: MessageAuthorOverride;
  selecting: boolean;
  className?: string;
}) {
  const card = useAuthorCard(selecting);
  return (
    <span className="flex min-w-0 items-baseline gap-1.5" data-testid="override-author">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={!!card.anchor}
        onClick={card.onClick}
        className={cn(
          'min-w-0 truncate rounded px-1 pt-0.5 text-left text-[13px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-brand',
          className,
        )}
      >
        {o.name}
      </button>
      <AuthorTag kind={o.kind} />
      <AuthorCard o={o} anchor={card.anchor} onClose={card.close} />
    </span>
  );
}

/** The header's avatar. */
export function OverrideAvatar({
  override: o,
  selecting,
  size = 40,
}: {
  override: MessageAuthorOverride;
  selecting: boolean;
  size?: number;
}) {
  const card = useAuthorCard(selecting);
  return (
    <>
      <button
        type="button"
        aria-label={`About ${o.name}`}
        aria-haspopup="dialog"
        onClick={card.onClick}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <OverrideAvatarImage o={o} size={size} />
      </button>
      <AuthorCard o={o} anchor={card.anchor} onClose={card.close} />
    </>
  );
}

/** A crosspost's "#channel • Space" under its header: opens the original. */
export function CrosspostSource({ source }: { source: Source }) {
  const label = `#${source.channelName} • ${source.spaceName}`;
  return (
    <button
      type="button"
      aria-label={`Go to original in ${label}`}
      onClick={(e) => {
        e.stopPropagation();
        void openOriginal(source);
      }}
      className="flex max-w-full min-w-0 items-center gap-1 rounded px-1 text-[12px] text-muted hover:text-fg hover:underline focus-visible:outline-2 focus-visible:outline-brand"
    >
      <Megaphone size={12} className="shrink-0" aria-hidden />
      <span className="truncate">{label}</span>
    </button>
  );
}
