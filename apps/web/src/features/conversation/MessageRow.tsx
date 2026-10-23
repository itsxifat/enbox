/**
 * One conversation row: optional day separator / unread divider, then a system pill or a
 * message bubble (sender name, forwarded label, quotes, typed content, meta, reactions).
 * Interactions: the hover toolbar (`RowToolbar`, Discord's) and right-click (desktop),
 * long-press sheet and swipe-right-to-reply (touch), click-to-toggle in select mode.
 *
 * The bubble chrome follows the chat's bubble style (`useRowAppearance`): `classic` (tail),
 * `rounded`, `minimal`; `cozy` rows are rendered by the sibling `CozyMessageRow`, which
 * reuses the pieces exported here (`useRowInteractions`, `MessageContent`, `RowToolbar`…).
 */
import {
  memo,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  Ban,
  Check,
  Ellipsis,
  FastForward,
  Forward,
  IdCard,
  Link,
  MessageSquareDot,
  MessagesSquare,
  Pencil,
  Pin,
  PinOff,
  Reply,
  RotateCw,
  SmilePlus,
  Trash2,
} from 'lucide-react';
import {
  FORWARDED_MANY_TIMES_THRESHOLD,
  QUICK_REACTIONS,
  userDisplayName,
  type BubbleStyle,
  type ChatSummary,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { StyledName } from '@/components/cosmetics';
import { ICON_STROKE_BOLD } from '@/components/icons';
import type { IconType } from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { RoleIcon } from '@/features/spaces/RoleIcon';
import { withSpaceProfile } from '@/features/spaces/serverProfile/merge';
import { threadMessageAction } from '@/features/threads/actions';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { useUser, useUserName } from '@/stores/users';
import { useSpaceAuthor } from '@/stores/spaces';
import { useLongPress } from '@/features/chats/useLongPress';
import { StickerBody } from '@/features/stickers/StickerBody';
import { IgnoredMessageLine, useIgnoredCollapse } from '@/features/safety/IgnoredMessage';
import { OverrideAuthorName } from '@/features/webhooks/OverrideAuthor';
import { MessageEmbeds } from './bubbles/embeds/MessageEmbeds';
import {
  canEdit,
  canPinMessage,
  canReact,
  canReply,
  isActionable,
  pinMessage,
  retry,
  startEdit,
  startReply,
  unpinMessage,
} from './actions';
import {
  canAddNewReaction,
  isMyReaction,
  reactionKey,
  reactionLabel,
} from './bubbles/reactions/model';
import {
  canAddReaction,
  canRemoveOwnReaction,
  toggleReaction,
} from './bubbles/reactions/reactionActions';
import { ReactionEmoji } from './bubbles/reactions/ReactionEmoji';
import { ReactionPickerPopover } from './bubbles/reactions/ReactionPicker';
import { recentReactions } from './bubbles/reactions/recent';
import {
  canDeleteMessage,
  canMarkUnread,
  copyId,
  copyMessageLink,
  deleteMessage,
  markUnread,
  useDeveloperMode,
} from './moreActions';
import { useEnterAnimation, useRowAppearance } from './bubbles/appearance';
import { AudioFileBody, VoiceBody } from './bubbles/AudioBody';
import { CallBody, ContactBody, FileBody, LocationBody } from './bubbles/CardBodies';
import { MediaBody } from './bubbles/MediaBody';
import { InlineMeta, Meta } from './bubbles/Meta';
import { PollBody } from './bubbles/PollBody';
import { ReplyQuote, StatusReplyQuote } from './bubbles/Quote';
import { ReactionPill, ReactionsDialog } from './bubbles/Reactions';
import { LinkPreviewCard } from './bubbles/LinkPreviewCard';
import { RichText } from './bubbles/RichText';
import { DaySeparator, SystemPill, UnreadDivider } from './bubbles/SystemPill';
import { emojiOnlyCount, plainCustomEmoji } from './lib/richText';
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
      className={cn(
        'msg-tail absolute top-0',
        mine ? '-right-2 text-bubble-out' : '-left-2 text-bubble-in',
      )}
    >
      {mine ? (
        <path d="M0 0h5.5C7.5 0 8 1.2 7 2.6L0 12.6V0z" fill="currentColor" />
      ) : (
        <path d="M8 0H2.5C.5 0 0 1.2 1 2.6l7 10V0z" fill="currentColor" />
      )}
    </svg>
  );
}

