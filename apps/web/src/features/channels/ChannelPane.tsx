/**
 * Channel page at /updates/channels/:chatId.
 * - Followers/admins (the channel is in my chat list): the channel feed — posts with the
 *   channel identity, reactions (per `channelSettings.reactions`), poll voting; admins get a
 *   composer (`permissions.canSend`), followers a mute toggle. Registers as the open chat
 *   (read receipts / unread suppression) like the conversation view.
 * - Anyone else: a preview (GET /api/channels/:id → header + recent posts) with Follow.
 */
import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useNavigate, useParams } from 'react-router';
import { Virtuoso, type VirtuosoHandle } from 'react-virtuoso';
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
} from 'lucide-react';
import {
  MUTE_FOREVER_ISO,
  chatTitle,
  isMuted,
  type ChannelPreview,
  type ChatSummary,
} from '@enbox/shared';
import { ChatAvatar } from '@/components/common/ChatAvatar';
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
  confirm,
  toast,
  type MenuEntry,
} from '@/components/ui';
import { setMuted } from '@/features/groups/shared/chatActions';
import { copyLink, shareLink } from '@/features/groups/shared/share';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { ApiError, errorMessage } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatCount, formatDaySeparator, isSameLocalDay } from '@/lib/format';
import { useChat, useChats } from '@/stores/chats';
import { useChatMessages, useMessages, type ClientMessage } from '@/stores/messages';
import {
  nextExpiry,
  rowKey,
  shiftFirstIndex,
  visibleMessages,
} from '@/features/conversation/lib/rows';
import { ChannelComposer } from './ChannelComposer';
import { ChannelInfoPanel } from './ChannelInfoPanel';
import { ChannelPost, SystemChip, type PostContext } from './ChannelPost';
import { channelUrl, followChannel, previewChannel, unfollowChannel } from './channelApi';

export function ChannelPane() {
  const { chatId } = useParams<{ chatId: string }>();
  const chat = useChat(chatId);
  const loaded = useChats((s) => s.loaded);
  if (!chatId) return null;
  if (chat && chat.type === 'channel') return <ChannelView key={chat.id} chat={chat} />;
  if (!loaded) return <PageSpinner />;
  return <ChannelPreviewView key={chatId} chatId={chatId} />;
}

/** Virtuoso index base: prepended pages get lower indexes (keeps the scroll position). */
const BASE_INDEX = 1_000_000_000;

interface FeedContext {
  loadingMore: boolean;
}

function FeedHeader({ context }: { context?: FeedContext }) {
  return (
    <div className="flex h-10 items-center justify-center text-brand-ink">
      {context?.loadingMore ? <Spinner size={18} /> : null}
    </div>
  );
}

function FeedFooter() {
  return <div className="h-3" aria-hidden />;
}

const FEED_COMPONENTS = { Header: FeedHeader, Footer: FeedFooter };

/**
 * The posts, virtualized (a follower may scroll back through many pages of media posts):
 * starts at the newest post, follows new posts while at the bottom, loads older pages at the
 * top and keeps the position when they are prepended.
 */
