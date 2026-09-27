/**
 * Channel page (web features/channels/ChannelPane.tsx):
 * - followers/admins: the feed (newest at the bottom), reactions, poll voting; admins get
 *   the composer, followers a mute toggle; registers as the open chat (read receipts);
 * - anyone else: a preview (`GET /api/channels/:id` → header + recent posts) with Follow.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Bell,
  BellOff,
  ChevronDown,
  EllipsisVertical,
  Info,
  Link2,
  LogOut,
  Megaphone,
  Share2,
} from 'lucide-react-native';
import { MUTE_FOREVER_ISO, chatTitle, isMuted } from '@enbox/shared';
import { ChatAvatar } from '@/components/common/avatars';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  Avatar,
  Button,
  DropdownMenu,
  EmptyState,
  IconButton,
  PageSpinner,
  Sheet,
  Spinner,
  T,
  confirm,
  toast,
} from '@/components/ui';
import { ChatBackground, useChatAppearance } from '@/features/appearance/ChatBackground';
import { DaySeparator } from '@/features/conversation/bubbles/Pills';
import { Lightbox } from '@/features/conversation/Lightbox';
import { nextExpiry, rowKey, visibleMessages } from '@/features/conversation/lib/rows';
import { setMuted } from '@/features/groups/shared/chatActions';
import { copyLink, shareLink } from '@/features/groups/shared/share';
import { ApiError, errorMessage } from '@/lib/api';
import { formatCount, isSameLocalDay } from '@/lib/format';
import { useChat, useChats } from '@/stores/chats';
import { useChatMessages, useMessages } from '@/stores/messages';
import { ColorScope, useTheme } from '@/theme';
import { channelUrl, followChannel, previewChannel, unfollowChannel } from './channelApi';
import { ChannelComposer } from './ChannelComposer';
import { ChannelInfoPanel } from './ChannelInfoPanel';
import { ChannelPost, SystemChip } from './ChannelPost';
import { findPostIndex } from './feedJump';

export function ChannelScreen() {
  const { chatId } = useLocalSearchParams();
  const chat = useChat(chatId);
  const loaded = useChats((s) => s.loaded);
  if (!chatId) return null;
  if (chat && chat.type === 'channel') return <ChannelView key={chat.id} chat={chat} />;
  if (!loaded) return <PageSpinner />;
  return <ChannelPreviewView key={chatId} chatId={String(chatId)} />;
}

const FeedItem = memo(function FeedItem({ day, m, ctx }) {
  const { tw } = useTheme();
  return (
    <View style={tw`w-full gap-2 px-3 pb-2`}>
      {day ? <DaySeparator date={day} /> : null}
      {m.type === 'system' ? <SystemChip m={m} /> : <ChannelPost m={m} ctx={ctx} />}
    </View>
  );
});

function useVisibleItems(items) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = nextExpiry(items, now);
    if (next === null) return;
    const t = setTimeout(
      () => setNow(Date.now()),
      Math.min(2 ** 31 - 1, Math.max(250, next - Date.now() + 50)),
    );
    return () => clearTimeout(t);
  }, [items, now]);
  return useMemo(() => visibleMessages(items, now), [items, now]);
}

/** The posts, newest at the bottom (an inverted list), older pages at the top. */
function Feed({
  items,
  ctx,
  hasMore,
  loadingMore,
  onLoadMore,
  hasMoreAfter = false,
  loadingNewer = false,
  onLoadNewer,
  onLatest,
  jump,
  onJumped,
  empty,
  appearance,
}) {
  const { tw, shadow } = useTheme();
  const list = useRef(null);
  const [atBottom, setAtBottom] = useState(true);
  const reversed = useMemo(() => [...items].reverse(), [items]);

  useEffect(() => {
    if (!jump || !items.length) return;
    const i = findPostIndex(items, jump);
    if (i < 0) return;
    const index = items.length - 1 - i;
    requestAnimationFrame(() =>
      list.current?.scrollToIndex({ index, viewPosition: 0.5, animated: true }),
    );
    onJumped?.();
  }, [jump, items, onJumped]);

  const renderItem = useCallback(
    ({ item: m, index }) => {
      const prev = reversed[index + 1];
      const day = !prev || !isSameLocalDay(prev.createdAt, m.createdAt) ? m.createdAt : null;
      return <FeedItem day={day} m={m} ctx={ctx} />;
    },
    [reversed, ctx],
  );

  return (
    <View style={tw`relative mx-2 min-h-0 flex-1 overflow-hidden rounded-xl`}>
      {appearance ? <ChatBackground appearance={appearance} /> : null}
      {items.length === 0 ? (
        <View style={tw`flex-1 justify-end px-3 py-4`}>{empty}</View>
      ) : (
        <FlatList
          ref={list}
          inverted
          data={reversed}
          keyExtractor={rowKey}
          renderItem={renderItem}
          contentContainerStyle={tw`pt-3`}
          onEndReachedThreshold={0.4}
          onEndReached={hasMore && !loadingMore ? onLoadMore : undefined}
          onStartReachedThreshold={0.4}
          onStartReached={hasMoreAfter && !loadingNewer ? onLoadNewer : undefined}
          onScroll={(e) => setAtBottom(e.nativeEvent.contentOffset.y < 80)}
          scrollEventThrottle={64}
          onScrollToIndexFailed={() => undefined}
          ListFooterComponent={
            <View style={tw`h-10 items-center justify-center`}>
              {loadingMore ? <Spinner size={18} /> : null}
            </View>
          }
          ListHeaderComponent={
            loadingNewer ? (
              <View style={tw`items-center py-2`}>
                <Spinner size={18} />
              </View>
            ) : null
          }
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        />
      )}
      {(!atBottom || hasMoreAfter) && items.length ? (
        <IconButton
          icon={ChevronDown}
          label="Scroll to latest"
          variant="solid"
          size="md"
          style={[tw`absolute right-4 bottom-4`, shadow.elevated]}
          onPress={() => {
            if (hasMoreAfter && onLatest) {
              onLatest();
              return;
            }
            list.current?.scrollToOffset({ offset: 0, animated: true });
          }}
        />
      ) : null}
    </View>
  );
}