/** Group messages: the sender's name opens their profile card (a plain click in select mode). */
export function SenderName({
  userId,
  selecting,
  you,
  className,
  spaceId,
  coloured = false,
}: {
  userId: string;
  selecting: boolean;
  /** What to call the viewer (default "You"). */
  you?: string;
  className?: string;
  /** Space channels: show the nickname there, in the top role's colour. */
  spaceId?: string | null;
  /** Per-sender colour (bubbles); Discord rows use the text colour. */
  coloured?: boolean;
}) {
  // The same subscriptions as useUserName, keeping the user for their name style.
  const me = useAuth((s) => (s.user?.id === userId ? s.user : null));
  const other = useUser(me ? null : userId);
  const userName = me ? (you ?? 'You') : userDisplayName(other);
  const author = useSpaceAuthor(spaceId, userId);
  const name = author?.nickname || userName;
  const dark = useUi((s) => s.resolvedTheme === 'dark');
  return (
    <button
      type="button"
      aria-label={`Profile of ${name}`}
      aria-haspopup="dialog"
      onClick={(e) => {
        if (selecting) return;
        e.stopPropagation();
        openProfile(userId, e.currentTarget, { spaceId: spaceId ?? undefined });
      }}
      className={cn(
        'flex max-w-full min-w-0 items-center gap-1 rounded px-1 pt-0.5 text-left text-[13px] font-semibold hover:underline focus-visible:outline-2 focus-visible:outline-brand',
        className,
      )}
      // Discord: role colour in Spaces (StyledName), otherwise the default text colour;
      // bubbles keep the per-sender colours that tell group members apart.
      style={{ color: !author && coloured ? senderColor(userId, dark) : undefined }}
    >
      {/* Message rows wear the name font only; the role's colours win in a Space. */}
      <StyledName name={name} style={(me ?? other)?.nameStyle} role={author?.role} mode="font" className="truncate" />
      <RoleIcon role={author?.iconRole} size={16} />
    </button>
  );
}

export function SenderAvatar({
  userId,
  selecting,
  size = 32,
  spaceId,
}: {
  userId: string;
  selecting: boolean;
  size?: number;
  /** Space channels: the per-Space avatar and decoration win. */
  spaceId?: string | null;
}) {
  const name = useUserName(userId);
  const user = useUser(userId);
  const author = useSpaceAuthor(spaceId, userId);
  const shown = user && author ? withSpaceProfile(user, author.profile, author.nickname) : user;
  return (
    <button
      type="button"
      aria-label={`Profile of ${name}`}
      aria-haspopup="dialog"
      onClick={(e) => {
        if (selecting) return;
        e.stopPropagation();
        openProfile(userId, e.currentTarget, { spaceId: spaceId ?? undefined });
      }}
      className="rounded-full focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <UserAvatar user={shown} userId={userId} size={size} />
    </button>
  );
}

export function ForwardedLabel({ count }: { count: number }) {
  const many = count >= FORWARDED_MANY_TIMES_THRESHOLD;
  const Icon = many ? FastForward : Forward;
  return (
    <span className="flex items-center gap-1 px-1 pt-0.5 text-[12px] text-muted italic">
      <Icon size={14} aria-hidden />
      {many ? 'Forwarded many times' : 'Forwarded'}
    </span>
  );
}

/** Derived facts about a message that decide the row's chrome. */
export function rowShape(m: ClientMessage, showSender: boolean) {
  const deleted = !!m.deletedAt;
  const emojiCount =
    m.type === 'text' && !deleted && !m.replyTo && !m.forwardCount && !m.statusReply && !m.embeds?.length
      ? emojiOnlyCount(m.text)
      : 0;
  const bare = emojiCount > 0;
  const hasHeader =
    showSender ||
    (m.forwardCount > 0 && !deleted) ||
    (!!m.replyTo && !deleted) ||
    (!!m.statusReply && !deleted);
  // Several files of any kind render through MediaBody too (the mosaic, then file cards).
  const visual =
    !deleted &&
    !!m.media &&
    (m.type === 'image' || m.type === 'video' || (m.attachments?.length ?? 0) > 1);
  const caption = !deleted && m.text ? m.text : null;
  return { deleted, emojiCount, bare, hasHeader, visual, caption };
}