function Feed({
  items,
  ctx,
  hasMore,
  loadingMore,
  onLoadMore,
  empty,
}: {
  items: ClientMessage[];
  ctx: PostContext;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore?: () => void;
  empty?: ReactNode;
}) {
  const virtuoso = useRef<VirtuosoHandle>(null);
  const [atBottom, setAtBottom] = useState(true);

  // Keys keep their array identity while only post contents change (reactions, progress).
  const prevKeys = useRef<string[]>([]);
  const keys = useMemo(() => {
    const next = items.map((m) => rowKey(m));
    const prev = prevKeys.current;
    const same = prev.length === next.length && next.every((k, i) => k === prev[i]);
    prevKeys.current = same ? prev : next;
    return prevKeys.current;
  }, [items]);

  // firstItemIndex bookkeeping (derived state, updated during render): prepends shift it,
  // a replaced window remounts the list at the newest post.
  const [track, setTrack] = useState(() => ({
    keys,
    first: BASE_INDEX - keys.length,
    epoch: 0,
  }));
  if (track.keys !== keys) {
    const shifted = track.keys.length ? shiftFirstIndex(track.keys, track.first, keys) : null;
    if (shifted !== null && shifted > 0) setTrack({ ...track, keys, first: shifted });
    else setTrack({ keys, first: BASE_INDEX - keys.length, epoch: track.epoch + 1 });
  }

  const context = useMemo<FeedContext>(() => ({ loadingMore }), [loadingMore]);
  const first = track.first;
  const renderItem = useCallback(
    (index: number, m: ClientMessage) => {
      const prev = items[index - first - 1];
      const day =
        !prev || !isSameLocalDay(prev.createdAt, m.createdAt)
          ? formatDaySeparator(m.createdAt)
          : null;
      return <FeedItem day={day} m={m} ctx={ctx} />;
    },
    [items, first, ctx],
  );

  return (
    <div className="chat-wallpaper relative flex min-h-0 flex-1 flex-col" data-testid="channel-feed">
      {items.length === 0 ? (
        <div className="flex flex-1 flex-col justify-end px-3 py-4">{empty}</div>
      ) : (
        <Virtuoso<ClientMessage, FeedContext>
          key={track.epoch}
          ref={virtuoso}
          data={items}
          context={context}
          firstItemIndex={track.first}
          initialTopMostItemIndex={{ index: Math.max(0, items.length - 1), align: 'end' }}
          computeItemKey={(_, m) => rowKey(m)}
          itemContent={renderItem}
          followOutput={(bottom) => (bottom ? 'smooth' : false)}
          alignToBottom
          startReached={hasMore && !loadingMore ? onLoadMore : undefined}
          atBottomStateChange={setAtBottom}
          atBottomThreshold={80}
          increaseViewportBy={{ top: 200, bottom: 200 }}
          components={FEED_COMPONENTS}
          className="scrollbar-thin"
          style={{ height: '100%' }}
        />
      )}
      {!atBottom && items.length ? (
        <IconButton
          icon={ChevronDown}
          label="Scroll to latest"
          variant="solid"
          size="md"
          className="absolute right-4 bottom-4 animate-pop shadow-elevated"
          onClick={() =>
            virtuoso.current?.scrollToIndex({ index: 'LAST', align: 'end', behavior: 'smooth' })
          }
        />
      ) : null}
    </div>
  );
}

const FeedItem = memo(function FeedItem({
  day,
  m,
  ctx,
}: {
  day: string | null;
  m: ClientMessage;
  ctx: PostContext;
}) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-2 px-3 pb-2 lg:px-10">
      {day ? (
        <div className="my-1 self-center rounded-lg bg-surface/90 px-3 py-1 text-xs font-medium text-muted shadow-bubble backdrop-blur">
          {day}
        </div>
      ) : null}
      {m.type === 'system' ? <SystemChip m={m} /> : <ChannelPost m={m} ctx={ctx} />}
    </div>
  );
});

