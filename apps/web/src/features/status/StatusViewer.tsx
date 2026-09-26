/**
 * Full-screen status viewer (/updates/status/:userId): segmented progress bars, auto-advance
 * (text/photo 5 s, video = its duration), tap left/right, hold to pause, swipe / arrows to
 * the next or previous person, marks statuses viewed, reply (a direct message quoting the
 * status) and quick reactions; for my own statuses: viewers list and delete.
 */
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useLocation, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  EllipsisVertical,
  Eye,
  Heart,
  Lock,
  MessageCircle,
  Pause,
  Play,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  userDisplayName,
  type ID,
  type Status,
  type StatusFeedItem,
  type UserPublic,
} from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import { SendIcon, UpdatesIcon } from '@/components/icons';
import {
  EmptyState,
  ListItemSkeleton,
  Menu,
  Modal,
  Portal,
  Spinner,
  confirm,
  toast,
  useOverlay,
} from '@/components/ui';
import { useFocusTrap } from '@/components/ui/overlay';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatRelativeShort } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { selfPublic, useStatus, useStatusLists } from '@/stores/status';
import { ensureDirectChat } from '@/features/calls/directChat';
import { firstUnviewedIndex, fontStyle, moveViewer, statusDuration, textStatusSize } from './logic';
import { StatusPrivacyDialog } from './StatusPrivacyDialog';
import './status.css';

export const STATUS_REACTIONS = ['😍', '😂', '😮', '😢', '👏', '🙏', '🎉', '💯'] as const;

interface ViewerState {
  queue?: ID[];
  /** Open at this status (from "My status"). */
  startId?: ID;
}

