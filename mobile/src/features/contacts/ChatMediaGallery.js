/**
 * Shared media of a direct chat (web features/contacts/ChatMediaGallery.tsx):
 * `GET /api/chats/:chatId/media`, tabs Media / Docs / Links with "Load more" paging
 * (`before` = oldest seq of the page). Also the grid thumbnail and the lightbox.
 */
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { FileText, Film, Image as ImageIcon, Link2, Play } from 'lucide-react-native';
import { formatBytes, formatDuration } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Button, EmptyState, Gradient, Press, Spinner, T, Tabs } from '@/components/ui';
import { MediaViewer } from '@/features/groups/shared/MediaGallery';
import { extractLinks, hostOf, hrefOf } from '@/features/groups/shared/links';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { openFile } from '@/lib/files';
import { formatShortDate } from '@/lib/format';
import { openUrl } from '@/lib/links';
import { useTheme } from '@/theme';
import { PhotoViewer } from './PhotoViewer';

export const MEDIA_PAGE = 60;

export function fetchChatMedia(chatId, kind, before, limit = MEDIA_PAGE) {
  return api.get(`/api/chats/${chatId}/media`, { query: { kind, before, limit } });
}

/** Square grid thumbnail for an image/video message (`size` in px). */
export function MediaThumb({ m, size, onOpen }) {
  const { tw, c } = useTheme();
  const media = m.media;
  if (!media) return null;
  const src = mediaUrl(media.thumbnailUrl ?? (media.kind === 'image' ? media.url : null));
  return (
    <Press
      onPress={() => onOpen(m)}
      accessibilityLabel={media.kind === 'video' ? 'Open video' : 'Open photo'}
      style={[tw`overflow-hidden rounded-lg bg-surface-2`, { width: size, height: size }]}
    >
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <View style={tw`flex-1 items-center justify-center`}>
          <Icon icon={media.kind === 'video' ? Film : ImageIcon} size={24} color={c.subtle} />
        </View>
      )}
      {media.kind === 'video' ? (
        <Gradient
          direction="up"
          stops={[
            [0, '#000000', 0.6],
            [1, '#000000', 0],
          ]}
          style={tw`absolute inset-x-0 bottom-0 flex-row items-center gap-1 px-1.5 pt-4 pb-1`}
        >
          <Play size={12} color="#fff" fill="#fff" strokeWidth={1.5} />
          <T style={{ fontSize: 11, fontWeight: '500', color: '#fff' }}>
            {media.durationMs ? formatDuration(media.durationMs) : ''}
          </T>
        </Gradient>
      ) : null}
    </Press>
  );
}

/** Lightbox for a media message: the photo viewer, or a video player. */
export function MediaLightbox({ m, onClose }) {
  const media = m?.media;
  if (media?.kind === 'video') return <MediaViewer message={m} onClose={onClose} />;
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

export function ChatMediaGallery({ chatId, initialTab = 'media' }) {
  const { tw, c } = useTheme();
  const { width } = useWindowDimensions();
  const [tab, setTab] = useState(initialTab);
  const [pages, setPages] = useState({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewing, setViewing] = useState(null);

  const load = useCallback(
    async (kind, more) => {
      setLoading(true);
      setError(null);
      try {
        const current = more ? pages[kind] : undefined;
        const before = current?.items.length
          ? current.items[current.items.length - 1].seq
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
  const size = Math.floor((Math.min(width, 640) - 16 - 8) / 3);

  return (
    <View style={tw`min-h-0 flex-1`}>
      <Tabs
        value={tab}
        onChange={setTab}
        items={[
          { value: 'media', label: 'Media' },
          { value: 'docs', label: 'Docs' },
          { value: 'links', label: 'Links' },
        ]}
        style={tw`bg-surface`}
      />
      <ScrollView style={tw`min-h-0 flex-1`} contentContainerStyle={tw`pb-6`}>
        {!page ? (
          error ? (
            <EmptyState compact title="Couldn't load" description={error} />
          ) : (
            <View style={tw`items-center py-10`}>
              <Spinner />
            </View>
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
          <View style={tw`flex-row flex-wrap gap-1 p-2`}>
            {page.items.map((m) => (
              <MediaThumb key={m.id} m={m} size={size} onOpen={setViewing} />
            ))}
          </View>
        ) : tab === 'docs' ? (
          <View style={tw`py-1`}>
            {page.items.map((m) =>
              m.media ? (
                <Press
                  key={m.id}
                  onPress={() =>
                    void openFile(
                      mediaUrl(m.media.url),
                      m.media.fileName ?? 'document',
                      m.media.mimeType,
                    )
                  }
                  style={tw`flex-row items-center gap-3 px-4 py-2.5`}
                >
                  <View style={tw`size-11 items-center justify-center rounded-xl bg-brand-soft`}>
                    <Icon icon={FileText} size={20} color={c['brand-ink']} />
                  </View>
                  <View style={tw`min-w-0 flex-1`}>
                    <T numberOfLines={1} style={tw`text-[15px]`}>
                      {m.media.fileName ?? 'Document'}
                    </T>
                    <T style={tw`text-[12.5px] text-muted`}>
                      {formatBytes(m.media.size)} · {formatShortDate(m.createdAt)}
                    </T>
                  </View>
                </Press>
              ) : null,
            )}
          </View>
        ) : (
          <View style={tw`py-1`}>
            {page.items.flatMap((m) =>
              extractLinks(m.text).map((url) => (
                <Press
                  key={`${m.id}:${url}`}
                  onPress={() => {
                    const href = hrefOf(url);
                    if (href) openUrl(href);
                  }}
                  style={tw`flex-row items-center gap-3 px-4 py-2.5`}
                >
                  <View style={tw`size-11 items-center justify-center rounded-xl bg-surface-2`}>
                    <Icon icon={Link2} size={20} color={c.muted} />
                  </View>
                  <View style={tw`min-w-0 flex-1`}>
                    <T numberOfLines={1} style={tw`text-[15px]`}>
                      {hostOf(url)}
                    </T>
                    <T numberOfLines={1} style={tw`text-[12.5px] text-brand-ink`}>
                      {url}
                    </T>
                  </View>
                </Press>
              )),
            )}
          </View>
        )}
        {page && !page.done ? (
          <View style={tw`items-center py-3`}>
            <Button variant="soft" size="sm" loading={loading} onPress={() => void load(tab, true)}>
              Load more
            </Button>
          </View>
        ) : null}
      </ScrollView>
      <MediaLightbox m={viewing} onClose={() => setViewing(null)} />
    </View>
  );
}
