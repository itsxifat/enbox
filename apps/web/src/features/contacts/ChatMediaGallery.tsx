/**
 * Shared media of a chat (GET /api/chats/:chatId/media), used inside the contact info panel:
 * tabs Media / Docs / Links with "load more" paging (`before` = oldest seq of the page).
 */
import { useCallback, useEffect, useState } from 'react';
import { FileText, Film, Image as ImageIcon, Link2, Play } from 'lucide-react';
import { formatBytes, formatDuration, type ID, type Message } from '@enbox/shared';
import { Button, EmptyState, Spinner, Tabs } from '@/components/ui';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { formatShortDate } from '@/lib/format';
import { PhotoViewer } from './PhotoViewer';

export type MediaTab = 'media' | 'docs' | 'links';
export const MEDIA_PAGE = 60;

export interface MediaPage {
  items: Message[];
  done: boolean;
}

export function fetchChatMedia(
  chatId: ID,
  kind: MediaTab,
  before?: number,
  limit = MEDIA_PAGE,
): Promise<Message[]> {
  return api.get<Message[]>(`/api/chats/${chatId}/media`, { query: { kind, before, limit } });
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>"'`]+[^\s<>"'`.,;:!?)\]]/gi;

/** URLs found in a message's text (http(s) and www.), normalised to absolute URLs. */
export function extractLinks(text: string | null | undefined): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(URL_RE)) {
    const raw = m[0];
    const url = raw.startsWith('www.') ? `https://${raw}` : raw;
    if (!out.includes(url)) out.push(url);
  }
  return out;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** Grid thumbnail for an image/video message. */
export function MediaThumb({ m, onOpen }: { m: Message; onOpen: (m: Message) => void }) {
  const media = m.media;
  if (!media) return null;
  const src = mediaUrl(media.thumbnailUrl ?? (media.kind === 'image' ? media.url : null));
  return (
    <button
      type="button"
      onClick={() => onOpen(m)}
      className="group relative aspect-square overflow-hidden rounded-lg bg-surface-2 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      aria-label={media.kind === 'video' ? 'Open video' : 'Open photo'}
    >
      {src ? (
        <img
          src={src}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
        />
      ) : (
        <span className="flex size-full items-center justify-center text-subtle">
          {media.kind === 'video' ? (
            <Film size={24} aria-hidden />
          ) : (
            <ImageIcon size={24} aria-hidden />
          )}
        </span>
      )}
      {media.kind === 'video' ? (
        <span className="absolute inset-x-0 bottom-0 flex items-center gap-1 bg-gradient-to-t from-black/60 to-transparent px-1.5 pt-4 pb-1 text-[11px] font-medium text-white">
          <Play size={12} fill="currentColor" aria-hidden />
          {media.durationMs ? formatDuration(media.durationMs) : null}
        </span>
      ) : null}
    </button>
  );
}

/** Lightbox for a media message (photo viewer, or a video player). */
export function MediaLightbox({ m, onClose }: { m: Message | null; onClose: () => void }) {
  const media = m?.media;
  if (media?.kind === 'video') {
    return (
      <PhotoViewer
        open
        onClose={onClose}
        src={media.url}
        title={media.fileName ?? 'Video'}
        subtitle={m ? formatShortDate(m.createdAt) : undefined}
        video
      />
    );
  }
  return (
    <PhotoViewer
      open={!!media}
      onClose={onClose}
      src={media?.url}
      title={media?.fileName ?? 'Photo'}
      subtitle={m ? formatShortDate(m.createdAt) : undefined}
    />
  );
}