export function StatusViewer() {
  const { userId = '' } = useParams<{ userId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const me = useMe();
  const feed = useStatus((s) => s.feed);
  const loaded = useStatus((s) => s.loaded);
  const lists = useStatusLists();
  const isMe = userId === me?.id;

  const [startId] = useState(() => (location.state as ViewerState | null)?.startId);
  const [queue] = useState<ID[]>(() => {
    const q = (location.state as ViewerState | null)?.queue;
    if (q?.length) return q;
    if (isMe) return [userId];
    const src = lists.recent.some((u) => u.user.id === userId) ? lists.recent : lists.viewed;
    const ids = src.map((u) => u.user.id);
    return ids.includes(userId) ? ids : [userId];
  });

  const close = useCallback(() => navigate('/updates', { replace: true }), [navigate]);
  const openUser = useCallback(
    (index: number) => {
      const next = queue[index];
      if (!next) close();
      else
        navigate(`/updates/status/${next}`, {
          replace: true,
          state: { queue } satisfies ViewerState,
        });
    },
    [queue, navigate, close],
  );

  useEffect(() => {
    if (!loaded)
      void useStatus
        .getState()
        .loadFeed()
        .catch(() => undefined);
  }, [loaded]);

  const item: StatusFeedItem | null = !feed
    ? null
    : isMe && me
      ? {
          user: selfPublic(me),
          statuses: feed.mine,
          allViewed: true,
          lastUpdatedAt: feed.mine[feed.mine.length - 1]?.createdAt ?? '',
        }
      : (feed.updates.find((u) => u.user.id === userId) ?? null);
  const userIndex = Math.max(0, queue.indexOf(userId));
  const empty = loaded && (!item || item.statuses.length === 0);

  // This person's statuses vanished (deleted/expired): move on.
  useEffect(() => {
    if (!empty) return;
    const next = queue.findIndex(
      (id, i) =>
        i > userIndex &&
        (feed?.updates.some((u) => u.user.id === id && u.statuses.length) ?? false),
    );
    if (next >= 0) openUser(next);
    else close();
  }, [empty, queue, userIndex, feed, openUser, close]);

  return (
    <Portal>
      <ViewerFrame
        onClose={close}
        hasPrev={userIndex > 0}
        hasNext={userIndex + 1 < queue.length}
        onPrevUser={() => openUser(userIndex - 1)}
        onNextUser={() => openUser(userIndex + 1)}
      >
        {!item || !item.statuses.length ? (
          <div className="flex flex-1 items-center justify-center">
            {loaded ? null : <Spinner size={28} className="text-white" />}
          </div>
        ) : (
          <StoryView
            key={item.user.id}
            item={item}
            isMe={isMe}
            startId={startId}
            userIndex={userIndex}
            queueLength={queue.length}
            onClose={close}
            onUser={(dir) => {
              const target = userIndex + dir;
              if (target >= 0 && target < queue.length) openUser(target);
              else if (dir === 1) close();
            }}
          />
        )}
      </ViewerFrame>
    </Portal>
  );
}

function ViewerFrame({
  children,
  onClose,
  hasPrev,
  hasNext,
  onPrevUser,
  onNextUser,
}: {
  children: React.ReactNode;
  onClose: () => void;
  hasPrev: boolean;
  hasNext: boolean;
  onPrevUser: () => void;
  onNextUser: () => void;
}) {
  const desktop = useIsDesktop();
  useOverlay(true, onClose);
  // Modal: move focus in (to the viewer itself, so nothing is activated or paused by it),
  // keep Tab inside, and give focus back to the Updates row on close.
  const frame = useRef<HTMLDivElement>(null);
  useFocusTrap(frame, true, frame);
  return (
    <div
      ref={frame}
      tabIndex={-1}
      role="dialog"
      aria-modal="true"
      aria-label="Status"
      data-testid="status-viewer"
      className="fixed inset-0 z-[44] flex animate-fade-in items-center justify-center bg-[#0b0a10] text-white outline-none px-safe"
    >
      {desktop ? (
        <>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            className="absolute top-4 right-4 flex size-11 items-center justify-center rounded-full text-white/80 hover:bg-white/10 hover:text-white"
          >
            <X size={24} aria-hidden />
          </button>
          <button
            type="button"
            aria-label="Previous person"
            disabled={!hasPrev}
            onClick={onPrevUser}
            className="mr-6 flex size-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:invisible"
          >
            <ChevronLeft size={26} aria-hidden />
          </button>
        </>
      ) : null}
      <div
        className={cn(
          'relative flex flex-col overflow-hidden bg-black',
          desktop
            ? 'aspect-[9/16] h-[min(calc(100dvh-48px),880px)] rounded-2xl shadow-2xl'
            : 'size-full',
        )}
      >
        {children}
      </div>
      {desktop ? (
        <button
          type="button"
          aria-label="Next person"
          disabled={!hasNext}
          onClick={onNextUser}
          className="ml-6 flex size-12 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20 disabled:invisible"
        >
          <ChevronRight size={26} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

/** rAF timer driving a progress bar element without re-rendering. */
function useStoryTimer(opts: {
  key: string;
  duration: number;
  running: boolean;
  bar: React.RefObject<HTMLSpanElement | null>;
  onDone: () => void;
}) {
  const elapsed = useRef(0);
  const done = useRef(opts.onDone);
  useEffect(() => {
    done.current = opts.onDone;
  });
  useEffect(() => {
    elapsed.current = 0;
    if (opts.bar.current) opts.bar.current.style.transform = 'scaleX(0)';
  }, [opts.key, opts.bar]);
  useEffect(() => {
    if (!opts.running) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      elapsed.current += now - last;
      last = now;
      const p = Math.min(1, elapsed.current / opts.duration);
      if (opts.bar.current) opts.bar.current.style.transform = `scaleX(${p})`;
      if (p >= 1) {
        done.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [opts.running, opts.duration, opts.key, opts.bar]);
}

function StoryView({
  item,
  isMe,
  startId,
  userIndex,
  queueLength,
  onClose,
  onUser,
}: {
  item: StatusFeedItem;
  isMe: boolean;
  startId?: ID;
  userIndex: number;
  queueLength: number;
  onClose: () => void;
  onUser: (dir: 1 | -1) => void;
}) {
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const statuses = item.statuses;
  const [index, setIndex] = useState(() => {
    const at = startId ? statuses.findIndex((s) => s.id === startId) : -1;
    return at >= 0 ? at : isMe ? 0 : firstUnviewedIndex(statuses);
  });
  const idx = Math.min(index, statuses.length - 1);
  const status = statuses[idx]!;
  // Media readiness is keyed by status id (a cached image/video can load before any effect runs).
  const [readyId, setReadyId] = useState<ID | null>(null);
  const ready = status.type === 'text' || readyId === status.id;
  const [held, setHeld] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const [replying, setReplying] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const menuOpen = !!menuAnchor;
  const [privacy, setPrivacy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [bursts, setBursts] = useState<{ id: number; emoji: string }[]>([]);
  const bar = useRef<HTMLSpanElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const paused = held || manualPause || replying || sheet || menuOpen || privacy;
  const running = ready && !paused;

  const [restart, setRestart] = useState(0);
  const go = useCallback(
    (dir: 1 | -1) => {
      const m = moveViewer(dir, { userIndex, index: idx, count: statuses.length, queueLength });
      if (m.kind === 'status') {
        if (m.index === idx) {
          // Back on the very first status: restart it.
          setRestart((n) => n + 1);
          if (video.current) video.current.currentTime = 0;
        }
        setIndex(m.index);
      } else if (m.kind === 'user') onUser(m.direction);
      else onClose();
    },
    [idx, statuses.length, userIndex, queueLength, onUser, onClose],
  );

  useEffect(() => {
    if (!isMe) useStatus.getState().markViewed(status.id);
  }, [status.id, isMe]);

  useStoryTimer({
    key: `${status.id}:${restart}`,
    duration: statusDuration(status),
    running: running && status.type !== 'video',
    bar,
    onDone: () => go(1),
  });

  // Videos drive their own progress.
  useEffect(() => {
    const v = video.current;
    if (!v || status.type !== 'video') return;
    if (running) {
      v.muted = muted;
      void v.play().catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'NotAllowedError' && !v.muted) {
          setMuted(true);
          v.muted = true;
          void v.play().catch(() => undefined);
        }
      });
    } else v.pause();
  }, [running, status.type, status.id, muted]);

  // Keyboard: ←/→ previous/next, space pause.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA)$/.test(t.tagName))) return;
      if (sheet || privacy) return;
      if (e.key === 'ArrowRight') go(1);
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === ' ') {
        e.preventDefault();
        setManualPause((p) => !p);
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, sheet, privacy]);

  // Tap zones, hold to pause, swipe between people / down to close.
  const gesture = useRef<{
    x: number;
    y: number;
    t: number;
    timer: ReturnType<typeof setTimeout> | null;
    held: boolean;
  } | null>(null);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('button, a, input, textarea, [role="menu"]')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const g = {
      x: e.clientX,
      y: e.clientY,
      t: Date.now(),
      timer: null as ReturnType<typeof setTimeout> | null,
      held: false,
    };
    g.timer = setTimeout(() => {
      g.held = true;
      setHeld(true);
    }, 220);
    gesture.current = g;
  };
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.timer) clearTimeout(g.timer);
    if (g.held) {
      setHeld(false);
      return;
    }
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
      onUser(dx < 0 ? 1 : -1);
      return;
    }
    if (dy > 90 && Math.abs(dy) > Math.abs(dx)) {
      onClose();
      return;
    }
    if (Math.hypot(dx, dy) > 12) return;
    const rect = e.currentTarget.getBoundingClientRect();
    go(e.clientX - rect.left < rect.width * 0.3 ? -1 : 1);
  };
  const onPointerCancel = () => {
    const g = gesture.current;
    gesture.current = null;
    if (g?.timer) clearTimeout(g.timer);
    if (g?.held) setHeld(false);
  };

  const openChat = async () => {
    try {
      const chat = await ensureDirectChat(item.user.id);
      navigate(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
    }
  };

  const react = async (emoji: string) => {
    const id = Date.now();
    setBursts((b) => [...b, { id, emoji }]);
    setTimeout(() => setBursts((b) => b.filter((x) => x.id !== id)), 1600);
    try {
      await useStatus.getState().react(status.id, emoji);
    } catch (e) {
      toast.error(e);
    }
  };

  const name = isMe ? 'My status' : userDisplayName(item.user);
  const chromeHidden = held;

  return (
    <div
      className="relative flex size-full flex-col select-none"
      role="group"
      aria-roledescription="status"
      aria-label={`${name}, update ${idx + 1} of ${statuses.length}, ${formatRelativeShort(status.createdAt)}`}
      data-testid="status-story"
      data-status-id={status.id}
      data-status-index={idx}
    >
      {/* Content + gesture layer */}
      <div
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <StatusContent
          status={status}
          videoRef={video}
          muted={muted}
          onReady={() => setReadyId(status.id)}
          onVideoProgress={(p) => {
            if (bar.current) bar.current.style.transform = `scaleX(${p})`;
          }}
          onVideoEnded={() => go(1)}
        />
        {!ready ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <Spinner size={30} className="text-white" label="Loading" />
          </div>
        ) : null}
      </div>

      {/* Header */}
      <div
        className={cn(
          'pointer-events-none relative z-10 bg-gradient-to-b from-black/60 via-black/25 to-transparent px-2.5 pt-[max(8px,env(safe-area-inset-top))] pb-6 transition-opacity duration-200',
          chromeHidden && 'opacity-0',
        )}
      >
        <div className="flex gap-1" aria-hidden>
          {statuses.map((s, i) => (
            <span key={s.id} className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/35">
              <span
                ref={i === idx ? bar : undefined}
                className="block h-full origin-left rounded-full bg-white"
                style={{ transform: `scaleX(${i < idx ? 1 : 0})` }}
              />
            </span>
          ))}
        </div>
        <div className="pointer-events-auto mt-2 flex items-center gap-2">
          {!desktop ? (
            <button
              type="button"
              aria-label="Close"
              onClick={onClose}
              className="-ml-1 flex size-10 items-center justify-center rounded-full hover:bg-white/10"
            >
              <ArrowLeft size={22} aria-hidden />
            </button>
          ) : null}
          <UserAvatar user={item.user} size="sm" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[15px] font-semibold leading-tight">{name}</p>
            <p className="truncate text-[12.5px] text-white/75">
              {formatRelativeShort(status.createdAt)}
            </p>
          </div>
          {status.type === 'video' ? (
            <button
              type="button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={() => setMuted((m) => !m)}
              className="flex size-10 items-center justify-center rounded-full hover:bg-white/10"
            >
              {muted ? <VolumeX size={20} aria-hidden /> : <Volume2 size={20} aria-hidden />}
            </button>
          ) : null}
          <button
            type="button"
            aria-label={manualPause ? 'Play' : 'Pause'}
            onClick={() => setManualPause((p) => !p)}
            className="flex size-10 items-center justify-center rounded-full hover:bg-white/10"
          >
            {manualPause ? <Play size={20} aria-hidden /> : <Pause size={20} aria-hidden />}
          </button>
          <button
            type="button"
            aria-label="Status menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={(e) => setMenuAnchor(menuOpen ? null : e.currentTarget)}
            className="flex size-10 items-center justify-center rounded-full hover:bg-white/10"
          >
            <EllipsisVertical size={20} aria-hidden />
          </button>
        </div>
      </div>
      <Menu
        open={menuOpen}
        anchor={menuAnchor}
        align="end"
        aria-label="Status menu"
        onClose={() => setMenuAnchor(null)}
        items={
          isMe
            ? [
                { label: 'Viewers', icon: Eye, onSelect: () => setSheet(true) },
                {
                  label: 'All my updates',
                  icon: UpdatesIcon,
                  onSelect: () => navigate('/updates/status/mine', { replace: true }),
                },
                { label: 'Status privacy', icon: Lock, onSelect: () => setPrivacy(true) },
                'separator',
                {
                  label: 'Delete',
                  icon: Trash2,
                  danger: true,
                  onSelect: () => void deleteStatus(status),
                },
              ]
            : [{ label: 'Message', icon: MessageCircle, onSelect: () => void openChat() }]
        }
      />

      <div className="flex-1" />

      {/* Caption */}
      {status.type !== 'text' && status.text ? (
        <div
          className={cn(
            'pointer-events-none relative z-10 px-5 pb-3 text-center transition-opacity',
            chromeHidden && 'opacity-0',
          )}
        >
          <p className="line-clamp-5 text-[15px] leading-snug whitespace-pre-wrap text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
            {status.text}
          </p>
        </div>
      ) : null}

      {/* Footer */}
      <div className={cn('relative z-10 transition-opacity', chromeHidden && 'opacity-0')}>
        {isMe ? (
          <div className="flex justify-center bg-gradient-to-t from-black/60 to-transparent px-4 pt-6 pb-[max(16px,env(safe-area-inset-bottom))]">
            <button
              type="button"
              onClick={() => setSheet(true)}
              data-testid="status-views"
              className="flex flex-col items-center gap-0.5 rounded-2xl px-4 py-1.5 text-[14px] font-medium hover:bg-white/10"
            >
              <ChevronUp size={18} aria-hidden />
              <span className="flex items-center gap-1.5">
                <Eye size={18} aria-hidden /> {status.viewCount ?? 0}{' '}
                {status.viewCount === 1 ? 'view' : 'views'}
              </span>
            </button>
          </div>
        ) : (
          <ReplyBar
            status={status}
            author={item.user}
            focused={replying}
            onFocusChange={setReplying}
            onReact={(e) => void react(e)}
          />
        )}
      </div>

      {bursts.map((b) => (
        <span
          key={b.id}
          aria-hidden
          className="pointer-events-none absolute bottom-28 left-1/2 z-20 -ml-6 animate-[status-float_1.5s_ease-out_forwards] text-5xl"
        >
          {b.emoji}
        </span>
      ))}

      {isMe ? <ViewersSheet open={sheet} status={status} onClose={() => setSheet(false)} /> : null}
      <StatusPrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
    </div>
  );
}