/**
 * Everything a row needs to react to the user: select mode, the highlight flash, the
 * actions menu (toolbar / right-click / long-press) and swipe-to-reply. Called
 * unconditionally (system rows included) so the hook order never changes.
 */
export function useRowInteractions(chat: ChatSummary, m: ClientMessage) {
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

  /** Pointer handlers for the bubble element. */
  const bubbleHandlers = {
    onPointerDown,
    onPointerMove,
    onPointerUp: endSwipe,
    onPointerCancel: endSwipe,
    onClickCapture: longPress.onClickCapture,
  };

  return {
    selecting,
    selected,
    toggleSelected,
    search,
    flash,
    menuOpen,
    toolbarRef,
    toolbarAnchored,
    reactionsOpen,
    setReactionsOpen,
    dx,
    bubbleRef,
    open,
    onContextMenu,
    bubbleHandlers,
    reactable: canReact(chat, m),
  };
}

export function SelectCheckbox({
  selected,
  onToggle,
  className,
}: {
  selected: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <span
      role="checkbox"
      aria-checked={selected}
      aria-label="Select message"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          onToggle();
        }
      }}
      className={cn(
        'mt-2 mr-2 flex size-5 shrink-0 items-center justify-center rounded-md border-2 transition-colors',
        selected ? 'border-brand bg-brand text-on-brand' : 'border-line-strong bg-surface',
        className,
      )}
    >
      {selected ? <Check size={14} strokeWidth={ICON_STROKE_BOLD} aria-hidden /> : null}
    </span>
  );
}

/** Swipe-to-reply hint (touch). */
export function SwipeHint({ dx }: { dx: number }) {
  if (dx <= 0) return null;
  return (
    <span
      className="absolute top-1/2 left-3 flex size-8 -translate-y-1/2 items-center justify-center rounded-full bg-surface text-muted shadow-bubble"
      style={{ opacity: Math.min(1, dx / 52) }}
      aria-hidden
    >
      <Forward size={16} className="-scale-x-100" />
    </span>
  );
}

export function RetryButton({ chat, m }: { chat: ChatSummary; m: ClientMessage }) {
  if (!m.failed || m.type === 'image' || m.type === 'video') return null;
  return (
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
  );
}

// ---------------------------------------------------------------------------
// Hover toolbar
// ---------------------------------------------------------------------------

/** Shift held (the toolbar shows its extra actions meanwhile): one key listener pair for all. */
let shiftHeld = false;
const shiftListeners = new Set<() => void>();
function noteShift(held: boolean): void {
  if (shiftHeld === held) return;
  shiftHeld = held;
  for (const l of shiftListeners) l();
}
const onShiftKey = (e: KeyboardEvent) => noteShift(e.shiftKey);
const onShiftReset = () => noteShift(false);
function subscribeShift(listener: () => void): () => void {
  if (shiftListeners.size === 0) {
    window.addEventListener('keydown', onShiftKey);
    window.addEventListener('keyup', onShiftKey);
    window.addEventListener('blur', onShiftReset);
  }
  shiftListeners.add(listener);
  return () => {
    shiftListeners.delete(listener);
    if (shiftListeners.size) return;
    window.removeEventListener('keydown', onShiftKey);
    window.removeEventListener('keyup', onShiftKey);
    window.removeEventListener('blur', onShiftReset);
    shiftHeld = false;
  };
}

/** Shift is held while `active` (only the hovered toolbar re-renders when it changes). */
function useShiftHeld(active: boolean): boolean {
  return useSyncExternalStore(
    subscribeShift,
    () => active && shiftHeld,
    () => false,
  );
}