export function ChatMediaGallery({
  chatId,
  initialTab = 'media',
}: {
  chatId: ID;
  initialTab?: MediaTab;
}) {
  const [tab, setTab] = useState<MediaTab>(initialTab);
  const [pages, setPages] = useState<Partial<Record<MediaTab, MediaPage>>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Message | null>(null);

  const load = useCallback(
    async (kind: MediaTab, more: boolean) => {
      setLoading(true);
      setError(null);
      try {
        const current = more ? pages[kind] : undefined;
        const before = current?.items.length
          ? current.items[current.items.length - 1]!.seq
          : undefined;
        const items = await fetchChatMedia(chatId, kind, before);
        setPages((p) => ({
          ...p,
          [kind]: {
            items: [...(more ? (p[kind]?.items ?? []) : []), ...items],
            done: items.length < MEDIA_PAGE,
          },
        }));
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoading(false);
      }
    },
    [chatId, pages],
  );

  useEffect(() => {
    if (!pages[tab]) void load(tab, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load once per tab
  }, [tab]);

  const page = pages[tab];

  return (
    <div className="flex min-h-full flex-col">
      <Tabs<MediaTab>
        aria-label="Shared content"
        value={tab}
        onChange={setTab}
        idBase="chat-media"
        className="sticky top-0 z-[1] bg-surface"
        items={[
          { value: 'media', label: 'Media' },
          { value: 'docs', label: 'Docs' },
          { value: 'links', label: 'Links' },
        ]}
      />
      <div
        role="tabpanel"
        id={`chat-media-panel-${tab}`}
        aria-labelledby={`chat-media-tab-${tab}`}
        className="flex-1"
      >
        {!page ? (
          error ? (
            <EmptyState compact title="Couldn't load" description={error} />
          ) : (
            <div className="flex justify-center py-10 text-brand-ink">
              <Spinner />
            </div>
          )
        ) : page.items.length === 0 ? (
          <EmptyState
            compact
            icon={tab === 'media' ? ImageIcon : tab === 'docs' ? FileText : Link2}
            title={tab === 'media' ? 'No media' : tab === 'docs' ? 'No documents' : 'No links'}
            description={
              tab === 'media'
                ? 'Photos and videos you share in this chat appear here.'
                : tab === 'docs'
                  ? 'Documents and audio files you share appear here.'
                  : 'Links you share in this chat appear here.'
            }
          />
        ) : tab === 'media' ? (
          <div className="grid grid-cols-3 gap-1 p-2">
            {page.items.map((m) => (
              <MediaThumb key={m.id} m={m} onOpen={setViewing} />
            ))}
          </div>
        ) : tab === 'docs' ? (
          <ul className="flex flex-col py-1">
            {page.items.map((m) =>
              m.media ? (
                <li key={m.id}>
                  <a
                    href={mediaUrl(m.media.url)}
                    download={m.media.fileName ?? true}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-3 px-4 py-2.5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-ink">
                      <FileText size={20} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] text-fg">
                        {m.media.fileName ?? 'Document'}
                      </span>
                      <span className="text-[12.5px] text-muted">
                        {formatBytes(m.media.size)} · {formatShortDate(m.createdAt)}
                      </span>
                    </span>
                  </a>
                </li>
              ) : null,
            )}
          </ul>
        ) : (
          <ul className="flex flex-col py-1">
            {page.items.flatMap((m) =>
              extractLinks(m.text).map((url) => (
                <li key={`${m.id}:${url}`}>
                  <a
                    href={url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center gap-3 px-4 py-2.5 outline-none hover:bg-hover focus-visible:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
                  >
                    <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-surface-2 text-muted">
                      <Link2 size={20} aria-hidden />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate text-[15px] text-fg">{hostOf(url)}</span>
                      <span className="truncate text-[12.5px] text-brand-ink">{url}</span>
                    </span>
                  </a>
                </li>
              )),
            )}
          </ul>
        )}
        {page && !page.done ? (
          <div className="flex justify-center py-3">
            <Button variant="soft" size="sm" loading={loading} onClick={() => void load(tab, true)}>
              Load more
            </Button>
          </div>
        ) : null}
      </div>
      <MediaLightbox m={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}