async function deleteStatus(status: Status) {
  const ok = await confirm({
    title: 'Delete this status update?',
    message: 'It will also be deleted for everyone who received it.',
    confirmLabel: 'Delete',
    danger: true,
  });
  if (!ok) return;
  try {
    await useStatus.getState().deleteStatus(status.id);
    toast.success('Status deleted');
  } catch (e) {
    toast.error(e);
  }
}

function StatusContent({
  status,
  videoRef,
  muted,
  onReady,
  onVideoProgress,
  onVideoEnded,
}: {
  status: Status;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  muted: boolean;
  onReady: () => void;
  onVideoProgress: (p: number) => void;
  onVideoEnded: () => void;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [status.id]);

  if (status.type === 'text') {
    return (
      <div
        className="flex size-full items-center justify-center px-8 py-24 text-center"
        style={{ backgroundColor: status.backgroundColor ?? '#6D5DFC' }}
        data-testid="status-text"
      >
        <p
          className="max-w-full leading-tight break-words whitespace-pre-wrap text-white"
          style={{ fontSize: textStatusSize(status.text ?? ''), ...fontStyle(status.font) }}
        >
          {status.text}
        </p>
      </div>
    );
  }
  const src = mediaUrl(status.media?.url);
  if (failed || !src) {
    return (
      <div className="flex size-full flex-col items-center justify-center gap-1 px-8 text-center">
        <p className="text-[16px] font-semibold text-white">This status can't be shown</p>
        <p className="text-[14px] text-white/70">The photo or video is unavailable.</p>
      </div>
    );
  }
  if (status.type === 'image') {
    return (
      <div className="relative size-full">
        <img
          src={src}
          alt=""
          aria-hidden
          className="absolute inset-0 size-full scale-110 object-cover opacity-50 blur-2xl"
        />
        <img
          src={src}
          alt={status.text ?? 'Photo status'}
          className="relative size-full object-contain"
          draggable={false}
          onLoad={onReady}
          onError={() => {
            setFailed(true);
            onReady();
          }}
        />
      </div>
    );
  }
  return (
    <video
      ref={videoRef}
      key={status.id}
      src={src}
      playsInline
      muted={muted}
      preload="auto"
      className="size-full object-contain"
      aria-label={status.text ?? 'Video status'}
      onCanPlay={onReady}
      onTimeUpdate={(e) => {
        const v = e.currentTarget;
        if (v.duration > 0 && Number.isFinite(v.duration))
          onVideoProgress(v.currentTime / v.duration);
      }}
      onEnded={onVideoEnded}
      onError={() => {
        setFailed(true);
        onReady();
      }}
    />
  );
}

