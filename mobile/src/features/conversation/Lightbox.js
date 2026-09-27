/**
 * Full-screen media viewer (web Lightbox.tsx): photos (pinch / double-tap to zoom, drag to
 * pan) and videos (native controls), swipe through the chat's photos & videos, save to
 * gallery, forward, "show in chat"; back closes.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, View, useWindowDimensions } from 'react-native';
import { Image } from 'expo-image';
import { VideoView, useVideoPlayer } from 'expo-video';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import ReAnimated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ArrowDownToLine, Forward, MessageSquareText, X } from 'lucide-react-native';
import { renderMentions } from '@enbox/shared';
import { IconButton, Portal, T, useBackHandler } from '@/components/ui';
import { mentionName } from '@/features/chats/preview';
import { api, mediaUrl } from '@/lib/api';
import { saveToGallery } from '@/lib/files';
import { formatRelativeShort } from '@/lib/format';
import { useMessages } from '@/stores/messages';
import { useUserName } from '@/stores/users';
import { useTheme } from '@/theme';
import { canForward } from './actions';
import { useConversationUi } from './state';

function isVisual(m) {
  return (m.type === 'image' || m.type === 'video') && !!m.media && !m.deletedAt;
}

function ZoomableImage({ uri, width, height }) {
  const scale = useSharedValue(1);
  const saved = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const sx = useSharedValue(0);
  const sy = useSharedValue(0);
  const pinch = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.max(1, Math.min(5, saved.value * e.scale));
    })
    .onEnd(() => {
      saved.value = scale.value;
      if (scale.value <= 1.01) {
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      }
    })
    .runOnJS(false);
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onStart(() => {
      sx.value = tx.value;
      sy.value = ty.value;
    })
    .onUpdate((e) => {
      if (scale.value <= 1) return;
      tx.value = sx.value + e.translationX;
      ty.value = sy.value + e.translationY;
    });
  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      if (scale.value > 1) {
        scale.value = withTiming(1);
        saved.value = 1;
        tx.value = withTiming(0);
        ty.value = withTiming(0);
      } else {
        scale.value = withTiming(2.5);
        saved.value = 2.5;
        tx.value = withTiming((width / 2 - e.x) * 1.5);
        ty.value = withTiming((height / 2 - e.y) * 1.5);
      }
    });
  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: scale.value }],
  }));
  return (
    <GestureDetector gesture={Gesture.Simultaneous(pinch, Gesture.Exclusive(doubleTap, pan))}>
      <ReAnimated.View style={[{ width, height }, style]}>
        <Image source={{ uri }} style={{ width, height }} contentFit="contain" />
      </ReAnimated.View>
    </GestureDetector>
  );
}

function VideoPage({ uri, width, height, active }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
  });
  useEffect(() => {
    if (!active) player.pause();
  }, [active, player]);
  return (
    <VideoView
      player={player}
      style={{ width, height }}
      contentFit="contain"
      nativeControls
      allowsFullscreen
    />
  );
}

export function Lightbox({ chatId }) {
  const viewer = useConversationUi((s) => (s.viewer?.chatId === chatId ? s.viewer : null));
  if (!viewer) return null;
  return (
    <LightboxInner key={viewer.messageId} chatId={viewer.chatId} messageId={viewer.messageId} />
  );
}

function LightboxInner({ chatId, messageId }) {
  const { tw } = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const loaded = useMessages((s) => s.byChat[chatId]?.items);
  const [fetched, setFetched] = useState([]);
  const [current, setCurrent] = useState(messageId);
  const [chrome] = useState(true);
  const list = useRef(null);
  const close = useCallback(() => useConversationUi.getState().openViewer(null), []);
  useBackHandler(() => {
    close();
    return true;
  });

  useEffect(() => {
    api
      .get(`/api/chats/${chatId}/media`, { query: { kind: 'media', limit: 60 } })
      .then((items) => setFetched(items))
      .catch(() => undefined);
  }, [chatId]);

  const gallery = useMemo(() => {
    const map = new Map();
    for (const m of fetched) if (isVisual(m)) map.set(m.id, m);
    for (const m of loaded ?? []) if (isVisual(m)) map.set(m.id, { ...map.get(m.id), ...m });
    return [...map.values()].sort(
      (a, b) => (a.seq || Number.MAX_SAFE_INTEGER) - (b.seq || Number.MAX_SAFE_INTEGER),
    );
  }, [fetched, loaded]);
  const index = Math.max(
    0,
    gallery.findIndex((m) => m.id === current),
  );
  const m = gallery[index];
  const sender = useUserName(m?.senderId, { you: 'You' });

  if (!m) return null;
  return (
    <Portal>
      <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
        <FlatList
          ref={list}
          data={gallery}
          horizontal
          pagingEnabled
          initialScrollIndex={index}
          getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
          keyExtractor={(x) => x.id}
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={(e) => {
            const i = Math.round(e.nativeEvent.contentOffset.x / width);
            if (gallery[i]) setCurrent(gallery[i].id);
          }}
          renderItem={({ item }) => (
            <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
              {item.type === 'video' ? (
                <VideoPage
                  uri={mediaUrl(item.localUrl ?? item.media.url)}
                  width={width}
                  height={height * 0.8}
                  active={item.id === m.id}
                />
              ) : (
                <ZoomableImage
                  uri={mediaUrl(item.localUrl ?? item.media.url)}
                  width={width}
                  height={height}
                />
              )}
            </View>
          )}
        />
        {chrome ? (
          <>
            <View
              style={[
                tw`absolute inset-x-0 top-0 flex-row items-center gap-2 bg-black/40 px-2 pb-2`,
                { paddingTop: insets.top + 8 },
              ]}
            >
              <IconButton icon={X} label="Close" variant="glass" onPress={close} />
              <View style={tw`min-w-0 flex-1`}>
                <T numberOfLines={1} style={tw`text-[15px] font-semibold text-white`}>
                  {m.senderId ? sender : 'Channel'}
                </T>
                <T style={tw`text-[12px] text-white/70`}>{formatRelativeShort(m.createdAt)}</T>
              </View>
              <IconButton
                icon={ArrowDownToLine}
                label="Save"
                variant="glass"
                onPress={() =>
                  void saveToGallery(
                    mediaUrl(m.media.url),
                    m.media.fileName ?? `${m.type}-${m.id.slice(0, 8)}`,
                  )
                }
              />
              {canForward(m) ? (
                <IconButton
                  icon={Forward}
                  label="Forward"
                  variant="glass"
                  onPress={() => {
                    close();
                    useConversationUi.getState().openForward([m]);
                  }}
                />
              ) : null}
              <IconButton
                icon={MessageSquareText}
                label="Show in chat"
                variant="glass"
                onPress={() => {
                  close();
                  useConversationUi.getState().requestJump(chatId, m.seq, m.id);
                }}
              />
            </View>
            {m.text ? (
              <View
                style={[
                  tw`absolute inset-x-0 bottom-0 bg-black/45 px-4 pt-3`,
                  { paddingBottom: insets.bottom + 12 },
                ]}
              >
                <T numberOfLines={4} style={tw`text-center text-[15px] text-white`}>
                  {renderMentions(m.text, mentionName)}
                </T>
              </View>
            ) : null}
          </>
        ) : null}
      </View>
    </Portal>
  );
}
