/**
 * Minimized call (web features/calls/ui/CallMiniWindow.tsx, phone form): a draggable bubble
 * that snaps to corners, with the featured video or avatar, the timer and an end button;
 * tap it to return to the call.
 */
import { Animated, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { chatTitle } from '@enbox/shared';
import { Icon, PhoneOffIcon } from '@/components/icons';
import { Avatar, Gradient, Portal, Press, T } from '@/components/ui';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChat } from '@/stores/chats';
import { LOCAL_STREAM, useCallStream, useTrackLive } from '../engine/streams';
import { joinedOthers, phaseLabel } from '../logic';
import { useParticipant } from './ParticipantTile';
import { CallBackground, VideoView, useCallDuration, useDraggable } from './primitives';

const W = 124;
const H = (W * 4) / 3 + 36;

function useFeatured(active, selfId) {
  const others = joinedOthers(active.call, selfId);
  if (active.activeSpeakerId && others.some((p) => p.userId === active.activeSpeakerId)) {
    return active.activeSpeakerId;
  }
  return (
    others[0]?.userId ?? active.call.participants.find((p) => p.userId !== selfId)?.userId ?? null
  );
}

export function CallMiniWindow({ active }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const selfId = useMe()?.id ?? '';
  const featured = useFeatured(active, selfId);
  const info = useParticipant(featured ?? selfId);
  const chat = useChat(active.call.chatId);
  const remoteStream = useCallStream(featured);
  const remoteLive = useTrackLive(remoteStream, 'video');
  const localStream = useCallStream(LOCAL_STREAM);
  const localLive = useTrackLive(localStream, 'video');
  const duration = useCallDuration(active.connectedAt);
  const expand = () => useCalls.getState().setMinimized(false);
  const drag = useDraggable({
    width: W,
    height: H,
    bounds: { width, height },
    initial: 'tr',
    margin: 16,
    topInset: 60 + insets.top,
    bottomInset: 72 + insets.bottom,
    onTap: expand,
  });

  const featuredP = active.call.participants.find((p) => p.userId === featured);
  const showRemote = !!featuredP && !featuredP.videoOff && remoteLive;
  const showLocal = !showRemote && localLive && !active.videoOff;
  const title = active.call.isGroup ? (chat ? chatTitle(chat) : 'Group call') : info.fullName;
  const status =
    active.phase === 'connected' || (active.phase === 'reconnecting' && duration)
      ? (duration ?? '0:00')
      : phaseLabel(active.phase, { outgoing: active.outgoing, isGroup: active.call.isGroup });
  const speaking = featured && active.speaking.includes(featured);

  return (
    <Portal>
      <Animated.View
        {...drag.handlers}
        accessibilityRole="button"
        accessibilityLabel={`Call with ${title}. Tap to return`}
        style={[
          drag.style,
          {
            overflow: 'hidden',
            borderRadius: 16,
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.1)',
            boxShadow: '0px 25px 50px -12px rgba(0,0,0,0.5)',
          },
        ]}
      >
        <CallBackground />
        <View style={{ height: H - 36 }}>
          {showRemote ? (
            <VideoView stream={remoteStream} zOrder={2} />
          ) : showLocal ? (
            <VideoView stream={localStream} mirror={active.facingMode === 'user'} zOrder={2} />
          ) : (
            <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
              <View
                style={{
                  borderRadius: 56,
                  boxShadow: speaking ? '0px 0px 0px 3px #a89eff' : undefined,
                }}
              >
                <Avatar src={info.avatarUrl} name={info.fullName} colorSeed={info.id} size={56} />
              </View>
            </View>
          )}
          <Gradient
            direction="up"
            stops={[
              [0, '#000000', 0.7],
              [1, '#000000', 0],
            ]}
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 0,
              paddingHorizontal: 12,
              paddingTop: 24,
              paddingBottom: 8,
            }}
          >
            <T
              numberOfLines={1}
              style={{
                fontSize: 12,
                color: 'rgba(255,255,255,0.8)',
                fontVariant: ['tabular-nums'],
              }}
            >
              {status}
            </T>
          </Gradient>
        </View>
        <Press
          accessibilityLabel="End call"
          onPress={() => useCalls.getState().leaveCall()}
          feedback={false}
          style={({ pressed }) => ({
            height: 36,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? '#dc2626' : '#ef4444',
          })}
        >
          <Icon icon={PhoneOffIcon} size={16} color="#fff" />
        </Press>
      </Animated.View>
    </Portal>
  );
}