function ReplyBar({
  status,
  author,
  focused,
  onFocusChange,
  onReact,
}: {
  status: Status;
  author: UserPublic;
  focused: boolean;
  onFocusChange: (f: boolean) => void;
  onReact: (emoji: string) => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const send = async (e?: FormEvent) => {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      const chat = await ensureDirectChat(author.id);
      await useMessages
        .getState()
        .sendMessage(chat.id, { type: 'text', text: body, statusReplyToId: status.id });
      setText('');
      input.current?.blur();
      onFocusChange(false);
      toast.success('Reply sent');
    } catch (err) {
      toast.error(err);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      className="bg-gradient-to-t from-black/70 via-black/40 to-transparent px-3 pt-8 pb-[max(12px,env(safe-area-inset-bottom))]"
      // Focus anywhere in the reply bar (input or a quick reaction) counts as replying, so
      // Shift+Tab from the input onto a reaction doesn't unmount the reactions under focus.
      onFocus={() => onFocusChange(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && !text.trim())
          onFocusChange(false);
      }}
    >
      {focused ? (
        <div className="mb-3 flex justify-center gap-1.5" role="group" aria-label="Quick reactions">
          {STATUS_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React ${emoji}`}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => onReact(emoji)}
              className="flex size-11 items-center justify-center rounded-full text-[26px] transition-transform hover:scale-125 hover:bg-white/10"
            >
              {emoji}
            </button>
          ))}
        </div>
      ) : null}
      <form onSubmit={(e) => void send(e)} className="flex items-center gap-2">
        <input
          ref={input}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Reply to ${userDisplayName(author)}…`}
          aria-label="Reply"
          maxLength={4096}
          className="h-12 min-w-0 flex-1 rounded-full border border-white/25 bg-black/30 px-5 text-[15px] text-white backdrop-blur placeholder:text-white/65 focus:border-white/50 focus:outline-none"
        />
        {text.trim() ? (
          <button
            type="submit"
            aria-label="Send reply"
            disabled={sending}
            className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand text-on-brand hover:bg-brand-strong disabled:opacity-60"
          >
            {sending ? <Spinner size={20} label={null} /> : <SendIcon size={20} aria-hidden />}
          </button>
        ) : (
          <button
            type="button"
            aria-label="React ❤️"
            onClick={() => onReact('❤️')}
            className="flex size-12 shrink-0 items-center justify-center rounded-full text-white transition-transform hover:scale-110 hover:bg-white/10"
          >
            <Heart size={26} aria-hidden />
          </button>
        )}
      </form>
    </div>
  );
}

function ViewersSheet({
  open,
  status,
  onClose,
}: {
  open: boolean;
  status: Status;
  onClose: () => void;
}) {
  const viewers = useStatus((s) => s.viewers[status.id]);
  useEffect(() => {
    if (open)
      void useStatus
        .getState()
        .loadViewers(status.id)
        .catch(() => undefined);
  }, [open, status.id]);
  const items = viewers?.items ?? [];
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Viewed by ${viewers?.loaded ? items.length : (status.viewCount ?? 0)}`}
      size="sm"
      bodyClassName="px-0 pb-4"
    >
      {!viewers?.loaded && viewers?.error ? (
        <EmptyState title="Couldn't load viewers" description={viewers.error} compact />
      ) : !viewers?.loaded ? (
        <ListItemSkeleton count={3} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={Eye}
          title="No views yet"
          description="People who see your status will show up here."
          compact
        />
      ) : (
        <ul data-testid="status-viewers">
          {items.map((v) => (
            <li key={v.user.id} className="flex items-center gap-3 px-5 py-2">
              <UserAvatar user={v.user} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-medium text-fg">
                  {userDisplayName(v.user)}
                </p>
                <p className="text-[13px] text-muted">{formatRelativeShort(v.viewedAt)}</p>
              </div>
              {v.reaction ? (
                <span className="text-[22px]" aria-label={`Reacted ${v.reaction}`}>
                  {v.reaction}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 px-5 text-center text-[12px] text-subtle">
        People with read receipts turned off aren't listed.
      </p>
    </Modal>
  );
}
