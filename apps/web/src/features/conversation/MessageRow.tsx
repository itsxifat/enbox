/**
 * One conversation row: optional day separator / unread divider, then a system pill or a
 * message bubble (sender name, forwarded label, quotes, typed content, meta, reactions).
 * Interactions: hover chevron + reaction button and right-click (desktop), long-press sheet
 * and swipe-right-to-reply (touch), click-to-toggle in select mode.
 */
import {
  memo,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { Ban, Check, ChevronDown, FastForward, Forward, RotateCw, SmilePlus } from 'lucide-react';
import { FORWARDED_MANY_TIMES_THRESHOLD, type ChatSummary } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';
import { useUserName } from '@/stores/users';
import { useLongPress } from '@/features/chats/useLongPress';
import { canReact, canReply, retry, startReply } from './actions';
import { AudioFileBody, VoiceBody } from './bubbles/AudioBody';
import { CallBody, ContactBody, FileBody, LocationBody } from './bubbles/CardBodies';
import { MediaBody } from './bubbles/MediaBody';
import { InlineMeta, Meta } from './bubbles/Meta';
import { PollBody } from './bubbles/PollBody';
import { ReplyQuote, StatusReplyQuote } from './bubbles/Quote';
import { ReactionPill, ReactionsDialog } from './bubbles/Reactions';
import { RichText } from './bubbles/RichText';
import { DaySeparator, SystemPill, UnreadDivider } from './bubbles/SystemPill';
import { emojiOnlyCount } from './lib/richText';
import type { Row } from './lib/rows';
import { senderColor } from './lib/senderColor';
import { useConversationUi, useIsSelected, useSelecting } from './state';

export interface MessageRowProps {
  row: Row;
  chat: ChatSummary;
  /** Scroll to a message (reply quotes, pinned system messages). */
  onJump: (seq: number, messageId: string) => void;
  onJumpById: (messageId: string) => void;
}

function Tail({ mine }: { mine: boolean }) {
  return (
    <svg
      viewBox="0 0 8 13"
      width="8"
      height="13"
      aria-hidden
      className={cn('absolute top-0', mine ? '-right-2 text-bubble-out' : '-left-2 text-bubble-in')}
    >
      {mine ? (
        <path d="M0 0h5.5C7.5 0 8 1.2 7 2.6L0 12.6V0z" fill="currentColor" />
      ) : (
        <path d="M8 0H2.5C.5 0 0 1.2 1 2.6l7 10V0z" fill="currentColor" />
      )}
    </svg>
  );
}

function SenderName({ userId }: { userId: string }) {
  const name = useUserName(userId);
  const dark = useUi((s) => s.resolvedTheme === 'dark');
  return (
    <span
      className="block truncate px-1 pt-0.5 text-[13px] font-semibold"
      style={{ color: senderColor(userId, dark) }}
    >
      {name}
    </span>
  );
}

function ForwardedLabel({ count }: { count: number }) {
  const many = count >= FORWARDED_MANY_TIMES_THRESHOLD;
  const Icon = many ? FastForward : Forward;
  return (
    <span className="flex items-center gap-1 px-1 pt-0.5 text-[12px] text-muted italic">
      <Icon size={13} aria-hidden />
      {many ? 'Forwarded many times' : 'Forwarded'}
    </span>
  );
}

export const MessageRow = memo(function MessageRow({
  row,
  chat,
  onJump,
  onJumpById,
}: MessageRowProps) {
  const m = row.message;
  const { mine } = row;
  const selecting = useSelecting(chat.id);
  const selected = useIsSelected(chat.id, m.id);
  const highlightToken = useConversationUi((s) =>
    s.highlight?.messageId === m.id ? s.highlight.token : 0,
  );
  const search = useConversationUi((s) => s.search[chat.id] ?? null);
  const menuOpen = useConversationUi((s) => s.action?.messageId === m.id);
  const toolbarRef = useRef<HTMLDivElement>(null);
  // A menu/popover anchored on the toolbar keeps it on screen (it is the menu's anchor).
  const toolbarAnchored = useConversationUi(
    (s) =>
      s.action?.messageId === m.id &&
      s.action.anchor instanceof HTMLElement &&
      !!toolbarRef.current?.contains(s.action.anchor),
  );
  const [flash, setFlash] = useState(false);
  const [reactionsOpen, setReactionsOpen] = useState(false);
  const [dx, setDx] = useState(0);
  const swipe = useRef<{ x: number; y: number; active: boolean } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!highlightToken) return;
    setFlash(true);
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
  }, [highlightToken]);

  const replyable = canReply(chat, m);

  const open = (mode: 'menu' | 'sheet' | 'react', anchor: HTMLElement | { x: number; y: number }) =>
    useConversationUi.getState().openActions({ chatId: chat.id, messageId: m.id, anchor, mode });

  const longPress = useLongPress(
    () => {
      if (!selecting && bubbleRef.current) open('sheet', bubbleRef.current);
    },
    { enabled: m.type !== 'system' },
  );

  if (m.type === 'system') {
    return (
      <div data-testid="message" data-type="system" data-message-id={m.id}>
        {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
        {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
        <SystemPill m={m} chat={chat} onJump={onJumpById} />
      </div>
    );
  }

  const toggleSelected = () => useConversationUi.getState().toggleSelect(chat.id, m.id);

  const onContextMenu = (e: MouseEvent) => {
    if (selecting) return;
    e.preventDefault();
    open('menu', { x: e.clientX, y: e.clientY });
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    longPress.onPointerDown(e);
    if (e.pointerType !== 'mouse' && replyable && !selecting)
      swipe.current = { x: e.clientX, y: e.clientY, active: false };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    longPress.onPointerMove(e);
    const s = swipe.current;
    if (!s) return;
    const ddx = e.clientX - s.x;
    const ddy = e.clientY - s.y;
    if (!s.active) {
      if (Math.abs(ddy) > 12) swipe.current = null;
      else if (ddx > 12 && ddx > Math.abs(ddy) * 1.5) s.active = true;
    }
    if (s.active) setDx(Math.max(0, Math.min(84, ddx * 0.6)));
  };
  const endSwipe = (e: PointerEvent<HTMLDivElement>) => {
    longPress.onPointerUp(e);
    if (swipe.current?.active && dx > 52) startReply(chat, m);
    swipe.current = null;
    setDx(0);
  };

  const isGroupish = chat.type === 'group';
  const showSender = isGroupish && !mine && row.firstInGroup && !!m.senderId;
  const showAvatar = isGroupish && !mine;
  const deleted = !!m.deletedAt;
  const emojiCount =
    m.type === 'text' && !deleted && !m.replyTo && !m.forwardCount && !m.statusReply
      ? emojiOnlyCount(m.text)
      : 0;
  const bare = emojiCount > 0;
  const hasHeader =
    showSender ||
    (m.forwardCount > 0 && !deleted) ||
    (!!m.replyTo && !deleted) ||
    (!!m.statusReply && !deleted);
  const visual = !deleted && (m.type === 'image' || m.type === 'video') && !!m.media;
  const caption = !deleted && m.text ? m.text : null;

  let content: ReactNode;
  if (deleted) {
    content = (
      <div className="relative px-1.5 pt-1 pb-1.5 text-chat text-muted italic">
        <Ban size={15} className="mr-1.5 inline -translate-y-px" aria-hidden />
        {mine ? 'You deleted this message' : 'This message was deleted'}
        <InlineMeta m={m} mine={mine} chat={chat} />
      </div>
    );
  } else if (bare) {
    content = (
      <div className="flex flex-col items-end gap-1">
        <span
          className={cn(
            'leading-tight',
            emojiCount === 1 ? 'text-[52px]' : emojiCount === 2 ? 'text-[44px]' : 'text-[38px]',
          )}
          aria-label={m.text ?? undefined}
        >
          {m.text}
        </span>
        <Meta m={m} mine={mine} chat={chat} variant="pill" />
      </div>
    );
  } else if (m.type === 'text') {
    content = (
      <div className="relative px-1.5 pt-1 pb-1.5 text-chat leading-[1.38] break-words whitespace-pre-wrap text-fg">
        <RichText text={m.text ?? ''} highlight={search} />
        <InlineMeta m={m} mine={mine} chat={chat} />
      </div>
    );
  } else if (visual) {
    const r = hasHeader ? 'rounded-md' : caption ? 'rounded-md' : 'rounded-[6px]';
    content = (
      <>
        <MediaBody
          m={m}
          rounded={r}
          onOpen={() =>
            useConversationUi.getState().openViewer({ chatId: chat.id, messageId: m.id })
          }
          onRetry={() => retry(chat.id, m)}
        >
          {!caption ? <Meta m={m} mine={mine} chat={chat} variant="overlay" /> : null}
        </MediaBody>
        {caption ? (
          <div className="relative px-1.5 pt-1.5 pb-1.5 text-chat leading-[1.38] break-words whitespace-pre-wrap">
            <RichText text={caption} highlight={search} />
            <InlineMeta m={m} mine={mine} chat={chat} />
          </div>
        ) : null}
      </>
    );
  } else {
    // Voice notes and calls carry the time inside their own last line (compact, WhatsApp-like).
    const metaInBody = !caption && (m.type === 'voice' || m.type === 'call');
    const meta = <Meta m={m} mine={mine} chat={chat} />;
    let body: ReactNode;
    switch (m.type) {
      case 'voice':
        body = m.media ? <VoiceBody m={m} mine={mine} meta={meta} /> : null;
        break;
      case 'audio':
        body = m.media ? <AudioFileBody m={m} mine={mine} /> : null;
        break;
      case 'file':
        body = m.media ? <FileBody m={m} mine={mine} /> : null;
        break;
      case 'location':
        body = m.location ? <LocationBody m={m} rounded="rounded-md" /> : null;
        break;
      case 'contact':
        body = m.contact ? <ContactBody m={m} /> : null;
        break;
      case 'poll':
        body = m.poll ? <PollBody m={m} chat={chat} mine={mine} /> : null;
        break;
      case 'call':
        body = m.call ? <CallBody m={m} chat={chat} meta={meta} /> : null;
        break;
      default:
        body = null;
    }
    content = (
      <div className="relative flex flex-col">
        <div className="px-1 pt-1">
          {body ?? <span className="text-muted italic">Unsupported message</span>}
        </div>
        {caption ? (
          <div className="relative px-1.5 pt-1 pb-1.5 text-chat leading-[1.38] break-words whitespace-pre-wrap">
            <RichText text={caption} highlight={search} />
            <InlineMeta m={m} mine={mine} chat={chat} />
          </div>
        ) : metaInBody ? (
          <div className="h-1" />
        ) : (
          <div className="flex justify-end px-1.5 pt-0.5 pb-1">{meta}</div>
        )}
      </div>
    );
  }

  const reactable = canReact(chat, m);
  const hasReactions = m.reactions.length > 0 && !deleted;

  return (
    <div
      data-testid="message"
      data-message-id={m.id}
      data-seq={m.seq}
      data-mine={mine || undefined}
      data-type={m.type}
    >
      {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
      {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
      <div
        className={cn(
          'group/msg relative flex items-start px-2 transition-colors duration-700 sm:px-3 lg:px-[6%]',
          mine ? 'justify-end' : 'justify-start',
          row.firstInGroup ? 'pt-1.5' : 'pt-[3px]',
          hasReactions ? 'pb-4' : 'pb-0',
          selecting && 'cursor-pointer',
          selected && 'bg-brand/12',
          flash && 'bg-brand/20 duration-150',
        )}
        onClick={selecting ? toggleSelected : undefined}
        onContextMenu={onContextMenu}
      >
        {selecting ? (
          <span
            role="checkbox"
            aria-checked={selected}
            aria-label="Select message"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault();
                toggleSelected();
              }
            }}
            className={cn(
              'mt-2 mr-2 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
              selected ? 'border-brand bg-brand text-on-brand' : 'border-line-strong bg-surface',
              mine && 'absolute left-2 sm:left-3',
            )}
          >
            {selected ? <Check size={13} strokeWidth={3} aria-hidden /> : null}
          </span>
        ) : null}

        {/* Swipe-to-reply hint (touch). */}
        {dx > 0 ? (
          <span
            className="absolute top-1/2 left-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-muted shadow-bubble"
            style={{ opacity: Math.min(1, dx / 52) }}
            aria-hidden
          >
            <Forward size={16} className="-scale-x-100" />
          </span>
        ) : null}

        {showAvatar ? (
          <span className="mr-1.5 w-8 shrink-0 self-start pt-0.5">
            {row.firstInGroup && m.senderId ? <UserAvatar userId={m.senderId} size={32} /> : null}
          </span>
        ) : null}

        <div
          className={cn(
            'relative flex max-w-[min(86%,560px)] min-w-0 flex-col lg:max-w-[min(68%,640px)]',
            mine ? 'items-end' : 'items-start',
          )}
          style={dx ? { transform: `translateX(${dx}px)` } : undefined}
        >
          <div
            ref={bubbleRef}
            data-testid="bubble"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={endSwipe}
            onPointerCancel={endSwipe}
            onClickCapture={longPress.onClickCapture}
            className={cn(
              'relative min-w-0 max-w-full [touch-action:pan-y]',
              !bare && 'rounded-lg shadow-bubble',
              !bare && (mine ? 'bg-bubble-out' : 'bg-bubble-in'),
              !bare && row.firstInGroup && (mine ? 'rounded-tr-none' : 'rounded-tl-none'),
              !bare && (visual && !hasHeader ? 'p-[3px]' : 'px-1 pt-0.5 pb-0'),
              m.failed && !bare && 'ring-1 ring-danger/60',
            )}
          >
            {!bare && row.firstInGroup ? <Tail mine={mine} /> : null}
            {showSender ? <SenderName userId={m.senderId!} /> : null}
            {m.forwardCount > 0 && !deleted ? <ForwardedLabel count={m.forwardCount} /> : null}
            {m.replyTo && !deleted ? (
              <ReplyQuote
                preview={m.replyTo}
                chatId={chat.id}
                className="mt-1 mb-0.5"
                onClick={
                  m.replyTo.chatId === chat.id && !m.replyTo.deleted
                    ? () => onJump(m.replyTo!.seq, m.replyTo!.id)
                    : undefined
                }
              />
            ) : null}
            {m.statusReply && !deleted ? (
              <div className="mt-1 mb-0.5">
                <StatusReplyQuote status={m.statusReply} />
              </div>
            ) : null}
            {content}
          </div>

          {hasReactions ? (
            <div className={cn('absolute -bottom-4 z-[1]', mine ? 'right-2' : 'left-2')}>
              <ReactionPill
                reactions={m.reactions}
                mine={mine}
                myReaction={m.myReaction}
                onClick={() => setReactionsOpen(true)}
              />
            </div>
          ) : null}

          {m.failed && m.type !== 'image' && m.type !== 'video' ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                retry(chat.id, m);
              }}
              className="mt-1 flex items-center gap-1 text-[12px] font-medium text-danger hover:underline"
            >
              <RotateCw size={12} aria-hidden /> Not sent. Tap to retry
            </button>
          ) : null}
        </div>

        {/* Desktop hover: react + options beside the bubble (never covering its content).
            Below lg it stays reachable by keyboard / screen readers: visually hidden until a
            button in it has focus (touch opens the same menu with a long-press). */}
        {!selecting ? (
          <div
            className={cn(
              'shrink-0 self-center',
              'sr-only focus-within:not-sr-only lg:not-sr-only',
              'transition-opacity lg:opacity-0 lg:group-hover/msg:opacity-100 lg:focus-within:opacity-100',
              menuOpen && 'lg:opacity-100',
              toolbarAnchored && 'not-sr-only',
              mine && 'order-first',
            )}
            ref={toolbarRef}
            data-testid="message-toolbar"
          >
            <div className={cn('mx-1 flex items-center gap-0.5', mine && 'flex-row-reverse')}>
              {reactable ? (
                <button
                  type="button"
                  aria-label="React to message"
                  onClick={(e) => {
                    e.stopPropagation();
                    open('react', e.currentTarget);
                  }}
                  className="flex size-8 items-center justify-center rounded-full bg-surface/85 text-muted shadow-bubble backdrop-blur-sm hover:text-fg"
                >
                  <SmilePlus size={17} aria-hidden />
                </button>
              ) : null}
              <button
                type="button"
                aria-label="Message options"
                aria-haspopup="menu"
                onClick={(e) => {
                  e.stopPropagation();
                  open('menu', e.currentTarget);
                }}
                className="flex size-8 items-center justify-center rounded-full bg-surface/85 text-muted shadow-bubble backdrop-blur-sm hover:text-fg"
              >
                <ChevronDown size={18} aria-hidden />
              </button>
            </div>
          </div>
        ) : null}
      </div>
      {reactionsOpen ? (
        <ReactionsDialog m={m} chat={chat} open onClose={() => setReactionsOpen(false)} />
      ) : null}
    </div>
  );
});
