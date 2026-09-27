/**
 * Message history (web features/conversation/MessageList.tsx) as an inverted FlatList:
 * - newest at the bottom; `loadOlder` when scrolling up to the end, `loadNewer` at the
 *   bottom when viewing an older window; new messages keep the position unless at the bottom
 * - initial position: jump target → unread divider → newest message
 * - jump-to-message (quotes, search, pins, starred): scroll if loaded, else `loadAround`
 *   first; the target flashes
 * - "scroll to bottom" button with a counter of messages that arrived while scrolled up
 * - hides messages whose disappearing timer passed
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View, useWindowDimensions } from 'react-native';
import { ChevronsDown, MessageCircleHeart, NotebookPen, Timer } from 'lucide-react-native';
import { formatTimer } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Badge, Button, Press, Spinner, T } from '@/components/ui';
import { useAuth } from '@/stores/auth';
import { useChatMessages, useMessages } from '@/stores/messages';
import { toast } from '@/stores/ui';
import { alpha, useTheme } from '@/theme';
import { MessageRow } from './MessageRow';
import { Pill } from './bubbles/Pills';
import { buildRows, nextExpiry, reuseRows, visibleMessages } from './lib/rows';
import { useConversationUi } from './state';

function findTarget(data, t) {
  if (t.messageId) {
    const i = data.findIndex((r) => r.message.id === t.messageId);
    if (i >= 0) return i;
  }
  // `data` is newest first: the oldest row with seq ≥ target is the last match.
  let found = -1;
  for (let i = 0; i < data.length; i++) {
    const s = data[i].message.seq;
    if (s >= t.seq && s > 0) found = i;
  }
  return found;
}

export const MessageList = memo(function MessageList({ chat, unread, initialTarget, bubbleStyle }) {
  const { tw, c, shadow } = useTheme();
  const me = useAuth((s) => s.user?.id);
  const msgs = useChatMessages(chat.id);
  const list = useRef(null);
  // The list sits in the wallpaper card (mx-2): rows are the window width minus 16.
  const width = useWindowDimensions().width - 16;
  const [now, setNow] = useState(() => Date.now());
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const pendingJump = useRef(initialTarget ? { ...initialTarget } : null);
  const didInitial = useRef(false);

  // Disappearing messages: re-filter when the next one expires.
  useEffect(() => {
    const next = nextExpiry(msgs.items, now);
    if (!next) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(2_147_000_000, next - Date.now() + 50));
    return () => clearTimeout(t);
  }, [msgs.items, now]);

  const prevRows = useRef([]);
  const rows = useMemo(() => {
    const built = buildRows(visibleMessages(msgs.items, now), {
      meId: me,
      unreadAfterSeq: unread?.afterSeq,
      unreadCount: unread?.count,
      hasMoreBefore: msgs.hasMoreBefore,
    });
    const reused = reuseRows(prevRows.current, built);
    prevRows.current = reused;
    return reused;
  }, [msgs.items, msgs.hasMoreBefore, now, me, unread?.afterSeq, unread?.count]);
  const data = useMemo(() => [...rows].reverse(), [rows]);

  // Count arrivals while scrolled up.
  const lastKey = useRef(null);
  useEffect(() => {
    const newest = data[0]?.key ?? null;
    if (lastKey.current && newest && newest !== lastKey.current && !atBottom) {
      const fromOthers = data[0]?.message.senderId !== me;
      if (fromOthers) setNewBelow((n) => n + 1);
    }
    lastKey.current = newest;
  }, [data, atBottom, me]);
  useEffect(() => {
    if (atBottom) setNewBelow(0);
  }, [atBottom]);

  const scrollToIndex = useCallback((index, viewPosition = 0.5, animated = true) => {
    try {
      list.current?.scrollToIndex({ index, viewPosition, animated });
    } catch {
      /* not measured yet: onScrollToIndexFailed retries */
    }
  }, []);

  const goBottom = useCallback(() => {
    if (msgs.hasMoreAfter) {
      void useMessages
        .getState()
        .loadLatest(chat.id, { fresh: true })
        .catch(() => undefined);
    }
    list.current?.scrollToOffset({ offset: 0, animated: true });
    setNewBelow(0);
  }, [chat.id, msgs.hasMoreAfter]);

  // Try the pending jump whenever the window changes.
  useEffect(() => {
    const t = pendingJump.current;
    if (!t || !data.length) return;
    const i = findTarget(data, t);
    if (i >= 0) {
      pendingJump.current = null;
      requestAnimationFrame(() => scrollToIndex(i, 0.5, didInitial.current));
      const id = data[i].message.id;
      useConversationUi.getState().flash(id);
      didInitial.current = true;
    }
  }, [data, scrollToIndex]);

  // Initial position: the unread divider near the top of the screen.
  useEffect(() => {
    if (didInitial.current || !msgs.loaded || !data.length || pendingJump.current) return;
    didInitial.current = true;
    const divider = data.findIndex((r) => r.unreadDivider > 0);
    if (divider > 6) requestAnimationFrame(() => scrollToIndex(divider, 0.85, false));
  }, [msgs.loaded, data, scrollToIndex]);

  // Jump requests (quotes, pins, search results, starred).
  const jump = useConversationUi((s) => (s.jump?.chatId === chat.id ? s.jump : null));
  useEffect(() => {
    if (!jump) return;
    const i = findTarget(data, jump);
    if (i >= 0) {
      scrollToIndex(i, 0.5);
      useConversationUi.getState().flash(data[i].message.id);
      return;
    }
    pendingJump.current = { seq: jump.seq, messageId: jump.messageId };
    void useMessages
      .getState()
      .loadAround(chat.id, jump.seq)
      .catch(() => toast.error('Couldn’t load that message'));
    // Only on new jump tokens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.token]);

  // "Scroll to bottom" requests (after sending).
  const bottomToken = useConversationUi((s) => s.bottomToken);
  const firstBottom = useRef(bottomToken);
  useEffect(() => {
    if (bottomToken === firstBottom.current) return;
    if (msgs.hasMoreAfter) goBottom();
    else list.current?.scrollToOffset({ offset: 0, animated: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bottomToken]);

  const onJump = useCallback(
    (seq, messageId) => useConversationUi.getState().requestJump(chat.id, seq, messageId),
    [chat.id],
  );
  const onJumpById = useCallback(
    (messageId) => {
      const m = useMessages.getState().byChat[chat.id]?.items.find((x) => x.id === messageId);
      if (m) useConversationUi.getState().requestJump(chat.id, m.seq, m.id);
      else toast.info('That message isn’t available anymore');
    },
    [chat.id],
  );

  const renderItem = useCallback(
    ({ item }) => (
      <MessageRow
        row={item}
        chat={chat}
        onJump={onJump}
        onJumpById={onJumpById}
        rowWidth={width}
        bubbleStyle={bubbleStyle}
      />
    ),
    [chat, onJump, onJumpById, width, bubbleStyle],
  );

  if (!msgs.loaded) {
    return (
      <View style={tw`flex-1 items-center justify-center`}>
        {msgs.error ? (
          <View
            style={[
              tw`items-center gap-3 rounded-2xl px-6 py-5`,
              { backgroundColor: alpha(c.surface, 0.95) },
              shadow.bubble,
            ]}
          >
            <T style={tw`text-sm text-muted`}>Couldn’t load messages.</T>
            <Button
              size="sm"
              onPress={() =>
                void useMessages
                  .getState()
                  .loadLatest(chat.id)
                  .catch(() => undefined)
              }
            >
              Try again
            </Button>
          </View>
        ) : (
          <View
            style={[
              tw`rounded-full p-3`,
              { backgroundColor: alpha(c.surface, 0.9) },
              shadow.bubble,
            ]}
          >
            <Spinner size={24} />
          </View>
        )}
      </View>
    );
  }

  const showFab = !atBottom || msgs.hasMoreAfter;
  const selfChat = chat.type === 'direct' && !!me && chat.peer?.id === me;
  const canWrite = chat.membership === 'active' && chat.permissions.canSend;

  return (
    <View style={tw`flex-1`}>
      {rows.length === 0 && !msgs.hasMoreBefore ? (
        <View
          pointerEvents="none"
          style={[tw`absolute inset-x-0 z-10 items-center px-6`, { top: '25%' }]}
        >
          <View
            style={[
              tw`items-center gap-2 rounded-2xl px-6 py-5`,
              { maxWidth: 320, backgroundColor: alpha(c.surface, 0.95) },
              shadow.bubble,
            ]}
          >
            <View style={tw`size-12 items-center justify-center rounded-full bg-brand-soft`}>
              <Icon
                icon={selfChat ? NotebookPen : MessageCircleHeart}
                size={22}
                color={c['brand-ink']}
              />
            </View>
            <T style={tw`text-[15px] font-semibold`}>
              {selfChat ? 'Message yourself' : 'No messages yet'}
            </T>
            <T style={[tw`text-center text-[13px] text-muted`, { lineHeight: 21 }]}>
              {selfChat
                ? 'Keep notes, links and reminders here. They sync across your devices.'
                : !canWrite
                  ? 'Messages will appear here.'
                  : chat.type === 'direct'
                    ? 'Say hi 👋 — your first message starts the conversation.'
                    : 'Be the first to send a message.'}
            </T>
          </View>
        </View>
      ) : null}
      {
        <FlatList
          ref={list}
          inverted
          data={data}
          keyExtractor={(r) => r.key}
          renderItem={renderItem}
          initialNumToRender={18}
          maxToRenderPerBatch={12}
          windowSize={13}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          maintainVisibleContentPosition={{ minIndexForVisible: 0, autoscrollToTopThreshold: 96 }}
          onScroll={(e) => {
            const bottom = e.nativeEvent.contentOffset.y < 96;
            if (bottom !== atBottom) setAtBottom(bottom);
          }}
          scrollEventThrottle={64}
          onEndReachedThreshold={0.6}
          onEndReached={() => {
            if (msgs.hasMoreBefore && !msgs.loadingBefore)
              void useMessages
                .getState()
                .loadOlder(chat.id)
                .catch(() => undefined);
          }}
          onStartReachedThreshold={0.3}
          onStartReached={() => {
            if (msgs.hasMoreAfter && !msgs.loadingAfter)
              void useMessages
                .getState()
                .loadNewer(chat.id)
                .catch(() => undefined);
          }}
          onScrollToIndexFailed={(info) => {
            list.current?.scrollToOffset({
              offset: info.averageItemLength * info.index,
              animated: false,
            });
            setTimeout(() => scrollToIndex(info.index, 0.5, false), 120);
          }}
          ListHeaderComponent={
            <View style={tw`pb-3`}>
              {msgs.loadingAfter ? (
                <View style={tw`items-center py-3`}>
                  <Spinner size={22} />
                </View>
              ) : null}
            </View>
          }
          ListFooterComponent={
            msgs.loadingBefore ? (
              <View style={tw`h-10 items-center justify-center`}>
                <Spinner size={22} />
              </View>
            ) : msgs.hasMoreBefore ? (
              <View style={tw`h-10`} />
            ) : (
              <View style={tw`pt-3 pb-1`}>
                {chat.disappearingSeconds ? (
                  <Pill>
                    <View style={tw`flex-row items-center gap-1.5`}>
                      <Icon icon={Timer} size={14} color={c.muted} />
                      <T style={tw`shrink text-[12px] text-muted`}>
                        Disappearing messages are on. New messages disappear after{' '}
                        {formatTimer(chat.disappearingSeconds)}.
                      </T>
                    </View>
                  </Pill>
                ) : null}
              </View>
            )
          }
        />
      }
      {showFab ? (
        <Press
          accessibilityLabel={
            newBelow ? `Scroll to bottom, ${newBelow} new messages` : 'Scroll to bottom'
          }
          onPress={goBottom}
          style={[
            tw`absolute right-3 bottom-3 z-10 size-11 items-center justify-center rounded-full bg-elevated`,
            shadow.elevated,
          ]}
        >
          <Icon icon={ChevronsDown} size={22} color={c.muted} />
          {newBelow ? (
            <View style={tw`absolute -top-1.5 -right-1`}>
              <Badge count={newBelow} size="sm" />
            </View>
          ) : null}
        </Press>
      ) : null}
    </View>
  );
});
