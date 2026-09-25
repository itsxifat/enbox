/**
 * Channel page at /updates/channels/:chatId.
 * - Followers/admins (the channel is in my chat list): the channel feed — posts with the
 *   channel identity, reactions (per `channelSettings.reactions`), poll voting; admins get a
 *   composer (`permissions.canSend`), followers a mute toggle. Registers as the open chat
 *   (read receipts / unread suppression) like the conversation view.
 * - Anyone else: a preview (GET /api/channels/:id → header + recent posts) with Follow.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';
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

/** A post to scroll to (search results, starred messages: `?m=<seq>&mid=<id>`). */
export interface FeedJump {
  seq: number;
  messageId?: string;
}

function jumpFromParams(params: URLSearchParams): FeedJump | null {
  const seq = Number(params.get('m'));
  if (!Number.isInteger(seq) || seq <= 0) return null;
  return { seq, messageId: params.get('mid') ?? undefined };
}

function findPost(root: HTMLElement, t: FeedJump): HTMLElement | null {
  if (t.messageId) {
    const el = root.querySelector<HTMLElement>(`[data-message-id="${CSS.escape(t.messageId)}"]`);
    if (el) return el;
  }
  const posts = Array.from(root.querySelectorAll<HTMLElement>('[data-seq]'));
  return posts.find((el) => Number(el.dataset.seq) >= t.seq) ?? null;
}

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
}: {
  items: ClientMessage[];
  ctx: PostContext;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore?: () => void;
  /** The loaded window ends before the newest post (after a jump). */
  hasMoreAfter?: boolean;
  loadingNewer?: boolean;
  onLoadNewer?: () => void;
  /** "Scroll to latest" when newer posts aren't loaded. */
  onLatest?: () => void;
  jump?: FeedJump | null;
  onJumped?: () => void;
  empty?: ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const stick = useRef(!jump);
  const [far, setFar] = useState(false);
  const prevHeight = useRef(0);
  const lastId = items[items.length - 1]?.id;
  const firstId = items[0]?.id;

  // Keep the view pinned to the newest post (unless the reader scrolled up), and keep the
  // position when older posts are prepended.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevHeight.current && el.scrollTop < 40 && !stick.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (stick.current) {
      el.scrollTop = el.scrollHeight;
    }
    prevHeight.current = el.scrollHeight;
  }, [lastId, firstId, items.length]);

  // Scroll to the linked post once it is rendered, and flash it.
  useLayoutEffect(() => {
    const root = scroller.current;
    if (!jump || !root || !items.length) return;
    const el = findPost(root, jump);
    if (!el) return;
    stick.current = false;
    el.scrollIntoView?.({ block: 'center' });
    prevHeight.current = root.scrollHeight;
    const bubble = el.querySelector<HTMLElement>('[id^="post-"]') ?? el;
    bubble.animate?.(
      [{ boxShadow: '0 0 0 3px var(--brand)' }, { boxShadow: '0 0 0 3px transparent' }],
      { duration: 1600, easing: 'ease-out' },
    );
    onJumped?.();
  }, [jump, items, onJumped]);

  useEffect(() => {
    const el = top.current;
    if (!el || !hasMore || !onLoadMore) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) onLoadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore]);

  useEffect(() => {
    const el = bottom.current;
    if (!el || !hasMoreAfter || !onLoadNewer) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) onLoadNewer();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasMoreAfter, onLoadNewer]);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          const gap = el.scrollHeight - el.scrollTop - el.clientHeight;
          stick.current = gap < 80;
          prevHeight.current = el.scrollHeight;
          setFar(gap > 400);
        }}
        className="chat-wallpaper min-h-0 flex-1 overflow-y-auto scrollbar-thin"
        data-testid="channel-feed"
      >
        <div className="mx-auto flex min-h-full max-w-3xl flex-col justify-end gap-2 px-3 py-4 lg:px-10">
          <div ref={top} className="flex justify-center py-1 text-brand-ink">
            {loadingMore ? <Spinner size={18} /> : null}
          </div>
          {items.length === 0 ? empty : null}
          {items.map((m, i) => {
            const day =
              i === 0 || !isSameLocalDay(items[i - 1]!.createdAt, m.createdAt) ? (
                <div className="sticky top-2 z-[2] my-1 self-center rounded-lg bg-surface/90 px-3 py-1 text-xs font-medium text-muted shadow-bubble backdrop-blur">
                  {formatDaySeparator(m.createdAt)}
                </div>
              ) : null;
            return <FeedItem key={m.id} day={day} m={m} ctx={ctx} />;
          })}
          <div ref={bottom} className="flex justify-center text-brand-ink">
            {loadingNewer ? <Spinner size={18} /> : null}
          </div>
        </div>
      </div>
      {far || hasMoreAfter ? (
        <IconButton
          icon={ChevronDown}
          label="Scroll to latest"
          variant="solid"
          size="md"
          className="absolute right-4 bottom-4 animate-pop shadow-elevated"
          onClick={() => {
            stick.current = true;
            if (hasMoreAfter && onLatest) return onLatest();
            const el = scroller.current;
            if (el) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        />
      ) : null}
    </div>
  );
}