const sameList = (a: string[], b: string[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

function ToolButton({
  icon: Icon,
  label,
  onClick,
  danger,
  active,
  ...rest
}: {
  icon: IconType;
  label: string;
  onClick: (e: MouseEvent<HTMLButtonElement>) => void;
  danger?: boolean;
  active?: boolean;
  'aria-haspopup'?: 'menu' | 'dialog';
  /** The toolbar's one tab stop (More); arrow keys reach the rest. */
  tabStop?: boolean;
}) {
  const { tabStop, ...props } = rest;
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      tabIndex={tabStop ? 0 : -1}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={cn(
        'flex size-8 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand',
        danger ? 'text-danger hover:bg-danger/10' : 'text-muted hover:bg-hover hover:text-fg',
        active && 'bg-hover text-fg',
      )}
      {...props}
    >
      <Icon size={20} aria-hidden />
    </button>
  );
}

/** ←/→/Home/End move between a toolbar's buttons (one tab stop per message). */
function onToolbarKeyDown(e: ReactKeyboardEvent<HTMLDivElement>): void {
  const keys = ['ArrowLeft', 'ArrowRight', 'Home', 'End'];
  if (!keys.includes(e.key)) return;
  const buttons = Array.from(
    e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not([disabled])'),
  );
  const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
  if (i < 0) return;
  e.preventDefault();
  const next =
    e.key === 'Home'
      ? 0
      : e.key === 'End'
        ? buttons.length - 1
        : i + (e.key === 'ArrowRight' ? 1 : -1);
  buttons[(next + buttons.length) % buttons.length]?.focus();
}

/**
 * Discord's hover bar (top-right of the row on desktop): three quick reactions (my recent
 * ones), Add Reaction (the full picker), Reply, Edit (mine), Create / Open Thread (Space
 * text channels) and More (the message menu). Holding Shift adds Pin / Unpin, Copy Message
 * Link, Mark Unread, Copy Message ID (Developer Mode) and Delete — at once, without a
 * question. Below lg it stays reachable by keyboard / screen readers: visually hidden until a
 * button in it has focus (touch opens the same menu with a long-press).
 */
export function RowToolbar({
  chat,
  m,
  reactable,
  menuOpen,
  anchored,
  toolbarRef,
  open,
  className,
}: {
  chat: ChatSummary;
  m: ClientMessage;
  reactable: boolean;
  menuOpen: boolean;
  anchored: boolean;
  toolbarRef: RefObject<HTMLDivElement | null>;
  open: (mode: 'menu' | 'react', anchor: HTMLElement) => void;
  className?: string;
}) {
  const me = useAuth((s) => s.user?.id);
  const devMode = useDeveloperMode();
  const pinned = useChats((s) => !!s.pins[chat.id]?.includes(m.id));
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [picker, setPicker] = useState<HTMLElement | null>(null);
  const [recent, setRecent] = useState(() => recentReactions(3));
  const shift = useShiftHeld(hovered || focused);

  // The row's hover drives the Shift extras and refreshes the quick reactions (read when the
  // pointer arrives, so they never reorder under it).
  useEffect(() => {
    const row = toolbarRef.current?.parentElement;
    if (!row) return;
    const enter = (e: globalThis.PointerEvent) => {
      if (e.pointerType === 'touch') return;
      noteShift(!!e.shiftKey);
      setHovered(true);
      setRecent((prev) => {
        const next = recentReactions(3);
        return sameList(prev, next) ? prev : next;
      });
    };
    const leave = () => setHovered(false);
    row.addEventListener('pointerenter', enter);
    row.addEventListener('pointerleave', leave);
    return () => {
      row.removeEventListener('pointerenter', enter);
      row.removeEventListener('pointerleave', leave);
    };
  }, [toolbarRef]);

  const quickOnly = chat.type === 'channel' && chat.channelSettings?.reactions === 'quick';
  const addNew = canAddNewReaction(chat);
  const quick = !reactable
    ? []
    : quickOnly
      ? QUICK_REACTIONS.slice(0, 3)
      : addNew
        ? recent
        : m.reactions.map((r) => r.emoji).slice(0, 3);
  const thread = threadMessageAction(chat, m);
  const actionable = isActionable(m);
  const latest = () =>
    useMessages.getState().byChat[chat.id]?.items.find((x) => x.id === m.id) ?? m;

  return (
    <div
      className={cn(
        'sr-only focus-within:not-sr-only lg:not-sr-only',
        'transition-opacity lg:opacity-0 lg:group-hover/msg:opacity-100 lg:focus-within:opacity-100',
        (menuOpen || picker) && 'lg:opacity-100',
        (anchored || picker) && 'not-sr-only',
        className,
      )}
      ref={toolbarRef}
      data-testid="message-toolbar"
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div
        role="toolbar"
        aria-label="Message actions"
        onKeyDown={onToolbarKeyDown}
        className="flex items-center gap-0.5 rounded-lg bg-elevated p-0.5 shadow-elevated"
      >
        {shift && actionable ? (
          <>
            {canPinMessage(chat, m) ? (
              <ToolButton
                icon={pinned ? PinOff : Pin}
                label={pinned ? 'Unpin Message' : 'Pin Message'}
                onClick={() => void (pinned ? unpinMessage(chat, m.id) : pinMessage(chat, m))}
              />
            ) : null}
            <ToolButton
              icon={Link}
              label="Copy Message Link"
              onClick={() => void copyMessageLink(chat, m)}
            />
            {canMarkUnread(chat, m) ? (
              <ToolButton
                icon={MessageSquareDot}
                label="Mark Unread"
                onClick={() => void markUnread(chat, m)}
              />
            ) : null}
            {devMode ? (
              <ToolButton
                icon={IdCard}
                label="Copy Message ID"
                onClick={() => void copyId(m.id, 'Message ID')}
              />
            ) : null}
            {canDeleteMessage(chat, m) ? (
              <ToolButton
                icon={Trash2}
                label="Delete Message"
                danger
                onClick={() => void deleteMessage(chat, m, { immediate: true })}
              />
            ) : null}
          </>
        ) : null}
        {quick.map((emoji) => {
          const mineR = isMyReaction(m, me, emoji);
          const enabled = mineR ? canRemoveOwnReaction(chat, m) : canAddReaction(chat, m, emoji);
          const label = reactionLabel(emoji);
          return (
            <button
              key={reactionKey(emoji)}
              type="button"
              aria-label={mineR ? `Remove reaction ${label}` : `React ${label}`}
              title={label}
              aria-pressed={mineR}
              disabled={!enabled}
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                void toggleReaction(chat, m, emoji);
              }}
              className={cn(
                'flex size-8 shrink-0 items-center justify-center rounded-md leading-none transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand disabled:opacity-40',
                mineR && 'bg-brand-soft',
              )}
            >
              <ReactionEmoji emoji={emoji} size={20} />
            </button>
          );
        })}
        {reactable && (addNew || m.reactions.length > 0) ? (
          <ToolButton
            icon={SmilePlus}
            label="Add Reaction"
            aria-haspopup="dialog"
            active={!!picker}
            onClick={(e) => {
              // Quick-only channels and members who may only join: the short list.
              if (quickOnly || !addNew) open('react', e.currentTarget);
              else setPicker(picker ? null : e.currentTarget);
            }}
          />
        ) : null}
        {canReply(chat, m) ? (
          <ToolButton icon={Reply} label="Reply" onClick={() => startReply(chat, m)} />
        ) : null}
        {canEdit(chat, m) ? (
          <ToolButton icon={Pencil} label="Edit" onClick={() => startEdit(chat, m)} />
        ) : null}
        {thread && thread !== 'separator' ? (
          <ToolButton
            icon={thread.icon ?? MessagesSquare}
            label={typeof thread.label === 'string' ? thread.label : 'Thread'}
            onClick={() => thread.onSelect?.()}
          />
        ) : null}
        <ToolButton
          icon={Ellipsis}
          label="More"
          aria-haspopup="menu"
          active={menuOpen}
          tabStop
          onClick={(e) => open('menu', e.currentTarget)}
        />
      </div>
      {picker ? (
        <ReactionPickerPopover
          chat={chat}
          anchor={picker}
          onClose={() => setPicker(null)}
          onPick={(emoji) => void toggleReaction(chat, latest(), emoji)}
        />
      ) : null}
    </div>
  );
}