/** Hide expired (disappearing) posts client-side; same array while nothing expired. */
function useVisibleItems(items: ClientMessage[]): ClientMessage[] {
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

const PREVIEW_CTX: PostContext = { chat: null, reactions: 'none', canVote: false };

function ChannelView({ chat }: { chat: ChatSummary }) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const msgs = useChatMessages(chat.id);
  const items = useVisibleItems(msgs.items);
  const [info, setInfo] = useState(false);
  const muted = isMuted(chat.mutedUntil);
  const admin = chat.permissions.canSend;

  useEffect(() => {
    useChats.getState().setOpenChat(chat.id);
    return () => {
      if (useChats.getState().openChatId === chat.id) useChats.getState().setOpenChat(null);
    };
  }, [chat.id]);

  useEffect(() => {
    if (!msgs.loaded && !msgs.loadingLatest && !msgs.error)
      void useMessages
        .getState()
        .loadLatest(chat.id)
        .catch(() => undefined);
  }, [chat.id, msgs.loaded, msgs.loadingLatest, msgs.error]);

  const toggleMute = () =>
    void setMuted(chat.id, muted ? null : MUTE_FOREVER_ISO)
      .then(() => toast.success(muted ? 'Channel unmuted' : 'Channel muted'))
      .catch((e: unknown) => toast.error(e));

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
      void navigate('/updates', { replace: true });
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

  const menu: MenuEntry[] = [
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

  // Stable props for the memoized posts.
  const ctx = useMemo<PostContext>(
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

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader
        back={desktop ? undefined : '/updates'}
        leading={<ChatAvatar chat={chat} size="md" className="mx-1" />}
        title={chatTitle(chat)}
        subtitle={`${formatCount(chat.memberCount)} ${chat.memberCount === 1 ? 'follower' : 'followers'}`}
        onTitleClick={() => setInfo(true)}
        border
        actions={
          <>
            <IconButton
              icon={muted ? BellOff : Bell}
              label={muted ? 'Unmute channel' : 'Mute channel'}
              onClick={toggleMute}
              active={muted}
            />
            <DropdownMenu
              aria-label="Channel options"
              items={menu}
              trigger={(t) => <IconButton {...t} icon={EllipsisVertical} label="Channel options" />}
            />
          </>
        }
      />
      {!msgs.loaded && msgs.loadingLatest ? (
        <div className="chat-wallpaper flex flex-1">
          <PageSpinner />
        </div>
      ) : msgs.error && !msgs.loaded ? (
        <div className="chat-wallpaper flex flex-1 items-center justify-center">
          <EmptyState
            icon={Megaphone}
            title="Couldn't load posts"
            description={msgs.error}
            action={
              <Button
                variant="soft"
                onClick={() =>
                  void useMessages
                    .getState()
                    .loadLatest(chat.id)
                    .catch(() => undefined)
                }
              >
                Try again
              </Button>
            }
          />
        </div>
      ) : (
        <Feed
          items={items}
          ctx={ctx}
          hasMore={msgs.hasMoreBefore && msgs.loaded}
          loadingMore={msgs.loadingBefore}
          onLoadMore={loadMore}
        />
      )}
      {admin ? (
        <ChannelComposer chat={chat} />
      ) : (
        <div className="flex shrink-0 items-center justify-center gap-3 border-t border-line bg-surface px-4 pt-2.5 pb-[max(10px,env(safe-area-inset-bottom))]">
          <p className="text-[13px] text-muted" data-testid="channel-readonly">
            Only admins can post in this channel
          </p>
          <Button size="sm" variant="soft" leftIcon={muted ? Bell : BellOff} onClick={toggleMute}>
            {muted ? 'Unmute' : 'Mute'}
          </Button>
        </div>
      )}
      <Sheet open={info} onClose={() => setInfo(false)} aria-label="Channel info">
        <ChannelInfoPanel chatId={chat.id} onClose={() => setInfo(false)} />
      </Sheet>
    </div>
  );
}

function ChannelPreviewView({ chatId }: { chatId: string }) {
  const desktop = useIsDesktop();
  const [data, setData] = useState<ChannelPreview | null>(null);
  const [error, setError] = useState<{ missing: boolean; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const ctrl = new AbortController();
    setData(null);
    setError(null);
    previewChannel(chatId, ctrl.signal)
      .then(setData)
      .catch((e: unknown) => {
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
      // The store now has the chat → ChannelPane switches to the follower view.
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  if (error)
    return (
      <div className="flex min-h-0 flex-1 flex-col bg-app">
        <PaneHeader title="Channel" back={desktop ? undefined : '/updates'} border />
        <div className="flex flex-1 items-center justify-center">
          <EmptyState
            icon={Megaphone}
            title={error.missing ? 'Channel not available' : "Couldn't open the channel"}
            description={
              error.missing
                ? 'This channel may be private or no longer exist. Private channels can only be joined with an invite link.'
                : error.message
            }
          />
        </div>
      </div>
    );
  if (!data) return <PageSpinner />;

  const c = data.channel;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PaneHeader
        back={desktop ? undefined : '/updates'}
        leading={
          <Avatar
            src={c.avatarUrl}
            name={c.name}
            colorSeed={c.id}
            kind="channel"
            size="md"
            className="mx-1"
          />
        }
        title={c.name}
        subtitle={`${formatCount(c.followerCount)} ${c.followerCount === 1 ? 'follower' : 'followers'}`}
        border
        actions={
          c.isPublic ? (
            <IconButton
              icon={Share2}
              label="Share channel"
              onClick={() => void shareLink({ title: c.name, url: channelUrl(c.id) })}
            />
          ) : undefined
        }
      />
      <Feed
        items={data.messages as ClientMessage[]}
        ctx={PREVIEW_CTX}
        hasMore={false}
        loadingMore={false}
        empty={<p className="self-center py-10 text-sm text-muted">No posts yet.</p>}
      />
      <div
        className={cn(
          'shrink-0 border-t border-line bg-surface px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]',
        )}
      >
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <Avatar
            src={c.avatarUrl}
            name={c.name}
            colorSeed={c.id}
            kind="channel"
            size="lg"
            className="hidden sm:inline-flex"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold text-fg">{c.name}</p>
            <p className="line-clamp-2 text-[13px] text-muted">
              {c.description || 'Follow to get new posts in your Updates tab.'}
            </p>
          </div>
          <Button onClick={() => void follow()} loading={busy} aria-label={`Follow ${c.name}`}>
            Follow
          </Button>
        </div>
      </div>
    </div>
  );
}
