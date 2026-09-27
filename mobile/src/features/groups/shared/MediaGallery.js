/**
 * Shared media of a chat (web features/groups/shared/MediaGallery.tsx):
 * `GET /api/chats/:id/media?kind=` — photos & videos grid, links, docs; paged with `before`.
 * Also the compact preview strip for info panels, the linkified description text and a
 * minimal full-screen viewer.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Linking, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Download, FileText, ImageOff, Link2, Play, X } from 'lucide-react-native';
import { formatBytes, formatDuration, renderMentions } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { PaneHeader } from '@/components/layout/PaneHeader';
import {
  EmptyState,
  Gradient,
  IconButton,
  Portal,
  Press,
  Spinner,
  T,
  Tabs,
  useBackHandler,
} from '@/components/ui';
import { api, errorMessage, mediaUrl } from '@/lib/api';
import { openFile } from '@/lib/files';
import { formatChatListTime } from '@/lib/format';
import { nameOf } from '@/stores/users';
import { useTheme } from '@/theme';
import { extractLinks, hostOf, hrefOf, linkify } from './links';

const PAGE = 60;

function useMediaPages(chatId, kind, limit = PAGE) {
  const [items, setItems] = useState([]);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const busy = useRef(false);

  const load = useCallback(
    async (before) => {
      if (busy.current) return;
      busy.current = true;
      setLoading(true);
      try {
        const page = await api.get(`/api/chats/${chatId}/media`, {
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

/** Plain text with tappable links (descriptions). */
export function RichText({ text, style }) {
  const { tw } = useTheme();
  return (
    <T style={style}>
      {linkify(text).map((part, i) =>
        part.type === 'link' ? (
          <T
            key={i}
            style={tw`text-brand-ink`}
            onPress={() => void Linking.openURL(part.href).catch(() => undefined)}
            suppressHighlighting
          >
            {part.text}
          </T>
        ) : (
          <T key={i}>{part.text}</T>
        ),
      )}
    </T>
  );
}

function Thumb({ m, size }) {
  const { c } = useTheme();
  const src = mediaUrl(m.media?.thumbnailUrl ?? (m.type === 'image' ? m.media?.url : null));
  return (
    <>
      {src ? (
        <Image source={{ uri: src }} style={{ width: size, height: size }} contentFit="cover" />
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <Icon icon={m.type === 'video' ? Play : ImageOff} size={22} color={c.subtle} />
        </View>
      )}
      {m.type === 'video' ? (
        <Gradient
          direction="up"
          stops={[
            [0, '#000000', 0.6],
            [1, '#000000', 0],
          ]}
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            paddingHorizontal: 6,
            paddingTop: 12,
            paddingBottom: 4,
          }}
        >
          <Icon icon={Play} size={12} color="#fff" />
          <T style={{ fontSize: 11, fontWeight: '500', color: '#fff' }}>
            {m.media?.durationMs ? formatDuration(m.media.durationMs) : ''}
          </T>
        </Gradient>
      ) : null}
    </>
  );
}

/** Up to 4 recent photo/video thumbnails for the info panel row. */
export function MediaPreviewStrip({ chatId, onOpen }) {
  const { tw } = useTheme();
  const { width } = useWindowDimensions();
  const { items } = useMediaPages(chatId, 'media', 4);
  if (!items.length) return null;
  const size = Math.floor((Math.min(width, 640) - 24 - 40 - 18) / 4);
  return (
    <View style={tw`flex-row gap-1.5 px-5 pb-3`}>
      {items.slice(0, 4).map((m) => (
        <Press
          key={m.id}
          onPress={onOpen}
          accessibilityLabel="Open media"
          style={[tw`overflow-hidden rounded-xl bg-surface-2`, { width: size, height: size }]}
        >
          <Thumb m={m} size={size} />
        </Press>
      ))}
    </View>
  );
}

export function MediaGalleryView({ chatId, title, initial = 'media', onBack }) {
  const { tw } = useTheme();
  const [tab, setTab] = useState(initial);
  return (
    <View style={tw`flex-1 bg-surface`}>
      <PaneHeader title={title} back={onBack}>
        <Tabs
          value={tab}
          onChange={setTab}
          items={[
            { value: 'media', label: 'Media' },
            { value: 'links', label: 'Links' },
            { value: 'docs', label: 'Docs' },
          ]}
          style={tw`-mx-3 -mb-2`}
        />
      </PaneHeader>
      <GalleryList key={tab} chatId={chatId} kind={tab} />
    </View>
  );
}