/** The typed body of a message (text, media + caption, cards, deleted placeholder). */
export function MessageContent({
  m,
  mine,
  chat,
  search,
  shape,
}: {
  m: ClientMessage;
  mine: boolean;
  chat: ChatSummary;
  search: string | null;
  shape: ReturnType<typeof rowShape>;
}) {
  // Someone I ignore: "Ignored message — Show" until I reveal it (features/safety).
  const ignored = useIgnoredCollapse(m, mine);
  if (ignored) return <IgnoredMessageLine messageId={m.id} />;
  const { deleted, bare, emojiCount, hasHeader, visual, caption } = shape;
  if (deleted) {
    return (
      <div className="relative px-1.5 pt-1 pb-1.5 text-chat text-muted italic">
        <Ban size={16} className="mr-1.5 inline -translate-y-px" aria-hidden />
        {mine ? 'You deleted this message' : 'This message was deleted'}
        <InlineMeta m={m} mine={mine} chat={chat} />
      </div>
    );
  }
  if (bare) {
    return (
      <div className="flex flex-col items-end gap-1">
        <span
          className={cn(
            'leading-tight',
            emojiCount === 1 ? 'text-[52px]' : emojiCount === 2 ? 'text-[44px]' : 'text-[38px]',
          )}
          aria-label={m.text ? plainCustomEmoji(m.text) : undefined}
        >
          <RichText text={m.text ?? ''} jumbo />
        </span>
        <Meta m={m} mine={mine} chat={chat} variant="pill" />
      </div>
    );
  }
  if (m.type === 'text') {
    return (
      <div className="relative px-1.5 pt-1 pb-1.5 text-chat leading-[1.38] break-words whitespace-pre-wrap text-fg">
        <RichText text={m.text ?? ''} highlight={search} />
        <MessageEmbeds m={m} />
        <LinkPreviewCard text={m.text} message={m} chat={chat} />
        <InlineMeta m={m} mine={mine} chat={chat} />
      </div>
    );
  }
  // A sticker: its picture, frameless, with its own popout (no viewer).
  if (m.sticker) return <StickerBody m={m} meta={<Meta m={m} mine={mine} chat={chat} />} />;
  if (visual) {
    const r = hasHeader ? 'rounded-md' : caption ? 'rounded-md' : 'rounded-[6px]';
    return (
      <>
        <MediaBody
          m={m}
          mine={mine}
          rounded={r}
          onOpen={(index) =>
            useConversationUi.getState().openViewer({ chatId: chat.id, messageId: m.id, index })
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
  }
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
  return (
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

/** Quotes and labels above the body (forwarded, reply quote, status reply). */
export function BubbleHeader({
  m,
  chat,
  onJump,
  deleted,
}: {
  m: ClientMessage;
  chat: ChatSummary;
  onJump: MessageRowProps['onJump'];
  deleted: boolean;
}) {
  if (deleted) return null;
  return (
    <>
      {m.forwardCount > 0 ? <ForwardedLabel count={m.forwardCount} /> : null}
      {m.replyTo ? (
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
      {m.statusReply ? (
        <div className="mt-1 mb-0.5">
          <StatusReplyQuote status={m.statusReply} />
        </div>
      ) : null}
    </>
  );
}

/** Bubble chrome per style (`classic` is the tokens' default markup). */
function bubbleChrome(style: BubbleStyle, mine: boolean, firstInGroup: boolean): string {
  switch (style) {
    case 'rounded':
      return 'rounded-[18px] shadow-bubble';
    case 'minimal':
      return 'rounded-[10px] border border-line/70';
    default:
      return cn(
        'rounded-lg shadow-bubble',
        firstInGroup && (mine ? 'rounded-tr-none' : 'rounded-tl-none'),
      );
  }
}

export const MessageRow = memo(function MessageRow({
  row,
  chat,
  onJump,
  onJumpById,
}: MessageRowProps) {
  const m = row.message;
  const { mine } = row;
  const x = useRowInteractions(chat, m);
  const { selecting, selected, dx } = x;
  const { bubbleStyle } = useRowAppearance();
  const enter = useEnterAnimation(row.key);

  if (m.type === 'system') {
    return (
      <div data-testid="message" data-type="system" data-message-id={m.id}>
        {row.showDay ? <DaySeparator date={m.createdAt} /> : null}
        {row.unreadDivider ? <UnreadDivider count={row.unreadDivider} /> : null}
        <SystemPill m={m} chat={chat} onJump={onJumpById} />
      </div>
    );
  }

  const isGroupish = chat.type === 'group';
  const showSender = isGroupish && !mine && row.firstInGroup && !!m.senderId;
  // No user sent it (webhooks, crossposts): the group's first bubble names its author override.
  const override = row.firstInGroup && !m.senderId ? (m.authorOverride ?? null) : null;
  const showAvatar = isGroupish && !mine;
  const shape = rowShape(m, showSender || !!override);
  const { deleted, bare, hasHeader, visual } = shape;
  // Stickers sit on the background like jumbo emoji (a quote or forward header keeps the bubble).
  const frameless = bare || (!deleted && !!m.sticker && !hasHeader);
  const hasReactions = m.reactions.length > 0 && !deleted;
  const tail = bubbleStyle === 'classic' || bubbleStyle === 'cozy';

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
          x.flash && 'bg-brand/20 duration-150',
        )}
        onClick={selecting ? x.toggleSelected : undefined}
        onContextMenu={x.onContextMenu}
        data-animate-avatars
      >
        {selecting ? (
          <SelectCheckbox
            selected={selected}
            onToggle={x.toggleSelected}
            className={cn(mine && 'absolute left-2 sm:left-3')}
          />
        ) : null}

        <SwipeHint dx={dx} />

        {showAvatar ? (
          <span className="mr-1.5 w-8 shrink-0 self-start pt-0.5">
            {row.firstInGroup && m.senderId ? (
              <SenderAvatar userId={m.senderId} selecting={selecting} />
            ) : null}
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
            ref={x.bubbleRef}
            data-testid="bubble"
            {...x.bubbleHandlers}
            className={cn(
              'msg-bubble relative min-w-0 max-w-full [touch-action:pan-y]',
              enter,
              !frameless && bubbleChrome(bubbleStyle, mine, row.firstInGroup),
              !frameless && (mine ? 'bg-bubble-out' : 'bg-bubble-in'),
              !frameless && (visual && !hasHeader ? 'p-[3px]' : 'px-1 pt-0.5 pb-0'),
              m.failed && !frameless && 'ring-1 ring-danger/60',
            )}
          >
            {!frameless && tail && row.firstInGroup ? <Tail mine={mine} /> : null}
            {showSender ? <SenderName userId={m.senderId!} selecting={selecting} coloured /> : null}
            {override ? <OverrideAuthorName override={override} selecting={selecting} /> : null}
            <BubbleHeader m={m} chat={chat} onJump={onJump} deleted={deleted} />
            <MessageContent m={m} mine={mine} chat={chat} search={x.search} shape={shape} />
          </div>

          {hasReactions ? (
            <div className={cn('absolute -bottom-4 z-[1]', mine ? 'right-2' : 'left-2')}>
              <ReactionPill
                reactions={m.reactions}
                mine={mine}
                myReaction={m.myReaction}
                onClick={() => x.setReactionsOpen(true)}
              />
            </div>
          ) : null}

          <RetryButton chat={chat} m={m} />
        </div>

        {!selecting ? (
          <RowToolbar
            chat={chat}
            m={m}
            reactable={x.reactable}
            menuOpen={x.menuOpen}
            anchored={x.toolbarAnchored}
            toolbarRef={x.toolbarRef}
            open={x.open}
            className={cn('shrink-0 self-center', mine && 'order-first')}
          />
        ) : null}
      </div>
      {x.reactionsOpen ? (
        <ReactionsDialog m={m} chat={chat} open onClose={() => x.setReactionsOpen(false)} />
      ) : null}
    </div>
  );
});
