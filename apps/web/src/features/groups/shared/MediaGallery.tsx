/**
 * Shared media of a chat (`GET /api/chats/:id/media?kind=`): photos & videos grid, links,
 * docs. Paged with `before` (fewer than `limit` = end). Also exports a compact preview strip
 * for info panels.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, FileText, ImageOff, Link2, Play, X } from 'lucide-react';
import { formatBytes, formatDuration, renderMentions, type ID, type Message } from '@enbox/shared';
import { PaneHeader } from '@/components/layout/PaneHeader';
import { EmptyState, IconButton, Spinner, Tabs } from '@/components/ui';
import { Portal, useOverlay } from '@/components/ui/overlay';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { formatChatListTime } from '@/lib/format';
import { nameOf } from '@/stores/users';
import { extractLinks, hostOf, hrefOf } from './links';

export type GalleryKind = 'media' | 'links' | 'docs';
const PAGE = 60;

function useMediaPages(chatId: ID, kind: GalleryKind, limit = PAGE) {
  const [items, setItems] = useState<Message[]>([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const load = useCallback(
    async (before?: number) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      try {
        const page = await api.get<Message[]>(`/api/chats/${chatId}/media`, {
          query: { kind, limit, before },
        });
        setItems((prev) => (before ? [...prev, ...page] : page));
        setDone(page.length < limit);
        setError(null);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        busy.current = false;
        setLoading(false);
      }
    },
    [chatId, kind, limit],
  );

  useEffect(() => {
    setItems([]);
    setDone(false);
    void load();
  }, [load]);

  const more = () => {
    const last = items[items.length - 1];
    if (!done && last) void load(last.seq);
  };
  return { items, done, loading, error, more };
}

/** Up to 4 recent photo/video thumbnails for the info panel row. */
export function MediaPreviewStrip({ chatId, onOpen }: { chatId: ID; onOpen: () => void }) {
  const { items } = useMediaPages(chatId, 'media', 4);
  if (!items.length) return null;
  return (
    <div className="grid grid-cols-4 gap-1.5 px-5 pb-3">
      {items.slice(0, 4).map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={onOpen}
          className="relative aspect-square overflow-hidden rounded-xl bg-surface-2 outline-none focus-visible:outline-2 focus-visible:outline-brand"
          aria-label="Open media"
        >
          <Thumb m={m} />
        </button>
      ))}
    </div>
  );
}

function Thumb({ m }: { m: Message }) {
  const src = mediaUrl(m.media?.thumbnailUrl ?? (m.type === 'image' ? m.media?.url : null));
  return (
    <>
      {src ? (
        <img src={src} alt="" loading="lazy" className="size-full object-cover" draggable={false} />
      ) : (
        <span className="flex size-full items-center justify-center text-subtle">
          {m.type === 'video' ? <Play size={22} aria-hidden /> : <ImageOff size={20} aria-hidden />}
        </span>
      )}
      {m.type === 'video' ? (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-3 pb-1 text-[11px] font-medium text-white">
          <Play size={11} fill="currentColor" aria-hidden />
          {m.media?.durationMs ? formatDuration(m.media.durationMs) : null}
        </span>
      ) : null}
    </>
  );
}

