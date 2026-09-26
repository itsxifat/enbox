/**
 * Virtualized message history (react-virtuoso):
 * - reverse infinite scroll: `loadOlder` at the top, prepends keep the scroll position via
 *   `firstItemIndex`; `loadNewer` at the bottom when viewing an older window
 * - initial position: jump target → unread divider → newest message
 * - jump-to-message (quotes, search, pins, starred): scroll if loaded, else `loadAround` and
 *   remount at the target; the target flashes
 * - follows new messages while at the bottom; "scroll to bottom" button with a counter of
 *   messages that arrived while scrolled up; floating day label while scrolling
 * - hides messages whose disappearing timer passed
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso';
import { ChevronsDown, MessageCircleHeart, NotebookPen, Timer } from 'lucide-react';
import { formatTimer, type ChatSummary, type ID } from '@enbox/shared';
import { Badge, Button, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { formatDaySeparator } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useChatMessages, useMessages } from '@/stores/messages';
import { nameOf } from '@/stores/users';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { toast } from '@/stores/ui';
import { MessageRow } from './MessageRow';
import { Pill } from './bubbles/SystemPill';
import {
  buildRows,
  nextExpiry,
  reuseRows,
  rowKeys,
  shiftFirstIndex,
  visibleMessages,
  type Row,
} from './lib/rows';
import { incomingAnnouncement } from './lib/announce';
import { useConversationUi } from './state';

const BASE_INDEX = 1_000_000_000;

export interface JumpTarget {
  seq: number;
  messageId?: ID;
}

export interface UnreadSnapshot {
  afterSeq: number;
  count: number;
}

type Align = 'start' | 'center' | 'end';

interface Track {
  keys: string[];
  first: number;
  epoch: number;
  initial: { index: number; align: Align };
}

function findTarget(rows: Row[], t: JumpTarget): number {
  if (t.messageId) {
    const i = rows.findIndex((r) => r.message.id === t.messageId);
    if (i >= 0) return i;
  }
  return rows.findIndex((r) => r.message.seq >= t.seq && r.message.seq > 0);
}

function initialPosition(rows: Row[], target: JumpTarget | null): { index: number; align: Align } {
  if (target) {
    const i = findTarget(rows, target);
    if (i >= 0) return { index: i, align: 'center' };
  }
  const divider = rows.findIndex((r) => r.unreadDivider > 0);
  if (divider >= 0) return { index: divider, align: 'start' };
  return { index: Math.max(0, rows.length - 1), align: 'end' };
}

function ListHeader({ context }: { context?: HeaderContext }) {
  if (!context) return null;
  if (context.loadingBefore)
    return (
      <div className="flex h-10 items-center justify-center text-brand-ink">
        <Spinner size={22} />
      </div>
    );
  if (context.hasMoreBefore) return <div className="h-10" />;
  return (
    <div className="pt-3 pb-1">
      {context.disappearing ? (
        <Pill className="text-[12px]">
          <span className="inline-flex items-center gap-1.5">
            <Timer size={14} aria-hidden />
            Disappearing messages are on. New messages disappear after{' '}
            {formatTimer(context.disappearing)}.
          </span>
        </Pill>
      ) : null}
    </div>
  );
}

function ListFooter({ context }: { context?: HeaderContext }) {
  return (
    <div className="pb-3">
      {context?.loadingAfter ? (
        <div className="flex justify-center py-3 text-brand-ink">
          <Spinner size={22} />
        </div>
      ) : null}
    </div>
  );
}

interface HeaderContext {
  loadingBefore: boolean;
  loadingAfter: boolean;
  hasMoreBefore: boolean;
  disappearing: number | null;
}

const COMPONENTS = { Header: ListHeader, Footer: ListFooter };

export const MessageList = memo(function MessageList({
  chat,
  unread,
  initialTarget,
}: {
  chat: ChatSummary;
  unread: UnreadSnapshot | null;
  initialTarget: JumpTarget | null;
}) {
  const me = useAuth((s) => s.user?.id);
  const msgs = useChatMessages(chat.id);
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [now, setNow] = useState(() => Date.now());
  const [atBottom, setAtBottom] = useState(true);
  const wrapper = useRef<HTMLDivElement>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [floating, setFloating] = useState<{ label: string; visible: boolean }>({
    label: '',
    visible: false,
  });
  const floatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTarget = useRef<JumpTarget | null>(initialTarget);
  /**
   * Until when a jump is settling. A jump replaces the window while the list may still be "at
   * bottom"; Virtuoso then follows the output (smooth scroll to the new window's end), which
   * carried the view away from the target and triggered a `loadNewer`.
   */
  const jumpSettleUntil = useRef(0);
  const jumpSettling = useCallback(
    () => !!pendingTarget.current || performance.now() < jumpSettleUntil.current,
    [],
  );
  /** The next window replacement should land on the newest message (scroll-to-bottom). */
  const forceBottom = useRef(false);

  // Re-filter when the next disappearing message expires.
  useEffect(() => {
    const next = nextExpiry(msgs.items, now);
    if (next === null) return;
    const t = setTimeout(
      () => setNow(Date.now()),
      Math.min(2 ** 31 - 1, Math.max(250, next - Date.now() + 50)),
    );
    return () => clearTimeout(t);
  }, [msgs.items, now]);

  const items = useMemo(() => visibleMessages(msgs.items, now), [msgs.items, now]);
  const prevRows = useRef<Row[]>([]);
  const rows = useMemo(() => {
    const next = reuseRows(
      prevRows.current,
      buildRows(items, {
        meId: me,
        unreadAfterSeq: unread?.afterSeq,
        unreadCount: unread?.count,
        hasMoreBefore: msgs.hasMoreBefore,
      }),
    );
    prevRows.current = next;
    return next;
  }, [items, me, unread, msgs.hasMoreBefore]);
  // Same keys → same array: an update that only changes row contents (upload progress,
  // reactions) doesn't re-run the firstItemIndex bookkeeping (and its second render).
  const prevKeys = useRef<string[]>([]);
  const keys = useMemo(() => {
    const next = rowKeys(rows, prevKeys.current);
    prevKeys.current = next;
    return next;
  }, [rows]);

  // firstItemIndex bookkeeping (derived state, updated during render).
  const [track, setTrack] = useState<Track>(() => ({
    keys,
    first: BASE_INDEX - keys.length,
    epoch: 0,
    initial: initialPosition(rows, pendingTarget.current),
  }));
  if (track.keys !== keys) {
    const shifted = track.keys.length ? shiftFirstIndex(track.keys, track.first, keys) : null;
    if (shifted !== null && shifted > 0) setTrack({ ...track, keys, first: shifted });
    else {
      const bottom = forceBottom.current;
      forceBottom.current = false;
      setTrack({
        keys,
        first: BASE_INDEX - keys.length,
        epoch: track.epoch + 1,
        initial: bottom
          ? { index: Math.max(0, rows.length - 1), align: 'end' }
          : initialPosition(rows, pendingTarget.current),
      });
    }
  }

  // Messages appended after the previous last row (not window replacements or prepends):
  // announce them to screen readers, and count them while the user is scrolled up.
  const lastKey = keys[keys.length - 1];
  const prevLast = useRef(lastKey);
  const [announcement, setAnnouncement] = useState({ text: '', n: 0 });
  useEffect(() => {
    if (prevLast.current === lastKey) return;
    const prevIndex = prevLast.current ? keys.indexOf(prevLast.current) : -1;
    prevLast.current = lastKey;
    if (prevIndex < 0) return;
    const incoming = rows
      .slice(prevIndex + 1)
      .filter((r) => !r.mine && r.message.type !== 'system')
      .map((r) => r.message);
    if (!incoming.length) return;
    const text = incomingAnnouncement(chat, incoming, (id) => nameOf(id), me);
    if (text) setAnnouncement((a) => ({ text, n: a.n + 1 }));
    if (!atBottom) setNewBelow((n) => n + incoming.length);
  }, [lastKey, keys, rows, atBottom, chat, me]);

  useEffect(() => {
    if (atBottom) setNewBelow(0);
  }, [atBottom]);

  // An explicit `behavior: 'smooth'` overrides the CSS reduced-motion rule: honour it here.
  const reduceMotion = useMediaQuery('(prefers-reduced-motion: reduce)');
  const smoothScroll = reduceMotion ? 'auto' : 'smooth';
  const scrollToRow = useCallback(
    (index: number, align: Align, smooth = true) => {
      virtuoso.current?.scrollToIndex({
        index,
        align,
        behavior: smooth && !reduceMotion ? 'smooth' : 'auto',
      });
    },
    [reduceMotion],
  );

  const flash = useCallback((messageId: ID | undefined) => {
    if (messageId) setTimeout(() => useConversationUi.getState().flash(messageId), 120);
  }, []);

  /** Scroll to a message, loading its window when needed. */
  const jumpTo = useCallback(
    async (target: JumpTarget) => {
      jumpSettleUntil.current = performance.now() + 1500;
      const i = findTarget(prevRows.current, target);
      const found = i >= 0 ? prevRows.current[i]! : null;
      if (found && (found.message.seq === target.seq || found.message.id === target.messageId)) {
        scrollToRow(i, 'center');
        flash(found.message.id);
        return;
      }
      pendingTarget.current = target;
      forceBottom.current = false;
      try {
        await useMessages.getState().loadAround(chat.id, target.seq);
      } catch (e) {
        toast.error(e);
        pendingTarget.current = null;
        return;
      }
      // Same keys partially → no remount happened: scroll explicitly.
      requestAnimationFrame(() => {
        jumpSettleUntil.current = performance.now() + 1000;
        const j = findTarget(prevRows.current, target);
        if (j >= 0) {
          scrollToRow(j, 'center', false);
          flash(prevRows.current[j]!.message.id);
        } else toast.info('This message is no longer available');
        pendingTarget.current = null;
      });
    },
    [chat.id, flash, scrollToRow],
  );

  // Jump requests from anywhere (search, pinned bar, lightbox "show in chat").
  const jump = useConversationUi((s) => (s.jump?.chatId === chat.id ? s.jump : null));
  useEffect(() => {
    if (!jump) return;
    useConversationUi.setState({ jump: null });
    void jumpTo({ seq: jump.seq, messageId: jump.messageId });
  }, [jump, jumpTo]);

  const goBottom = useCallback(() => {
    const s = useMessages.getState().byChat[chat.id];
    if (s?.hasMoreAfter) {
      pendingTarget.current = null;
      forceBottom.current = true;
      void useMessages
        .getState()
        .loadLatest(chat.id)
        .then(() => {
          forceBottom.current = false;
          // Overlapping windows don't remount the list: scroll explicitly.
          requestAnimationFrame(() =>
            virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'auto' }),
          );
        })
        .catch((e: unknown) => toast.error(e));
      return;
    }
    virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: smoothScroll });
    setNewBelow(0);
  }, [chat.id, smoothScroll]);

  const bottomToken = useConversationUi((s) => s.bottomToken);
  const lastBottomToken = useRef(bottomToken);
  useEffect(() => {
    if (lastBottomToken.current === bottomToken) return;
    lastBottomToken.current = bottomToken;
    // Let the optimistic row render first.
    requestAnimationFrame(goBottom);
  }, [bottomToken, goBottom]);

  const onJump = useCallback(
    (seq: number, messageId: string) => void jumpTo({ seq, messageId }),
    [jumpTo],
  );
  const onJumpById = useCallback(
    (messageId: string) => {
      const r = prevRows.current.find((x) => x.message.id === messageId);
      if (r) void jumpTo({ seq: r.message.seq, messageId });
    },
    [jumpTo],
  );

  const loadOlder = useCallback(() => {
    const s = useMessages.getState().byChat[chat.id];
    if (s?.loaded && s.hasMoreBefore && !s.loadingBefore)
      void useMessages
        .getState()
        .loadOlder(chat.id)
        .catch(() => undefined);
  }, [chat.id]);
  const loadNewer = useCallback(() => {
    const s = useMessages.getState().byChat[chat.id];
    if (s?.loaded && s.hasMoreAfter && !s.loadingAfter)
      void useMessages
        .getState()
        .loadNewer(chat.id)
        .catch(() => undefined);
  }, [chat.id]);

  const onRange = useCallback(
    (range: ListRange) => {
      const r = prevRows.current[range.startIndex - track.first];
      if (!r) return;
      const label = formatDaySeparator(r.message.createdAt);
      setFloating((f) => (f.label === label ? f : { ...f, label }));
    },
    [track.first],
  );
  // The floating day label only follows the user's own scrolling (not programmatic jumps).
  const userScrolled = useRef(false);
  const onScrolling = useCallback((scrolling: boolean) => {
    if (floatTimer.current) clearTimeout(floatTimer.current);
    if (scrolling && userScrolled.current)
      setFloating((f) => (f.visible ? f : { ...f, visible: true }));
    else
      floatTimer.current = setTimeout(() => setFloating((f) => ({ ...f, visible: false })), 1200);
  }, []);

  // Keep the newest message in view when the viewport shrinks (reply banner, emoji panel,
  // on-screen keyboard) while the user was at the bottom. Measured from the scroller itself
  // (Virtuoso's own at-bottom state flips before this observer runs).
  const scroller = useRef<HTMLElement | null>(null);
  const setScroller = useCallback((el: HTMLElement | Window | null) => {
    scroller.current = el instanceof HTMLElement ? el : null;
  }, []);
  const loaded = msgs.loaded;
  useEffect(() => {
    const el = wrapper.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let last = el.clientHeight;
    const ro = new ResizeObserver(() => {
      const h = el.clientHeight;
      const sc = scroller.current;
      if (sc && h < last) {
        const gapBefore = sc.scrollHeight - (sc.scrollTop + last);
        if (gapBefore < 120) sc.scrollTop = sc.scrollHeight;
      }
      last = h;
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);

  const context = useMemo<HeaderContext>(
    () => ({
      loadingBefore: msgs.loadingBefore,
      loadingAfter: msgs.loadingAfter,
      hasMoreBefore: msgs.hasMoreBefore,
      disappearing: chat.disappearingSeconds,
    }),
    [msgs.loadingBefore, msgs.loadingAfter, msgs.hasMoreBefore, chat.disappearingSeconds],
  );

  const renderRow = useCallback(
    (_: number, row: Row) => (
      <MessageRow row={row} chat={chat} onJump={onJump} onJumpById={onJumpById} />
    ),
    [chat, onJump, onJumpById],
  );

  if (!msgs.loaded) {
    return (
      <div className="flex h-full items-center justify-center">
        {msgs.error ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl bg-surface/95 px-6 py-5 text-center shadow-bubble">
            <p className="text-sm text-muted">Couldn’t load messages.</p>
            <Button
              size="sm"
              onClick={() =>
                void useMessages
                  .getState()
                  .loadLatest(chat.id)
                  .catch(() => undefined)
              }
            >
              Try again
            </Button>
          </div>
        ) : (
          <span className="rounded-full bg-surface/90 p-3 text-brand-ink shadow-bubble">
            <Spinner size={24} />
          </span>
        )}
      </div>
    );
  }

  const showFab = !atBottom || msgs.hasMoreAfter;
  const selfChat = chat.type === 'direct' && !!me && chat.peer?.id === me;
  // Read-only chats (announcements, admins-only groups, former members, deleted/blocked
  // peers) don't get a call to action they can't follow.
  const canWrite = chat.membership === 'active' && chat.permissions.canSend;

  return (
    <div
      ref={wrapper}
      className="relative h-full"
      data-testid="message-list"
      onWheel={() => (userScrolled.current = true)}
      onTouchMove={() => (userScrolled.current = true)}
      onKeyDown={() => (userScrolled.current = true)}
    >
      {rows.length === 0 && !msgs.hasMoreBefore ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/4 z-[1] flex justify-center px-6">
          <div className="flex max-w-xs flex-col items-center gap-2 rounded-2xl bg-surface/95 px-6 py-5 text-center shadow-bubble backdrop-blur-sm">
            <span className="flex size-12 items-center justify-center rounded-full bg-brand-soft text-brand-ink">
              {selfChat ? (
                <NotebookPen size={22} aria-hidden />
              ) : (
                <MessageCircleHeart size={22} aria-hidden />
              )}
            </span>
            <p className="text-[15px] font-semibold text-fg">
              {selfChat ? 'Message yourself' : 'No messages yet'}
            </p>
            <p className="text-[13px] leading-relaxed text-muted">
              {selfChat
                ? 'Keep notes, links and reminders here. They sync across your devices.'
                : !canWrite
                  ? 'Messages will appear here.'
                  : chat.type === 'direct'
                    ? 'Say hi 👋 — your first message starts the conversation.'
                    : 'Be the first to send a message.'}
            </p>
          </div>
        </div>
      ) : null}
      <Virtuoso<Row, HeaderContext>
        key={track.epoch}
        ref={virtuoso}
        data={rows}
        context={context}
        firstItemIndex={track.first}
        initialTopMostItemIndex={track.initial}
        computeItemKey={(_, r) => r.key}
        itemContent={renderRow}
        followOutput={(bottom) => (bottom && !jumpSettling() ? smoothScroll : false)}
        alignToBottom
        startReached={loadOlder}
        endReached={loadNewer}
        atBottomStateChange={setAtBottom}
        atBottomThreshold={96}
        increaseViewportBy={{ top: 0, bottom: 300 }}
        scrollerRef={setScroller}
        rangeChanged={onRange}
        isScrolling={onScrolling}
        components={COMPONENTS}
        className="scrollbar-thin"
        style={{ height: '100%' }}
      />

      <div
        className={cn(
          'pointer-events-none absolute top-2 left-1/2 z-[2] -translate-x-1/2 transition-opacity duration-300',
          floating.visible && floating.label ? 'opacity-100' : 'opacity-0',
        )}
        aria-hidden
      >
        <span className="rounded-lg bg-surface/95 px-3 py-1 text-[12.5px] font-medium text-muted shadow-bubble backdrop-blur-sm">
          {floating.label}
        </span>
      </div>

      {/* Never on the virtualized list itself (it re-renders rows while scrolling). */}
      <div
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
        data-testid="message-announcer"
      >
        {/* Alternate a trailing zero-width space so an identical message is announced again. */}
        {announcement.text ? `${announcement.text}${announcement.n % 2 ? '\u200b' : ''}` : ''}
      </div>

      <button
        type="button"
        onClick={goBottom}
        aria-label={newBelow ? `Scroll to bottom, ${newBelow} new messages` : 'Scroll to bottom'}
        tabIndex={showFab ? 0 : -1}
        aria-hidden={showFab ? undefined : true}
        inert={!showFab}
        className={cn(
          'absolute right-3 bottom-3 z-[2] flex size-11 items-center justify-center rounded-full bg-elevated text-muted shadow-elevated transition-all duration-200 hover:text-fg lg:right-6',
          showFab ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-3 opacity-0',
        )}
      >
        <ChevronsDown size={22} aria-hidden />
        {newBelow ? (
          <span className="absolute -top-1.5 -right-1">
            <Badge count={newBelow} size="sm" />
          </span>
        ) : null}
      </button>
    </div>
  );
});
