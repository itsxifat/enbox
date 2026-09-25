/**
 * Full-screen media viewer: photos (click/double-tap to zoom, drag to pan, wheel zoom) and
 * videos, ←/→ (arrows, keys, swipe) through the chat's photos & videos, download, forward,
 * "show in chat", Esc closes. Loaded lazily (lazy.ts).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent,
  type WheelEvent,
} from 'react';
import {
  ArrowDownToLine,
  ChevronLeft,
  ChevronRight,
  Forward,
  MessageSquareText,
  X,
} from 'lucide-react';
import { renderMentions, type Message } from '@enbox/shared';
import { UserAvatar } from '@/components/common/UserAvatar';
import {
  IconButton,
  Portal,
  Spinner,
  useFocusTrap,
  useOverlay,
  useScrollLock,
} from '@/components/ui';
import { api, mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { formatDaySeparator, formatTime } from '@/lib/format';
import { useChat } from '@/stores/chats';
import { useMessages, type ClientMessage } from '@/stores/messages';
import { useUserName } from '@/stores/users';
import { mentionName } from '@/features/chats/preview';
import { canForward } from './actions';
import { useConversationUi } from './state';

function isVisual(m: ClientMessage): boolean {
  return (m.type === 'image' || m.type === 'video') && !!m.media && !m.deletedAt;
}

export function Lightbox() {
  const viewer = useConversationUi((s) => s.viewer);
  if (!viewer) return null;
  return <LightboxInner key={viewer.chatId} chatId={viewer.chatId} messageId={viewer.messageId} />;
}

function LightboxInner({ chatId, messageId }: { chatId: string; messageId: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const chat = useChat(chatId);
  const loaded = useMessages((s) => s.byChat[chatId]?.items);
  const [fetched, setFetched] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(true);
  const [current, setCurrent] = useState(messageId);
  const [zoom, setZoom] = useState<{ scale: number; x: number; y: number }>({
    scale: 1,
    x: 0,
    y: 0,
  });
  const drag = useRef<{ x: number; y: number; ox: number; oy: number; moved: boolean } | null>(
    null,
  );
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const close = useCallback(() => useConversationUi.getState().openViewer(null), []);
  useOverlay(true, close);
  useScrollLock(true);
  useFocusTrap(ref, true);

  const loadMore = useCallback(
    (before?: number) => {
      api
        .get<Message[]>(`/api/chats/${chatId}/media`, {
          query: { kind: 'media', before, limit: 60 },
        })
        .then((list) => {
          setFetched((prev) => {
            const map = new Map(prev.map((m) => [m.id, m] as const));
            for (const m of list) map.set(m.id, m);
            return [...map.values()];
          });
          setHasMore(list.length >= 60);
        })
        .catch(() => setHasMore(false));
    },
    [chatId],
  );
  useEffect(() => loadMore(), [loadMore]);

  const gallery = useMemo(() => {
    const map = new Map<string, ClientMessage>();
    for (const m of fetched) if (isVisual(m)) map.set(m.id, m);
    for (const m of loaded ?? []) if (isVisual(m)) map.set(m.id, { ...map.get(m.id), ...m });
    return [...map.values()].sort(
      (a, b) => (a.seq || Number.MAX_SAFE_INTEGER) - (b.seq || Number.MAX_SAFE_INTEGER),
    );
  }, [fetched, loaded]);

  const index = gallery.findIndex((m) => m.id === current);
  const m = index >= 0 ? gallery[index] : undefined;
  const sender = useUserName(m?.senderId, { you: 'You' });

  const go = useCallback(
    (delta: number) => {
      const next = gallery[index + delta];
      if (!next) return;
      setCurrent(next.id);
      setZoom({ scale: 1, x: 0, y: 0 });
      if (delta < 0 && index + delta === 0 && hasMore && gallery[0]?.seq) loadMore(gallery[0].seq);
    },
    [gallery, index, hasMore, loadMore],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go]);

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (zoom.scale > 1) {
      drag.current = { x: e.clientX, y: e.clientY, ox: zoom.x, oy: zoom.y, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
    } else swipe.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    setZoom((z) => ({ ...z, x: d.ox + dx, y: d.oy + dy }));
  };
  const onPointerUp = (e: PointerEvent<HTMLDivElement>) => {
    const s = swipe.current;
    swipe.current = null;
    if (s && e.pointerType !== 'mouse') {
      const dx = e.clientX - s.x;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(e.clientY - s.y)) go(dx < 0 ? 1 : -1);
    }
    setTimeout(() => (drag.current = null), 0);
  };
  const toggleZoom = (e: { clientX: number; clientY: number; currentTarget: HTMLElement }) => {
    if (drag.current?.moved) return;
    if (zoom.scale > 1) {
      setZoom({ scale: 1, x: 0, y: 0 });
      return;
    }
    const r = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - (r.left + r.width / 2);
    const cy = e.clientY - (r.top + r.height / 2);
    setZoom({ scale: 2.5, x: -cx * 1.5, y: -cy * 1.5 });
  };
  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    if (m?.type !== 'image') return;
    setZoom((z) => {
      const scale = Math.max(1, Math.min(5, z.scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
      return scale === 1 ? { scale: 1, x: 0, y: 0 } : { ...z, scale };
    });
  };

  const src = m ? mediaUrl(m.localUrl ?? m.media!.url) : undefined;
  const caption = m?.text ? renderMentions(m.text, mentionName) : null;

  return (
    <Portal>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label="Media viewer"
        tabIndex={-1}
        className="fixed inset-0 z-[70] flex animate-fade-in flex-col bg-black/95 text-white outline-none"
      >
        <header className="flex h-16 shrink-0 items-center gap-3 px-2 pt-safe sm:px-4">
          <IconButton icon={X} label="Close" variant="glass" onClick={close} />
          {m ? (
            <>
              <UserAvatar userId={m.senderId} size="md" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] font-semibold">
                  {m.senderId ? sender : chat ? (chat.name ?? 'Channel') : ''}
                </p>
                <p className="truncate text-[12px] text-white/70">
                  {formatDaySeparator(m.createdAt)}, {formatTime(m.createdAt)}
                </p>
              </div>
              <IconButton
                icon={MessageSquareText}
                label="Show in chat"
                variant="glass"
                onClick={() => {
                  close();
                  if (m.seq) useConversationUi.getState().requestJump(chatId, m.seq, m.id);
                }}
              />
              {canForward(m) ? (
                <IconButton
                  icon={Forward}
                  label="Forward"
                  variant="glass"
                  onClick={() => {
                    close();
                    useConversationUi.getState().openForward([m]);
                  }}
                />
              ) : null}
              <a
                href={src}
                download={m.media!.fileName ?? true}
                className="flex size-10 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur hover:bg-black/50"
                aria-label="Download"
                title="Download"
              >
                <ArrowDownToLine size={22} aria-hidden />
              </a>
            </>
          ) : (
            <div className="flex-1" />
          )}
        </header>

        <div
          className="relative flex min-h-0 flex-1 touch-none items-center justify-center overflow-hidden select-none"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
        >
          {!m ? (
            <Spinner size={32} />
          ) : m.type === 'video' ? (
            <video
              key={m.id}
              src={src}
              poster={mediaUrl(m.media!.thumbnailUrl ?? undefined)}
              controls
              autoPlay
              playsInline
              className="max-h-full max-w-full"
            />
          ) : (
            <img
              key={m.id}
              src={src}
              alt={caption ?? 'Photo'}
              draggable={false}
              onClick={toggleZoom}
              onDoubleClick={(e) => e.preventDefault()}
              className={cn(
                'max-h-full max-w-full object-contain transition-transform duration-200',
                zoom.scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-zoom-in',
              )}
              style={{ transform: `translate(${zoom.x}px, ${zoom.y}px) scale(${zoom.scale})` }}
            />
          )}
          {index > 0 ? (
            <IconButton
              icon={ChevronLeft}
              label="Previous"
              variant="glass"
              size="lg"
              onClick={() => go(-1)}
              className="absolute left-3 hidden sm:inline-flex"
            />
          ) : null}
          {index >= 0 && index < gallery.length - 1 ? (
            <IconButton
              icon={ChevronRight}
              label="Next"
              variant="glass"
              size="lg"
              onClick={() => go(1)}
              className="absolute right-3 hidden sm:inline-flex"
            />
          ) : null}
        </div>

        {caption ? (
          <p className="mx-auto max-w-2xl shrink-0 px-6 py-3 text-center text-[15px] break-words whitespace-pre-wrap text-white/90">
            {caption}
          </p>
        ) : null}
        {gallery.length > 1 ? (
          <div className="flex shrink-0 justify-center gap-1.5 overflow-x-auto px-4 pt-1 pb-[max(12px,env(safe-area-inset-bottom))] scrollbar-none">
            {gallery.map((g) => {
              const thumb = mediaUrl(
                g.media!.thumbnailUrl ??
                  (g.type === 'image' ? (g.localUrl ?? g.media!.url) : undefined),
              );
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-label={g.type === 'video' ? 'Video' : 'Photo'}
                  aria-current={g.id === current || undefined}
                  onClick={() => {
                    setCurrent(g.id);
                    setZoom({ scale: 1, x: 0, y: 0 });
                  }}
                  className={cn(
                    'size-12 shrink-0 overflow-hidden rounded-md bg-white/10 transition-opacity',
                    g.id === current
                      ? 'opacity-100 ring-2 ring-white'
                      : 'opacity-50 hover:opacity-80',
                  )}
                >
                  {thumb ? (
                    <img src={thumb} alt="" className="size-full object-cover" loading="lazy" />
                  ) : null}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
    </Portal>
  );
}
