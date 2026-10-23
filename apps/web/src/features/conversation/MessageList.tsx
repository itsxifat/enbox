/**
 * Virtualized message history (react-virtuoso):
 * - reverse infinite scroll: `loadOlder` at the top, prepends keep the scroll position via
 *   `firstItemIndex`; `loadNewer` at the bottom when viewing an older window
 * - initial position: jump target → unread divider → newest message
 * - jump-to-message (quotes, search, pins, starred): scroll if loaded, else `loadAround` and
 *   remount at the target; the target flashes
 * - follows new messages while at the bottom; "scroll to bottom" button with a counter of
 *   messages that arrived while scrolled up (Discord's Jump to Present bar instead while the
 *   newest messages aren't loaded); floating day label while scrolling
 * - hides messages whose disappearing timer passed
 * - the conversation's beginning (intro/ChannelIntro) above the first message, once no older
 *   ones are left
 * - Discord's new messages bar while the NEW line is above the viewport (or the first unread
 *   message isn't loaded): a click jumps there; it goes once the line was seen, the list
 *   reached the bottom, or on Mark As Read / Escape (newMessages/readSignal), which also
 *   clears the line
 * - runs of messages from people I blocked fold into one row each (blocked/)
 * - screen readers and keyboard (features/a11y): the scroller is a list named for the chat,
 *   rows are labelled articles; ↑/↓ and Home/End move between rows, Enter / Tab enter a row's
 *   toolbar, Escape returns to the composer, Discord's action keys act on the focused message
 *   (keyboard/messageKeys); new messages are announced politely
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Virtuoso, type ListRange, type VirtuosoHandle } from 'react-virtuoso';
import { ChevronsDown, Timer } from 'lucide-react';
import { formatTimer, type ChatSummary, type ID } from '@enbox/shared';
import { Badge, Button, Spinner } from '@/components/ui';
import { clearArrivals } from '@/lib/arrivals';
import { cn } from '@/lib/cn';
import { formatDaySeparator } from '@/lib/format';
import { useAuth } from '@/stores/auth';
import { useChatMessages, useMessages } from '@/stores/messages';
import { nameOf } from '@/stores/users';
import { useBus } from '@/hooks/useBus';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { toast, useUi } from '@/stores/ui';
import { VirtualListItem, messageListLabel } from '@/features/a11y/lists';
import { useRowNavigation } from '@/features/a11y/rowKeys';
import { useChatTitle } from '@/features/groupDms/title';
import { JumpToPresentBar } from './Bars';
import { CozyMessageRow } from './CozyMessageRow';
import { CompactMessageRow } from './CompactMessageRow';
import { MessageRow } from './MessageRow';
import { useRowAppearance } from './bubbles/appearance';
import { Pill } from './bubbles/SystemPill';
import { BlockedMessagesRow } from './blocked/BlockedMessagesRow';
import { collapseBlocked, useBlockedSenders, type ListRow } from './blocked/blockedRuns';
import { ChannelIntro } from './intro/ChannelIntro';
import { runMessageKey } from './keyboard/messageKeys';
import { NewMessagesBar } from './newMessages/NewMessagesBar';
import { markConversationRead, useReadSignals } from './newMessages/readSignal';
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

/**
 * The NEW line sits right after my read position: above the first message past `afterSeq`
 * (system messages aside), mine included — Mark Unread on my own message puts my read position
 * just before it (`buildRows` alone skips my messages). Placed on rows built without a divider,
 * so the grouping around it is the one `buildRows` gives a divider. Pure (unit-tested).
 */
export function withUnreadDivider(rows: Row[], unread: UnreadSnapshot | null): Row[] {
  if (!unread || unread.count <= 0) return rows;
  const at = rows.findIndex((r) => r.message.seq > unread.afterSeq && r.message.type !== 'system');
  if (at < 0) return rows;
  const out = rows.slice();
  out[at] = { ...rows[at]!, unreadDivider: unread.count, firstInGroup: true };
  if (at > 0 && !rows[at]!.firstInGroup) out[at - 1] = { ...rows[at - 1]!, lastInGroup: true };
  return out;
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
      <ChannelIntro chat={context.chat} />
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
  chat: ChatSummary;
  loadingBefore: boolean;
  loadingAfter: boolean;
  hasMoreBefore: boolean;
  disappearing: number | null;
}

