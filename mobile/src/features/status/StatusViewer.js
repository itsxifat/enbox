/**
 * Full-screen status viewer (web features/status/StatusViewer.tsx): segmented progress bars,
 * auto-advance (text/photo 5 s, video = its duration), tap left/right, hold to pause, swipe
 * to the next or previous person / down to close, marks statuses viewed, reply (a direct
 * message quoting the status) and quick reactions; for my own statuses: viewers and delete.
 */
import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  PanResponder,
  StyleSheet,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Image } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { VideoView, useVideoPlayer } from 'expo-video';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ArrowLeft,
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
} from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { UserAvatar } from '@/components/common/avatars';
import { Icon, SendIcon, UpdatesIcon } from '@/components/icons';
import {
  EmptyState,
  Gradient,
  ListItemSkeleton,
  Menu,
  Modal,
  Press,
  Spinner,
  T,
  confirm,
  measureAnchor,
  toast,
  useBackHandler,
} from '@/components/ui';
import { ensureDirectChat } from '@/features/calls/directChat';
import { mediaUrl } from '@/lib/api';
import { formatRelativeShort } from '@/lib/format';
import { useMe } from '@/stores/auth';
import { useMessages } from '@/stores/messages';
import { selfPublic, useStatus, useStatusLists } from '@/stores/status';
import { useTheme } from '@/theme';
import { firstUnviewedIndex, fontStyle, moveViewer, statusDuration, textStatusSize } from './logic';
import { StatusPrivacyDialog } from './StatusPrivacyDialog';

export const STATUS_REACTIONS = ['😍', '😂', '😮', '😢', '👏', '🙏', '🎉', '💯'];

export function StatusViewer() {
  const params = useLocalSearchParams();
  const userId = String(params.userId ?? '');
  const router = useRouter();
  const me = useMe();
  const feed = useStatus((s) => s.feed);
  const loaded = useStatus((s) => s.loaded);
  const lists = useStatusLists();
  const isMe = userId === me?.id;

  const [startId] = useState(() => (params.startId ? String(params.startId) : undefined));
  const [queue] = useState(() => {
    const q = params.queue ? String(params.queue).split(',').filter(Boolean) : [];
    if (q.length) return q;
    if (isMe) return [userId];
    const src = lists.recent.some((u) => u.user.id === userId) ? lists.recent : lists.viewed;
    const ids = src.map((u) => u.user.id);
    return ids.includes(userId) ? ids : [userId];
  });

  const close = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/updates');
  }, [router]);
  const openUser = useCallback(
    (index) => {
      const next = queue[index];
      if (!next) close();
      else
        router.replace({ pathname: `/updates/status/${next}`, params: { queue: queue.join(',') } });
    },
    [queue, router, close],
  );

  useBackHandler(() => {
    close();
    return true;
  }, true);

  useEffect(() => {
    if (!loaded)
      void useStatus
        .getState()
        .loadFeed()
        .catch(() => undefined);
  }, [loaded]);

  const item = !feed
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
    <View style={[StyleSheet.absoluteFill, { backgroundColor: '#000' }]}>
      {!item || !item.statuses.length ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          {loaded ? null : <Spinner size={28} color="#fff" />}
        </View>
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
    </View>
  );
}

// ---------------------------------------------------------------------------