const PREVIEW_CTX = { chat: null, reactions: 'none', canVote: false };

function ChannelView({ chat }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const appearance = useChatAppearance(chat);
  const router = useRouter();
  const params = useLocalSearchParams();
  const msgs = useChatMessages(chat.id);
  const items = useVisibleItems(msgs.items);
  const [info, setInfo] = useState(false);
  const muted = isMuted(chat.mutedUntil);
  const admin = chat.permissions.canSend;
  const [jump, setJump] = useState(null);
  const jumping = useRef(false);
  const onJumped = useCallback(() => setJump(null), []);

  useFocusEffect(
    useCallback(() => {
      useChats.getState().setOpenChat(chat.id);
      return () => {
        if (useChats.getState().openChatId === chat.id) useChats.getState().setOpenChat(null);
      };
    }, [chat.id]),
  );

  // `?m=<seq>&mid=<id>` (search results, starred): load that post's window, then scroll to it.
  const seq = Number(params.m);
  const target = Number.isInteger(seq) && seq > 0 ? { seq, messageId: params.mid } : null;
  const targetKey = target ? `${target.seq}:${target.messageId ?? ''}` : null;
  useEffect(() => {
    if (!target) return;
    router.setParams({ m: undefined, mid: undefined });
    const s = useMessages.getState().byChat[chat.id];
    const loaded = s?.items.some(
      (m) => m.id === target.messageId || (m.seq === target.seq && m.seq > 0),
    );
    if (loaded) {
      setJump(target);
      return;
    }
    jumping.current = true;
    void useMessages
      .getState()
      .loadAround(chat.id, target.seq)
      .then(() => setJump(target))
      .catch((e) => toast.error(e))
      .finally(() => {
        jumping.current = false;
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetKey, chat.id]);

  useEffect(() => {
    if (!msgs.loaded && !msgs.loadingLatest && !msgs.error && !jumping.current)
      void useMessages
        .getState()
        .loadLatest(chat.id)
        .catch(() => undefined);
  }, [chat.id, msgs.loaded, msgs.loadingLatest, msgs.error]);

  const toggleMute = () =>
    void setMuted(chat.id, muted ? null : MUTE_FOREVER_ISO)
      .then(() => toast.success(muted ? 'Channel unmuted' : 'Channel muted'))
      .catch((e) => toast.error(e));

  const unfollow = async () => {
    const ok = await confirm({
      title: `Unfollow ${chatTitle(chat)}?`,
      message: 'You will stop receiving updates from this channel.',
      confirmLabel: 'Unfollow',
      danger: true,
    });
    if (!ok) return;
    try {
      await unfollowChannel(chat.id);
      toast.success(`Unfollowed ${chatTitle(chat)}`);
      router.replace('/updates');
    } catch (e) {
      toast.error(e);
    }
  };

  const share = () =>
    chat.channelSettings?.isPublic
      ? void shareLink({
          title: chatTitle(chat),
          text: `Follow “${chatTitle(chat)}” on Enbox`,
          url: channelUrl(chat.id),
        })
      : setInfo(true);

  const menu = [
    { label: 'Channel info', icon: Info, onSelect: () => setInfo(true) },
    { label: muted ? 'Unmute' : 'Mute', icon: muted ? Bell : BellOff, onSelect: toggleMute },
    chat.channelSettings?.isPublic && {
      label: 'Copy link',
      icon: Link2,
      onSelect: () => void copyLink(channelUrl(chat.id)),
    },
    { label: 'Share channel', icon: Share2, onSelect: share },
    chat.permissions.canLeave && 'separator',
    chat.permissions.canLeave && {
      label: 'Unfollow',
      icon: LogOut,
      danger: true,
      onSelect: () => void unfollow(),
    },
  ];

  const ctx = useMemo(
    () => ({
      chat,
      reactions: chat.channelSettings?.reactions ?? 'all',
      canVote: chat.membership === 'active',
    }),
    [chat],
  );
  const loadMore = useCallback(
    () =>
      void useMessages
        .getState()
        .loadOlder(chat.id)
        .catch(() => undefined),
    [chat.id],
  );
  const loadNewer = useCallback(
    () =>
      void useMessages
        .getState()
        .loadNewer(chat.id)
        .catch(() => undefined),
    [chat.id],
  );
  const loadLatest = useCallback(
    () =>
      void useMessages
        .getState()
        .loadLatest(chat.id)
        .catch(() => undefined),
    [chat.id],
  );

  return (
    <ColorScope overrides={appearance.colors}>
      <View style={tw`flex-1 bg-surface`}>
        <PaneHeader
          back="/updates"
          leading={<ChatAvatar chat={chat} size="md" style={tw`mx-1`} />}
          title={chatTitle(chat)}
          subtitle={`${formatCount(chat.memberCount)} ${chat.memberCount === 1 ? 'follower' : 'followers'}`}
          onTitlePress={() => setInfo(true)}
          actions={
            <>
              <IconButton
                icon={muted ? BellOff : Bell}
                label={muted ? 'Unmute channel' : 'Mute channel'}
                onPress={toggleMute}
                active={muted}
              />
              <DropdownMenu
                items={menu}
                trigger={(t) => (
                  <IconButton {...t} icon={EllipsisVertical} label="Channel options" />
                )}
              />
            </>
          }
        />
        <KeyboardAvoidingView behavior="padding" style={tw`min-h-0 flex-1`}>
          {!msgs.loaded && msgs.loadingLatest ? (
            <View style={tw`relative mx-2 flex-1 overflow-hidden rounded-xl`}>
              <ChatBackground appearance={appearance} />
              <PageSpinner />
            </View>
          ) : msgs.error && !msgs.loaded ? (
            <View
              style={tw`relative mx-2 flex-1 items-center justify-center overflow-hidden rounded-xl`}
            >
              <ChatBackground appearance={appearance} />
              <EmptyState
                icon={Megaphone}
                title="Couldn't load posts"
                description={msgs.error}
                action={
                  <Button variant="soft" onPress={loadLatest}>
                    Try again
                  </Button>
                }
              />
            </View>
          ) : (
            <Feed
              items={items}
              ctx={ctx}
              hasMore={msgs.hasMoreBefore && msgs.loaded}
              loadingMore={msgs.loadingBefore}
              onLoadMore={loadMore}
              hasMoreAfter={msgs.hasMoreAfter && msgs.loaded}
              loadingNewer={msgs.loadingAfter}
              onLoadNewer={loadNewer}
              onLatest={loadLatest}
              jump={jump}
              onJumped={onJumped}
              appearance={appearance}
            />
          )}
          {admin ? (
            <ChannelComposer chat={chat} />
          ) : (
            <View
              style={[
                tw`mx-3 mt-2 flex-row items-center justify-center gap-3 rounded-xl bg-surface-2 px-4 py-2.5`,
                { marginBottom: Math.max(10, insets.bottom) },
              ]}
            >
              <T style={tw`text-[13px] text-muted`}>Only admins can post in this channel</T>
              <Button
                size="sm"
                variant="soft"
                leftIcon={muted ? Bell : BellOff}
                onPress={toggleMute}
              >
                {muted ? 'Unmute' : 'Mute'}
              </Button>
            </View>
          )}
        </KeyboardAvoidingView>
        <Lightbox chatId={chat.id} />
        <Sheet open={info} onClose={() => setInfo(false)} scroll={false}>
          <ChannelInfoPanel chatId={chat.id} onClose={() => setInfo(false)} />
        </Sheet>
      </View>
    </ColorScope>
  );
}

function ChannelPreviewView({ chatId }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null);
    setError(null);
    previewChannel(chatId, ctrl.signal)
      .then(setData)
      .catch((e) => {
        if (ctrl.signal.aborted) return;
        setError({
          missing: e instanceof ApiError && (e.status === 404 || e.status === 400),
          message: errorMessage(e),
        });
      });
    return () => ctrl.abort();
  }, [chatId]);

  const follow = async () => {
    setBusy(true);
    try {
      const chat = await followChannel(chatId);
      toast.success(`You're following ${chatTitle(chat)}`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <View style={tw`flex-1 bg-surface`}>
        <PaneHeader title="Channel" back="/updates" />
        <View style={tw`flex-1 items-center justify-center`}>
          <EmptyState
            icon={Megaphone}
            title={error.missing ? 'Channel not available' : "Couldn't open the channel"}
            description={
              error.missing
                ? 'This channel may be private or no longer exist. Private channels can only be joined with an invite link.'
                : error.message
            }
          />
        </View>
      </View>
    );
  if (!data)
    return (
      <View style={tw`flex-1 bg-surface`}>
        <PaneHeader title="Channel" back="/updates" />
        <PageSpinner />
      </View>
    );

  const c = data.channel;
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader
        back="/updates"
        leading={
          <Avatar
            src={c.avatarUrl}
            name={c.name}
            colorSeed={c.id}
            kind="channel"
            size="md"
            style={tw`mx-1`}
          />
        }
        title={c.name}
        subtitle={`${formatCount(c.followerCount)} ${c.followerCount === 1 ? 'follower' : 'followers'}`}
        actions={
          c.isPublic ? (
            <IconButton
              icon={Share2}
              label="Share channel"
              onPress={() => void shareLink({ title: c.name, url: channelUrl(c.id) })}
            />
          ) : undefined
        }
      />
      <Feed
        items={data.messages}
        ctx={PREVIEW_CTX}
        hasMore={false}
        loadingMore={false}
        empty={<T style={tw`self-center py-10 text-sm text-muted`}>No posts yet.</T>}
      />
      <View
        style={[
          tw`mx-3 mt-2 flex-row items-center gap-3 rounded-xl bg-surface-2 px-4 py-3`,
          { marginBottom: Math.max(12, insets.bottom) },
        ]}
      >
        <View style={tw`min-w-0 flex-1`}>
          <T numberOfLines={1} style={tw`text-[15px] font-semibold`}>
            {c.name}
          </T>
          <T numberOfLines={2} style={tw`text-[13px] text-muted`}>
            {c.description || 'Follow to get new posts in your Updates tab.'}
          </T>
        </View>
        <Button
          onPress={() => void follow()}
          loading={busy}
          accessibilityLabel={`Follow ${c.name}`}
        >
          Follow
        </Button>
      </View>
    </View>
  );
}