function FeedItem({ day, m, ctx }: { day: ReactNode; m: ClientMessage; ctx: PostContext }) {
  return (
    <>
      {day}
      {m.type === 'system' ? <SystemChip m={m} /> : <ChannelPost m={m} ctx={ctx} />}
    </>
  );
}

function useVisibleItems(items: ClientMessage[]): ClientMessage[] {
  // Hide expired (disappearing) posts client-side.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const next = items
      .map((m) => (m.expiresAt ? Date.parse(m.expiresAt) : Infinity))
      .filter((t) => t > now)
      .sort((a, b) => a - b)[0];
    if (!next || !Number.isFinite(next)) return;
    const t = setTimeout(() => setNow(Date.now()), Math.min(2 ** 31 - 1, next - now + 50));
    return () => clearTimeout(t);
  }, [items, now]);
  return items.filter((m) => !m.expiresAt || Date.parse(m.expiresAt) > now);
}

function ChannelView({ chat }: { chat: ChatSummary }) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const msgs = useChatMessages(chat.id);
  const items = useVisibleItems(msgs.items);
  const [info, setInfo] = useState(false);
  const muted = isMuted(chat.mutedUntil);
  const admin = chat.permissions.canSend;
  const [params, setParams] = useSearchParams();
  const [jump, setJump] = useState<FeedJump | null>(null);
  /** A `?m=` link is loading its window: don't load the latest page over it. */
  const jumping = useRef(false);
  const onJumped = useCallback(() => setJump(null), []);

  useEffect(() => {
    useChats.getState().setOpenChat(chat.id);
    return () => {
      if (useChats.getState().openChatId === chat.id) useChats.getState().setOpenChat(null);
    };
  }, [chat.id]);

  // `?m=<seq>&mid=<id>` (search results, starred): load that post's window, then scroll to it.
  const target = jumpFromParams(params);
  const targetKey = target ? `${target.seq}:${target.messageId ?? ''}` : null;
  useEffect(() => {
    if (!target) return;
    const next = new URLSearchParams(params);
    next.delete('m');
    next.delete('mid');
    setParams(next, { replace: true });
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
      .catch((e: unknown) => toast.error(e))
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

  const ctx: PostContext = {
    chat,
    reactions: chat.channelSettings?.reactions ?? 'all',
    canVote: chat.membership === 'active',
  };

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
          onLoadMore={() =>
            void useMessages
              .getState()
              .loadOlder(chat.id)
              .catch(() => undefined)
          }
          hasMoreAfter={msgs.hasMoreAfter && msgs.loaded}
          loadingNewer={msgs.loadingAfter}
          onLoadNewer={() =>
            void useMessages
              .getState()
              .loadNewer(chat.id)
              .catch(() => undefined)
          }
          onLatest={() =>
            void useMessages
              .getState()
              .loadLatest(chat.id)
              .catch(() => undefined)
          }
          jump={jump}
          onJumped={onJumped}
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
  const ctx: PostContext = { chat: null, reactions: 'none', canVote: false };
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
        ctx={ctx}
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