const COMPONENTS = { Header: ListHeader, Footer: ListFooter, Item: VirtualListItem };

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
  // Read synchronously by the row-grew handler, before Virtuoso re-measures the grown row.
  const atBottomRef = useRef(true);
  const onAtBottom = useCallback((bottom: boolean) => {
    atBottomRef.current = bottom;
    setAtBottom(bottom);
  }, []);
  const wrapper = useRef<HTMLDivElement>(null);
  const [newBelow, setNewBelow] = useState(0);
  const [floating, setFloating] = useState<{ label: string; visible: boolean }>({
    label: '',
    visible: false,
  });
  const floatTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // The user scrolled (wheel, touch, keys): the floating day label follows only that (not
  // programmatic jumps), and reaching the bottom then reads the unread messages.
  const userScrolled = useRef(false);
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

  // Read on purpose (Mark As Read, Escape): the NEW line and the bar go, until a new snapshot.
  const [readFor, setReadFor] = useState<UnreadSnapshot | null>(null);
  const readToken = useReadSignals((s) => s.tokens[chat.id] ?? 0);
  const lastReadToken = useRef(readToken);
  useEffect(() => {
    if (lastReadToken.current === readToken) return;
    lastReadToken.current = readToken;
    setReadFor(unread);
  }, [readToken, unread]);
  const shownUnread = unread && readFor !== unread ? unread : null;

  const items = useMemo(() => visibleMessages(msgs.items, now), [msgs.items, now]);
  // Runs of messages from people I blocked fold (blocked/); Show opens one in place.
  const blocked = useBlockedSenders(items, me);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const toggleBlocked = useCallback(
    (key: string) =>
      setExpanded((cur) => {
        const next = new Set(cur);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const prevBase = useRef<Row[]>([]);
  const prevRows = useRef<ListRow[]>([]);
  const rows = useMemo(() => {
    const base = reuseRows(
      prevBase.current,
      withUnreadDivider(
        buildRows(items, { meId: me, hasMoreBefore: msgs.hasMoreBefore }),
        shownUnread,
      ),
    );
    prevBase.current = base;
    const next = collapseBlocked(base, blocked, expanded);
    prevRows.current = next;
    return next;
  }, [items, me, shownUnread, msgs.hasMoreBefore, blocked, expanded]);
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
      // A window replacement remounts every row: none of them "just arrived".
      clearArrivals();
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
      .filter(
        (r) =>
          !r.mine &&
          !r.blocked &&
          r.message.type !== 'system' &&
          !(r.message.senderId && blocked.has(r.message.senderId)),
      )
      .map((r) => r.message);
    if (!incoming.length) return;
    const text = incomingAnnouncement(chat, incoming, (id) => nameOf(id), me);
    if (text) setAnnouncement((a) => ({ text, n: a.n + 1 }));
    if (!atBottom) setNewBelow((n) => n + incoming.length);
  }, [lastKey, keys, rows, atBottom, chat, me, blocked]);

  useEffect(() => {
    if (atBottom) setNewBelow(0);
  }, [atBottom]);

  // An explicit `behavior: 'smooth'` overrides the CSS reduced-motion rule: honour it here.
  const reduceMotion = useReducedMotion();
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

  // The new messages bar (see the header). While older unread messages aren't loaded the NEW
  // line stands on the first loaded row: the real first unread message is further up.
  const dividerAt = shownUnread ? rows.findIndex((r) => r.unreadDivider > 0) : -1;
  const dividerReal =
    dividerAt >= 0 &&
    (!msgs.hasMoreBefore || (rows[0]?.message.seq ?? 0) <= (shownUnread?.afterSeq ?? 0) + 1);
  const [dividerAbove, setDividerAbove] = useState(false);
  const [seenFor, setSeenFor] = useState<UnreadSnapshot | null>(null);
  const viewRange = useRef<ListRange | null>(null);
  // Latest values for the range callback (Virtuoso calls it while scrolling).
  const bar = useRef({ at: dividerAt, real: dividerReal, first: track.first, unread: shownUnread });
  bar.current = { at: dividerAt, real: dividerReal, first: track.first, unread: shownUnread };
  /** Whether the NEW line is above the rows in view; a real one in view counts as seen. */
  const checkDivider = useCallback(() => {
    const b = bar.current;
    const r = viewRange.current;
    if (!b.unread || b.at < 0 || !r) return;
    const at = b.first + b.at;
    if (b.real && at >= r.startIndex && at <= r.endIndex) setSeenFor(b.unread);
    setDividerAbove(at < r.startIndex);
  }, []);
  useEffect(() => checkDivider(), [checkDivider, dividerAt, dividerReal, track.first]);
  // Reaching the bottom by scrolling reads the rest (Discord): the bar goes.
  useEffect(() => {
    if (atBottom && userScrolled.current && shownUnread) setSeenFor(shownUnread);
  }, [atBottom, shownUnread]);
  const showBar =
    !!shownUnread && dividerAt >= 0 && seenFor !== shownUnread && (!dividerReal || dividerAbove);
  const jumpToUnread = useCallback(() => {
    const b = bar.current;
    if (!b.unread) return;
    if (b.at >= 0 && b.real) scrollToRow(b.at, 'start');
    else void jumpTo({ seq: b.unread.afterSeq + 1 });
  }, [jumpTo, scrollToRow]);
  const markRead = useCallback(() => markConversationRead(chat.id), [chat.id]);
  /** The scroll-to-bottom button and Jump to Present: the unread ones are behind me then. */
  const toPresent = useCallback(() => {
    if (bar.current.unread) setSeenFor(bar.current.unread);
    goBottom();
  }, [goBottom]);

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
      viewRange.current = range;
      checkDivider();
      const r = prevRows.current[range.startIndex - track.first];
      if (!r) return;
      const label = formatDaySeparator(r.message.createdAt);
      setFloating((f) => (f.label === label ? f : { ...f, label }));
    },
    [track.first, checkDivider],
  );
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
  // A row that grows after layout (a link preview arriving) would push the newest message
  // below the fold: stay at the bottom if the list was there.
  useBus('conversation:row-grew', () => {
    if (!atBottomRef.current || jumpSettling()) return;
    requestAnimationFrame(() => {
      const sc = scroller.current;
      if (sc) sc.scrollTop = sc.scrollHeight;
    });
  });
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
      chat,
      loadingBefore: msgs.loadingBefore,
      loadingAfter: msgs.loadingAfter,
      hasMoreBefore: msgs.hasMoreBefore,
      disappearing: chat.disappearingSeconds,
    }),
    [chat, msgs.loadingBefore, msgs.loadingAfter, msgs.hasMoreBefore],
  );

  // `cozy` (Discord-style rows) comes from the appearance context set on the conversation root.
  const cozy = useRowAppearance().bubbleStyle === 'cozy';
  // Discord rows in Compact mode (Settings ▸ Chats ▸ Message display).
  const compact = useUi((s) => s.prefs.messageDisplay === 'compact');
  const renderRow = useCallback(
    (_: number, row: Row) =>
      cozy && compact ? (
        <CompactMessageRow row={row} chat={chat} onJump={onJump} onJumpById={onJumpById} />
      ) : cozy ? (
        <CozyMessageRow row={row} chat={chat} onJump={onJump} onJumpById={onJumpById} />
      ) : (
        <MessageRow row={row} chat={chat} onJump={onJump} onJumpById={onJumpById} />
      ),
    [chat, cozy, compact, onJump, onJumpById],
  );
  // The fold of a blocked run renders in place of its messages.
  const renderItem = useCallback(
    (i: number, row: ListRow) =>
      row.blocked ? (
        <BlockedMessagesRow row={row} run={row.blocked} onToggle={toggleBlocked} />
      ) : (
        renderRow(i, row)
      ),
    [renderRow, toggleBlocked],
  );

  // Screen readers and the keyboard (features/a11y): a named list, ↑/↓ between rows.
  const title = useChatTitle(chat);
  const rowNav = useRowNavigation({
    rowIds: () =>
      prevRows.current
        .filter((r) => r.message.type !== 'system' && !r.blocked)
        .map((r) => r.message.id),
    reveal: (id, align) => {
      const i = prevRows.current.findIndex((r) => r.message.id === id && !r.blocked);
      if (i >= 0) virtuoso.current?.scrollToIndex({ index: i, align, behavior: 'auto' });
    },
    scroller: () => scroller.current,
    act: (id, action) => {
      const m = useMessages.getState().byChat[chat.id]?.items.find((x) => x.id === id);
      return !!m && runMessageKey(chat, m, action);
    },
  });

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

  // Viewing an older window (the newest messages aren't loaded): the Jump to Present bar instead.
  const showFab = !atBottom && !msgs.hasMoreAfter;

  return (
    <div
      ref={wrapper}
      className="relative h-full"
      data-testid="message-list"
      data-chat-id={chat.id}
      onWheel={() => (userScrolled.current = true)}
      onTouchMove={() => (userScrolled.current = true)}
      onKeyDown={(e) => {
        userScrolled.current = true;
        rowNav.onKeyDown(e);
      }}
      onFocus={rowNav.onFocus}
      onPointerDown={rowNav.onPointerDown}
    >
      <Virtuoso<ListRow, HeaderContext>
        key={track.epoch}
        ref={virtuoso}
        data={rows}
        context={context}
        firstItemIndex={track.first}
        initialTopMostItemIndex={track.initial}
        computeItemKey={(_, r) => r.key}
        itemContent={renderItem}
        followOutput={(bottom) => (bottom && !jumpSettling() ? smoothScroll : false)}
        alignToBottom
        startReached={loadOlder}
        endReached={loadNewer}
        atBottomStateChange={onAtBottom}
        atBottomThreshold={96}
        increaseViewportBy={{ top: 0, bottom: 300 }}
        scrollerRef={setScroller}
        rangeChanged={onRange}
        isScrolling={onScrolling}
        components={COMPONENTS}
        role="list"
        aria-label={messageListLabel(chat, title)}
        className="scrollbar-thin"
        style={{ height: '100%' }}
      />

      {showBar ? (
        <NewMessagesBar
          count={shownUnread!.count}
          since={dividerReal ? rows[dividerAt]!.message.createdAt : null}
          onJump={jumpToUnread}
          onMarkRead={markRead}
        />
      ) : null}

      <div
        className={cn(
          'pointer-events-none absolute left-1/2 z-[2] -translate-x-1/2 transition-opacity duration-300',
          // Below the new messages bar while it shows.
          showBar ? 'top-12' : 'top-2',
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
        onClick={toPresent}
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
      {msgs.hasMoreAfter ? <JumpToPresentBar onJump={toPresent} /> : null}
    </div>
  );
});