/** Frame-driven progress of the current status (pauses keep the elapsed time). */
function useStoryTimer({ key, duration, running, progress, onDone }) {
  const elapsed = useRef(0);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    elapsed.current = 0;
    progress.setValue(0);
  }, [key, progress]);
  useEffect(() => {
    if (!running) return;
    let raf = 0;
    let last = Date.now();
    const tick = () => {
      const now = Date.now();
      elapsed.current += now - last;
      last = now;
      const p = Math.min(1, elapsed.current / duration);
      progress.setValue(p);
      if (p >= 1) {
        done.current();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [running, duration, key, progress]);
}

function StoryView({ item, isMe, startId, userIndex, queueLength, onClose, onUser }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const router = useRouter();
  const statuses = item.statuses;
  const [index, setIndex] = useState(() => {
    const at = startId ? statuses.findIndex((s) => s.id === startId) : -1;
    return at >= 0 ? at : isMe ? 0 : firstUnviewedIndex(statuses);
  });
  const idx = Math.min(index, statuses.length - 1);
  const status = statuses[idx];
  const [readyId, setReadyId] = useState(null);
  const ready = status.type === 'text' || readyId === status.id;
  const [held, setHeld] = useState(false);
  const [manualPause, setManualPause] = useState(false);
  const [replying, setReplying] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState(null);
  const menuOpen = !!menuAnchor;
  const [privacy, setPrivacy] = useState(false);
  const [muted, setMuted] = useState(false);
  const [bursts, setBursts] = useState([]);
  const progress = useRef(new Animated.Value(0)).current;
  const menuRef = useRef(null);
  const paused = held || manualPause || replying || sheet || menuOpen || privacy;
  const running = ready && !paused;
  const [restart, setRestart] = useState(0);

  const go = useCallback(
    (dir) => {
      const m = moveViewer(dir, { userIndex, index: idx, count: statuses.length, queueLength });
      if (m.kind === 'status') {
        if (m.index === idx) setRestart((n) => n + 1);
        setIndex(m.index);
      } else if (m.kind === 'user') onUser(m.direction);
      else onClose();
    },
    [idx, statuses.length, userIndex, queueLength, onUser, onClose],
  );
  const goRef = useRef(go);
  goRef.current = go;

  useEffect(() => {
    if (!isMe) useStatus.getState().markViewed(status.id);
  }, [status.id, isMe]);

  useStoryTimer({
    key: `${status.id}:${restart}`,
    duration: statusDuration(status),
    running: running && status.type !== 'video',
    progress,
    onDone: () => go(1),
  });

  // Tap zones, hold to pause, swipe between people / down to close.
  const gesture = useRef(null);
  const handlers = useRef({ onUser, onClose });
  handlers.current = { onUser, onClose };
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        const g = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY, held: false, timer: null };
        g.timer = setTimeout(() => {
          g.held = true;
          setHeld(true);
        }, 220);
        gesture.current = g;
      },
      onPanResponderRelease: (e, gs) => {
        const g = gesture.current;
        gesture.current = null;
        if (!g) return;
        if (g.timer) clearTimeout(g.timer);
        if (g.held) {
          setHeld(false);
          return;
        }
        const dx = gs.dx;
        const dy = gs.dy;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) {
          handlers.current.onUser(dx < 0 ? 1 : -1);
          return;
        }
        if (dy > 90 && Math.abs(dy) > Math.abs(dx)) {
          handlers.current.onClose();
          return;
        }
        if (Math.hypot(dx, dy) > 12) return;
        goRef.current(g.x < width * 0.3 ? -1 : 1);
      },
      onPanResponderTerminate: () => {
        const g = gesture.current;
        gesture.current = null;
        if (g?.timer) clearTimeout(g.timer);
        if (g?.held) setHeld(false);
      },
    }),
  ).current;

  const openChat = async () => {
    try {
      const chat = await ensureDirectChat(item.user.id);
      router.push(`/chats/${chat.id}`);
    } catch (e) {
      toast.error(e);
    }
  };

  const react = async (emoji) => {
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
  const chromeOpacity = held ? 0 : 1;

  return (
    <View
      style={{ flex: 1 }}
      accessibilityLabel={`${name}, update ${idx + 1} of ${statuses.length}, ${formatRelativeShort(status.createdAt)}`}
    >
      <View style={StyleSheet.absoluteFill} {...responder.panHandlers}>
        <StatusContent
          status={status}
          muted={muted}
          running={running}
          restart={restart}
          onReady={() => setReadyId(status.id)}
          onVideoProgress={(p) => progress.setValue(p)}
          onVideoEnded={() => go(1)}
        />
        {!ready ? (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}
          >
            <Spinner size={30} color="#fff" />
          </View>
        ) : null}
      </View>

      {/* Header */}
      <Gradient
        direction="down"
        stops={[
          [0, '#000000', 0.6],
          [0.5, '#000000', 0.25],
          [1, '#000000', 0],
        ]}
        pointerEvents="box-none"
        style={{
          opacity: chromeOpacity,
          paddingHorizontal: 10,
          paddingTop: Math.max(8, insets.top),
          paddingBottom: 24,
        }}
      >
        <View style={{ flexDirection: 'row', gap: 4 }} pointerEvents="none">
          {statuses.map((s, i) => (
            <View
              key={s.id}
              style={{
                flex: 1,
                height: 3,
                overflow: 'hidden',
                borderRadius: 2,
                backgroundColor: 'rgba(255,255,255,0.35)',
              }}
            >
              {i === idx ? (
                <Animated.View
                  style={{
                    height: 3,
                    backgroundColor: '#fff',
                    width: progress.interpolate({
                      inputRange: [0, 1],
                      outputRange: ['0%', '100%'],
                    }),
                  }}
                />
              ) : (
                <View
                  style={{ height: 3, backgroundColor: '#fff', width: i < idx ? '100%' : '0%' }}
                />
              )}
            </View>
          ))}
        </View>
        <View style={{ marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <HeaderButton
            icon={ArrowLeft}
            label="Close"
            onPress={onClose}
            style={{ marginLeft: -4 }}
          />
          <UserAvatar user={item.user} size="sm" />
          <View style={{ flex: 1, minWidth: 0 }}>
            <T
              numberOfLines={1}
              style={{ fontSize: 15, fontWeight: '600', color: '#fff', lineHeight: 19 }}
            >
              {name}
            </T>
            <T numberOfLines={1} style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.75)' }}>
              {formatRelativeShort(status.createdAt)}
            </T>
          </View>
          {status.type === 'video' ? (
            <HeaderButton
              icon={muted ? VolumeX : Volume2}
              label={muted ? 'Unmute' : 'Mute'}
              onPress={() => setMuted((m) => !m)}
            />
          ) : null}
          <HeaderButton
            icon={manualPause ? Play : Pause}
            label={manualPause ? 'Play' : 'Pause'}
            onPress={() => setManualPause((p) => !p)}
          />
          <HeaderButton
            ref={menuRef}
            icon={EllipsisVertical}
            label="Status menu"
            onPress={async () => {
              const a = await measureAnchor(menuRef);
              setMenuAnchor(a);
            }}
          />
        </View>
      </Gradient>
      <Menu
        open={menuOpen}
        anchor={menuAnchor}
        align="end"
        onClose={() => setMenuAnchor(null)}
        items={
          isMe
            ? [
                { label: 'Viewers', icon: Eye, onSelect: () => setSheet(true) },
                {
                  label: 'All my updates',
                  icon: UpdatesIcon,
                  onSelect: () => router.replace('/updates/status/mine'),
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

      <View style={{ flex: 1 }} pointerEvents="none" />

      {status.type !== 'text' && status.text ? (
        <View
          pointerEvents="none"
          style={{ opacity: chromeOpacity, paddingHorizontal: 20, paddingBottom: 12 }}
        >
          <T
            numberOfLines={5}
            style={{
              textAlign: 'center',
              fontSize: 15,
              color: '#fff',
              textShadowColor: 'rgba(0,0,0,0.8)',
              textShadowOffset: { width: 0, height: 1 },
              textShadowRadius: 2,
            }}
          >
            {status.text}
          </T>
        </View>
      ) : null}

      <View style={{ opacity: chromeOpacity }}>
        {isMe ? (
          <Gradient
            direction="up"
            stops={[
              [0, '#000000', 0.6],
              [1, '#000000', 0],
            ]}
            style={{
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingTop: 24,
              paddingBottom: Math.max(16, insets.bottom),
            }}
          >
            <Press
              onPress={() => setSheet(true)}
              pressedStyle={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
              style={{
                alignItems: 'center',
                gap: 2,
                borderRadius: 16,
                paddingHorizontal: 16,
                paddingVertical: 6,
              }}
            >
              <Icon icon={ChevronUp} size={18} color="#fff" />
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Icon icon={Eye} size={18} color="#fff" />
                <T style={{ fontSize: 14, fontWeight: '500', color: '#fff' }}>
                  {status.viewCount ?? 0} {status.viewCount === 1 ? 'view' : 'views'}
                </T>
              </View>
            </Press>
          </Gradient>
        ) : (
          <KeyboardStickyView offset={{ closed: 0, opened: insets.bottom }}>
            <ReplyBar
              status={status}
              author={item.user}
              focused={replying}
              onFocusChange={setReplying}
              onReact={(e) => void react(e)}
            />
          </KeyboardStickyView>
        )}
      </View>

      {bursts.map((b) => (
        <Burst key={b.id} emoji={b.emoji} />
      ))}

      {isMe ? <ViewersSheet open={sheet} status={status} onClose={() => setSheet(false)} /> : null}
      <StatusPrivacyDialog open={privacy} onClose={() => setPrivacy(false)} />
    </View>
  );
}

const HeaderButton = forwardRef(function HeaderButton({ icon, label, onPress, style }, ref) {
  return (
    <Press
      ref={ref}
      accessibilityLabel={label}
      onPress={onPress}
      pressedStyle={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
      style={[
        { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <Icon icon={icon} size={20} color="#fff" />
    </Press>
  );
});

/** The web's `status-float` keyframes: an emoji rising from the reply bar. */
function Burst({ emoji }) {
  const v = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(v, {
      toValue: 1,
      duration: 1500,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [v]);
  return (
    <Animated.Text
      pointerEvents="none"
      style={{
        position: 'absolute',
        bottom: 112,
        alignSelf: 'center',
        fontSize: 48,
        opacity: v.interpolate({ inputRange: [0, 0.15, 0.7, 1], outputRange: [0, 1, 1, 0] }),
        transform: [
          {
            translateY: v.interpolate({
              inputRange: [0, 0.15, 0.7, 1],
              outputRange: [20, 0, -120, -200],
            }),
          },
          {
            scale: v.interpolate({
              inputRange: [0, 0.15, 0.7, 1],
              outputRange: [0.6, 1.2, 1.4, 1.5],
            }),
          },
        ],
      }}
    >
      {emoji}
    </Animated.Text>
  );
}

async function deleteStatus(status) {
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

function VideoContent({ uri, muted, running, restart, onReady, onProgress, onEnded, onError }) {
  const player = useVideoPlayer(uri, (p) => {
    p.loop = false;
    p.timeUpdateEventInterval = 0.1;
  });
  const cb = useRef({ onReady, onProgress, onEnded, onError });
  cb.current = { onReady, onProgress, onEnded, onError };
  useEffect(() => {
    const subs = [
      player.addListener('statusChange', ({ status, error }) => {
        if (status === 'readyToPlay') cb.current.onReady();
        if (status === 'error' || error) cb.current.onError();
      }),
      player.addListener('timeUpdate', ({ currentTime }) => {
        const d = player.duration;
        if (d > 0) cb.current.onProgress(Math.min(1, currentTime / d));
      }),
      player.addListener('playToEnd', () => cb.current.onEnded()),
    ];
    if (player.status === 'readyToPlay') cb.current.onReady();
    return () => subs.forEach((s) => s.remove());
  }, [player]);
  useEffect(() => {
    player.muted = muted;
  }, [player, muted]);
  useEffect(() => {
    if (running) player.play();
    else player.pause();
  }, [player, running]);
  useEffect(() => {
    if (restart) player.currentTime = 0;
  }, [player, restart]);
  return (
    <VideoView
      player={player}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      nativeControls={false}
    />
  );
}

function StatusContent({
  status,
  muted,
  running,
  restart,
  onReady,
  onVideoProgress,
  onVideoEnded,
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [status.id]);

  if (status.type === 'text') {
    const size = textStatusSize(status.text ?? '');
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          paddingHorizontal: 32,
          paddingVertical: 96,
          backgroundColor: status.backgroundColor ?? '#6D5DFC',
        }}
      >
        <T
          style={[
            {
              color: '#fff',
              textAlign: 'center',
              fontSize: size,
              lineHeight: Math.round(size * 1.25),
            },
            fontStyle(status.font),
          ]}
        >
          {status.text}
        </T>
      </View>
    );
  }
  const src = mediaUrl(status.media?.url);
  if (failed || !src) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          paddingHorizontal: 32,
        }}
      >
        <T style={{ fontSize: 16, fontWeight: '600', color: '#fff' }}>This status can't be shown</T>
        <T style={{ fontSize: 14, color: 'rgba(255,255,255,0.7)' }}>
          The photo or video is unavailable.
        </T>
      </View>
    );
  }
  if (status.type === 'image') {
    return (
      <View style={{ flex: 1 }}>
        <Image
          source={{ uri: src }}
          style={[StyleSheet.absoluteFill, { opacity: 0.5, transform: [{ scale: 1.1 }] }]}
          contentFit="cover"
          blurRadius={24}
        />
        <Image
          source={{ uri: src }}
          style={StyleSheet.absoluteFill}
          contentFit="contain"
          accessibilityLabel={status.text ?? 'Photo status'}
          onLoad={onReady}
          onError={() => {
            setFailed(true);
            onReady();
          }}
        />
      </View>
    );
  }
  return (
    <VideoContent
      key={status.id}
      uri={src}
      muted={muted}
      running={running}
      restart={restart}
      onReady={onReady}
      onProgress={onVideoProgress}
      onEnded={onVideoEnded}
      onError={() => {
        setFailed(true);
        onReady();
      }}
    />
  );
}

function ReplyBar({ status, author, focused, onFocusChange, onReact }) {
  const { c } = useTheme();
  const insets = useSafeAreaInsets();
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const input = useRef(null);

  const send = async () => {
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
    <Gradient
      direction="up"
      stops={[
        [0, '#000000', 0.7],
        [0.5, '#000000', 0.4],
        [1, '#000000', 0],
      ]}
      style={{
        paddingHorizontal: 12,
        paddingTop: 32,
        paddingBottom: focused ? 12 : Math.max(12, insets.bottom),
      }}
    >
      {focused ? (
        <View style={{ marginBottom: 12, flexDirection: 'row', justifyContent: 'center', gap: 6 }}>
          {STATUS_REACTIONS.map((emoji) => (
            <Press
              key={emoji}
              accessibilityLabel={`React ${emoji}`}
              onPress={() => onReact(emoji)}
              pressedStyle={{
                backgroundColor: 'rgba(255,255,255,0.1)',
                transform: [{ scale: 1.25 }],
              }}
              style={{
                width: 40,
                height: 44,
                borderRadius: 22,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <T style={{ fontSize: 26, lineHeight: 32 }}>{emoji}</T>
            </Press>
          ))}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput
          ref={input}
          value={text}
          onChangeText={setText}
          onFocus={() => onFocusChange(true)}
          onBlur={() => {
            if (!text.trim()) onFocusChange(false);
          }}
          onSubmitEditing={() => void send()}
          returnKeyType="send"
          placeholder={`Reply to ${userDisplayName(author)}…`}
          placeholderTextColor="rgba(255,255,255,0.65)"
          accessibilityLabel="Reply"
          maxLength={4096}
          cursorColor="#fff"
          style={{
            flex: 1,
            minWidth: 0,
            height: 48,
            borderRadius: 999,
            borderWidth: 1,
            borderColor: focused ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)',
            backgroundColor: 'rgba(0,0,0,0.3)',
            paddingHorizontal: 20,
            fontSize: 15,
            color: '#fff',
          }}
        />
        {text.trim() ? (
          <Press
            accessibilityLabel="Send reply"
            disabled={sending}
            onPress={() => void send()}
            feedback={false}
            style={({ pressed }) => ({
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: pressed ? c['brand-strong'] : c.brand,
              opacity: sending ? 0.6 : 1,
            })}
          >
            {sending ? (
              <Spinner size={20} color={c['on-brand']} />
            ) : (
              <Icon icon={SendIcon} size={20} color={c['on-brand']} />
            )}
          </Press>
        ) : (
          <Press
            accessibilityLabel="React ❤️"
            onPress={() => onReact('❤️')}
            pressedStyle={{ backgroundColor: 'rgba(255,255,255,0.1)' }}
            style={{
              width: 48,
              height: 48,
              borderRadius: 24,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Icon icon={Heart} size={26} color="#fff" />
          </Press>
        )}
      </View>
    </Gradient>
  );
}

function ViewersSheet({ open, status, onClose }) {
  const { tw } = useTheme();
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
      bodyStyle={tw`px-0 pb-4`}
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
        items.map((v) => (
          <View key={v.user.id} style={tw`flex-row items-center gap-3 px-5 py-2`}>
            <UserAvatar user={v.user} size="md" />
            <View style={tw`min-w-0 flex-1`}>
              <T numberOfLines={1} style={tw`text-[15px] font-medium`}>
                {userDisplayName(v.user)}
              </T>
              <T style={tw`text-[13px] text-muted`}>{formatRelativeShort(v.viewedAt)}</T>
            </View>
            {v.reaction ? <T style={{ fontSize: 22 }}>{v.reaction}</T> : null}
          </View>
        ))
      )}
      <T style={tw`mt-2 px-5 text-center text-[12px] text-subtle`}>
        People with read receipts turned off aren't listed.
      </T>
    </Modal>
  );
}