export function MediaGalleryView({
  chatId,
  title,
  initial = 'media',
  onBack,
}: {
  chatId: ID;
  title: string;
  initial?: GalleryKind;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<GalleryKind>(initial);
  return (
    <div className="flex h-full min-h-full flex-col bg-surface">
      <PaneHeader title={title} back={onBack} border>
        <Tabs
          aria-label="Shared content"
          value={tab}
          onChange={setTab}
          idBase="gallery"
          items={[
            { value: 'media', label: 'Media' },
            { value: 'links', label: 'Links' },
            { value: 'docs', label: 'Docs' },
          ]}
          className="-mx-3 -mb-2"
        />
      </PaneHeader>
      <div
        role="tabpanel"
        id={`gallery-panel-${tab}`}
        aria-labelledby={`gallery-tab-${tab}`}
        className="min-h-0 flex-1"
      >
        <GalleryList key={tab} chatId={chatId} kind={tab} />
      </div>
    </div>
  );
}

function GalleryList({ chatId, kind }: { chatId: ID; kind: GalleryKind }) {
  const { items, done, loading, error, more } = useMediaPages(chatId, kind);
  const [open, setOpen] = useState<Message | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || done) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) more();
    });
    io.observe(el);
    return () => io.disconnect();
  });

  if (!items.length && loading)
    return (
      <div className="flex justify-center p-10 text-brand-ink">
        <Spinner />
      </div>
    );
  if (!items.length && error)
    return <EmptyState compact icon={ImageOff} title="Couldn't load" description={error} />;
  if (!items.length)
    return (
      <EmptyState
        compact
        icon={kind === 'media' ? ImageOff : kind === 'links' ? Link2 : FileText}
        title={kind === 'media' ? 'No media' : kind === 'links' ? 'No links' : 'No documents'}
        description={
          kind === 'media'
            ? 'Photos and videos shared in this chat appear here.'
            : kind === 'links'
              ? 'Links shared in this chat appear here.'
              : 'Documents shared in this chat appear here.'
        }
      />
    );

  return (
    <>
      {kind === 'media' ? (
        <ul className="grid grid-cols-3 gap-1 p-1 sm:grid-cols-4">
          {items.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                onClick={() => setOpen(m)}
                className="relative block aspect-square w-full overflow-hidden rounded-md bg-surface-2 outline-none focus-visible:outline-2 focus-visible:outline-brand"
                aria-label={m.type === 'video' ? 'Open video' : 'Open photo'}
              >
                <Thumb m={m} />
              </button>
            </li>
          ))}
        </ul>
      ) : kind === 'links' ? (
        <ul className="divide-y divide-line">
          {items.flatMap((m) =>
            extractLinks(m.text).map((url) => {
              const href = hrefOf(url);
              return (
                <li key={`${m.id}-${url}`}>
                  <a
                    href={href ?? undefined}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 px-4 py-3 hover:bg-hover"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                      <Link2 size={20} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium text-fg">
                        {hostOf(url)}
                      </span>
                      <span className="block truncate text-[13px] text-brand-ink">{url}</span>
                    </span>
                    <span className="shrink-0 text-xs text-subtle">
                      {formatChatListTime(m.createdAt)}
                    </span>
                  </a>
                </li>
              );
            }),
          )}
        </ul>
      ) : (
        <ul className="divide-y divide-line">
          {items.map((m) => (
            <li key={m.id}>
              <a
                href={mediaUrl(m.media?.url)}
                target="_blank"
                rel="noopener noreferrer"
                download={m.media?.fileName ?? undefined}
                className="flex items-center gap-3 px-4 py-3 hover:bg-hover"
              >
                <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                  <FileText size={20} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-medium text-fg">
                    {m.media?.fileName ?? 'Document'}
                  </span>
                  <span className="block truncate text-[13px] text-muted">
                    {m.media ? formatBytes(m.media.size) : ''} · {formatChatListTime(m.createdAt)}
                  </span>
                </span>
                <Download size={18} className="shrink-0 text-subtle" aria-hidden />
              </a>
            </li>
          ))}
        </ul>
      )}
      {!done ? (
        <div ref={sentinel} className="flex justify-center py-4 text-brand-ink">
          {loading ? <Spinner size={18} /> : null}
        </div>
      ) : null}
      <Lightbox message={open} onClose={() => setOpen(null)} />
    </>
  );
}

/** Minimal full-screen viewer for a photo/video. */
export function Lightbox({ message, onClose }: { message: Message | null; onClose: () => void }) {
  useOverlay(!!message, onClose);
  if (!message?.media) return null;
  const src = mediaUrl(message.media.url);
  const caption = message.text ? renderMentions(message.text, (id) => nameOf(id)) : '';
  return (
    <Portal>
      <div
        className="fixed inset-0 z-[70] flex animate-fade-in items-center justify-center bg-black/90 p-4"
        role="dialog"
        aria-modal="true"
        aria-label={message.type === 'video' ? 'Video' : 'Photo'}
        onMouseDown={(e) => e.target === e.currentTarget && onClose()}
      >
        <IconButton
          icon={X}
          label="Close"
          variant="glass"
          onClick={onClose}
          className="absolute top-[max(12px,env(safe-area-inset-top))] right-3"
        />
        {message.type === 'video' ? (
          <video src={src} controls autoPlay className="max-h-full max-w-full rounded-lg" />
        ) : (
          <img
            src={src}
            alt={caption}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        )}
        {caption ? (
          <p className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-6 pt-10 pb-[max(20px,env(safe-area-inset-bottom))] text-center text-[15px] text-white">
            {caption}
          </p>
        ) : null}
      </div>
    </Portal>
  );
}