function GalleryList({ chatId, kind }) {
  const { tw, c } = useTheme();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { items, done, loading, error, more } = useMediaPages(chatId, kind);
  const [open, setOpen] = useState(null);

  if (!items.length && loading)
    return (
      <View style={tw`items-center p-10`}>
        <Spinner />
      </View>
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

  const footer = !done ? (
    <View style={tw`items-center py-4`}>{loading ? <Spinner size={18} /> : null}</View>
  ) : (
    <View style={{ height: insets.bottom }} />
  );

  if (kind === 'media') {
    const cols = width >= 640 ? 4 : 3;
    const size = Math.floor((width - 8 - (cols - 1) * 4) / cols);
    return (
      <>
        <FlatList
          data={items}
          key={cols}
          numColumns={cols}
          keyExtractor={(m) => m.id}
          contentContainerStyle={tw`p-1`}
          columnWrapperStyle={{ gap: 4 }}
          ItemSeparatorComponent={() => <View style={{ height: 4 }} />}
          onEndReached={more}
          onEndReachedThreshold={0.5}
          ListFooterComponent={footer}
          renderItem={({ item: m }) => (
            <Press
              onPress={() => setOpen(m)}
              accessibilityLabel={m.type === 'video' ? 'Open video' : 'Open photo'}
              style={[tw`overflow-hidden rounded-md bg-surface-2`, { width: size, height: size }]}
            >
              <Thumb m={m} size={size} />
            </Press>
          )}
        />
        <MediaViewer message={open} onClose={() => setOpen(null)} />
      </>
    );
  }

  if (kind === 'links') {
    const rows = items.flatMap((m) => extractLinks(m.text).map((url) => ({ m, url })));
    return (
      <FlatList
        data={rows}
        keyExtractor={(r) => `${r.m.id}-${r.url}`}
        onEndReached={more}
        onEndReachedThreshold={0.5}
        ListFooterComponent={footer}
        ItemSeparatorComponent={() => <View style={tw`h-px bg-line`} />}
        renderItem={({ item: { m, url } }) => {
          const href = hrefOf(url);
          return (
            <Press
              onPress={() => href && void Linking.openURL(href).catch(() => undefined)}
              style={tw`flex-row items-center gap-3 px-4 py-3`}
            >
              <View style={tw`size-11 items-center justify-center rounded-xl bg-brand-soft`}>
                <Icon icon={Link2} size={20} color={c['brand-ink']} />
              </View>
              <View style={tw`min-w-0 flex-1`}>
                <T numberOfLines={1} style={tw`text-[15px] font-medium`}>
                  {hostOf(url)}
                </T>
                <T numberOfLines={1} style={tw`text-[13px] text-brand-ink`}>
                  {url}
                </T>
              </View>
              <T style={tw`text-xs text-subtle`}>{formatChatListTime(m.createdAt)}</T>
            </Press>
          );
        }}
      />
    );
  }

  return (
    <FlatList
      data={items}
      keyExtractor={(m) => m.id}
      onEndReached={more}
      onEndReachedThreshold={0.5}
      ListFooterComponent={footer}
      ItemSeparatorComponent={() => <View style={tw`h-px bg-line`} />}
      renderItem={({ item: m }) => (
        <Press
          onPress={() =>
            m.media &&
            void openFile(mediaUrl(m.media.url), m.media.fileName ?? 'document', m.media.mimeType)
          }
          style={tw`flex-row items-center gap-3 px-4 py-3`}
        >
          <View style={tw`size-11 items-center justify-center rounded-xl bg-surface-2`}>
            <Icon icon={FileText} size={20} color={c.muted} />
          </View>
          <View style={tw`min-w-0 flex-1`}>
            <T numberOfLines={1} style={tw`text-[15px] font-medium`}>
              {m.media?.fileName ?? 'Document'}
            </T>
            <T numberOfLines={1} style={tw`text-[13px] text-muted`}>
              {m.media ? formatBytes(m.media.size) : ''} · {formatChatListTime(m.createdAt)}
            </T>
          </View>
          <Icon icon={Download} size={18} color={c.subtle} />
        </Press>
      )}
    />
  );
}

function ViewerVideo({ uri }) {
  const player = useVideoPlayer(uri, (p) => p.play());
  return (
    <VideoView
      player={player}
      style={{ width: '100%', height: '80%' }}
      contentFit="contain"
      nativeControls
    />
  );
}

/** Minimal full-screen viewer for a photo/video. */
export function MediaViewer({ message, onClose }) {
  const insets = useSafeAreaInsets();
  useBackHandler(() => {
    onClose();
    return true;
  }, !!message);
  if (!message?.media) return null;
  const src = mediaUrl(message.media.url);
  const caption = message.text ? renderMentions(message.text, (id) => nameOf(id)) : '';
  return (
    <Portal>
      <View
        style={[
          StyleSheet.absoluteFill,
          { backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
        ]}
      >
        {message.type === 'video' ? (
          <ViewerVideo uri={src} />
        ) : (
          <Image
            source={{ uri: src }}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
          />
        )}
        <IconButton
          icon={X}
          label="Close"
          variant="glass"
          onPress={onClose}
          style={{ position: 'absolute', top: Math.max(12, insets.top + 8), right: 12 }}
        />
        {caption ? (
          <Gradient
            direction="up"
            stops={[
              [0, '#000000', 0.7],
              [1, '#000000', 0],
            ]}
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: 24,
              paddingTop: 40,
              paddingBottom: Math.max(20, insets.bottom),
            }}
          >
            <T style={{ textAlign: 'center', fontSize: 15, color: '#fff' }}>{caption}</T>
          </Gradient>
        ) : null}
      </View>
    </Portal>
  );
}
