/**
 * Full-screen in-call UI (web features/calls/ui/CallScreen.tsx + CallControls.tsx): 1:1
 * (remote video full-bleed + draggable local picture-in-picture, or a big avatar for voice),
 * group grid (≤ 8 tiles), status/timer header, banners (reconnecting, poor connection,
 * muted hint) and the controls bar. Always dark, like native call screens.
 */
import { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  ChevronDown,
  Mic,
  MicOff,
  RotateCcw,
  SwitchCamera,
  UserPlus,
  Volume2,
  WifiOff,
} from 'lucide-react-native';
import { chatTitle } from '@enbox/shared';
import { Icon, PhoneOffIcon, VideoIcon, VideoOffIcon } from '@/components/icons';
import { Avatar, Gradient, Press, Spinner, T, useBackHandler } from '@/components/ui';
import { speakerToggleSupported } from '@/lib/webrtc';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useChat } from '@/stores/chats';
import { LOCAL_STREAM, useCallStream, useTrackLive } from '../engine/streams';
import { callKindLabel, gridColumns, hasPoorConnection, joinedOthers, phaseLabel } from '../logic';
import { useCallAudio } from './audio';
import { useParticipant, ParticipantTile } from './ParticipantTile';
import {
  CallAvatar,
  CallBackground,
  CallButton,
  HaloRings,
  PingRing,
  VideoView,
  useCallDuration,
  useDraggable,
} from './primitives';

const WHITE_75 = 'rgba(255,255,255,0.75)';

function useCallTitle(active, selfId) {
  const chat = useChat(active.call.chatId);
  const peer = active.call.isGroup
    ? null
    : (active.call.participants.find((p) => p.userId !== selfId)?.userId ??
      (chat?.type === 'direct' ? (chat.peer?.id ?? null) : null));
  const peerInfo = useParticipant(peer ?? selfId);
  if (active.call.isGroup) return { title: chat ? chatTitle(chat) : 'Group call', peerId: null };
  return { title: peer ? peerInfo.fullName : 'Call', peerId: peer };
}

export function CallScreen({ active }) {
  const insets = useSafeAreaInsets();
  const me = useMe();
  const selfId = me?.id ?? '';
  const { title, peerId } = useCallTitle(active, selfId);
  const duration = useCallDuration(active.connectedAt);
  const { call, phase } = active;
  const ended = phase === 'ended';

  const status =
    phase === 'connected' || (phase === 'reconnecting' && duration)
      ? (duration ?? '0:00')
      : ended
        ? (active.endReason ?? 'Call ended')
        : phaseLabel(phase, { outgoing: active.outgoing, isGroup: call.isGroup });

  // Back minimizes the call (it keeps running in the floating window).
  useBackHandler(() => {
    if (ended) useCalls.getState().leaveCall();
    else useCalls.getState().setMinimized(true);
    return true;
  }, true);

  return (
    <View
      accessibilityViewIsModal
      accessibilityLabel={`${callKindLabel(call)} with ${title}`}
      style={StyleSheet.absoluteFill}
    >
      <CallBackground />
      {ended ? (
        <EndedView active={active} title={title} peerId={peerId} />
      ) : call.isGroup ? (
        <GroupStage active={active} selfId={selfId} />
      ) : (
        <OneToOneStage active={active} peerId={peerId} />
      )}

      {!ended ? (
        <>
          <Gradient
            direction="down"
            stops={[
              [0, '#000000', 0.55],
              [0.5, '#000000', 0.2],
              [1, '#000000', 0],
            ]}
            pointerEvents="box-none"
            style={{ position: 'absolute', left: 0, right: 0, top: 0, paddingTop: insets.top }}
          >
            <View
              style={{
                height: 64,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingHorizontal: 8,
              }}
            >
              <CallButton
                icon={ChevronDown}
                label="Minimize call"
                size="md"
                tone="ghost"
                onPress={() => useCalls.getState().setMinimized(true)}
              />
              <View style={{ flex: 1, minWidth: 0, alignItems: 'center' }}>
                <T
                  numberOfLines={1}
                  style={{ fontSize: 17, fontWeight: '600', color: '#fff', letterSpacing: -0.4 }}
                >
                  {title}
                </T>
                <T
                  numberOfLines={1}
                  accessibilityLiveRegion="polite"
                  style={{ fontSize: 13, color: WHITE_75, fontVariant: ['tabular-nums'] }}
                >
                  {status}
                </T>
              </View>
              {call.isGroup ? (
                <CallButton
                  icon={UserPlus}
                  label="Add participant"
                  size="md"
                  tone="ghost"
                  disabled={!call.id || phase === 'starting'}
                  onPress={() =>
                    useCalls
                      .getState()
                      .openPicker({ chatId: call.chatId, type: call.type, mode: 'invite' })
                  }
                />
              ) : (
                <View style={{ width: 48 }} />
              )}
            </View>
            <Banners active={active} selfId={selfId} />
          </Gradient>
          <CallControls active={active} />
        </>
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

function Pill({ bg, fg = '#fff', children, onPress }) {
  const style = {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 6,
    backgroundColor: bg,
  };
  const body = (
    <View style={style}>
      {typeof children === 'string' ? (
        <T style={{ fontSize: 13, fontWeight: '500', color: fg }}>{children}</T>
      ) : (
        children
      )}
    </View>
  );
  return onPress ? (
    <Press feedback={false} onPress={onPress}>
      {body}
    </Press>
  ) : (
    body
  );
}

function Banners({ active, selfId }) {
  const peers = joinedOthers(active.call, selfId).map((p) => p.userId);
  const poor = active.phase === 'connected' && hasPoorConnection(active.connections, peers);
  const mutedTalking = active.audioMuted && active.speaking.includes(selfId);
  const [mediaErrorShown, setMediaErrorShown] = useState(active.mediaError);
  useEffect(() => {
    setMediaErrorShown(active.mediaError);
    if (!active.mediaError) return;
    const t = setTimeout(() => setMediaErrorShown(null), 6000);
    return () => clearTimeout(t);
  }, [active.mediaError]);

  return (
    <View
      style={{ alignItems: 'center', gap: 8, paddingHorizontal: 16 }}
      accessibilityLiveRegion="polite"
    >
      {active.phase === 'reconnecting' ? (
        <Pill bg="rgba(245,158,11,0.9)">
          <Spinner size={14} color="#000" />
          <T style={{ fontSize: 13, fontWeight: '500', color: '#000' }}>Reconnecting…</T>
        </Pill>
      ) : poor ? (
        <Pill bg="rgba(245,158,11,0.85)">
          <Icon icon={WifiOff} size={14} color="#000" />
          <T style={{ fontSize: 13, fontWeight: '500', color: '#000' }}>Poor connection</T>
        </Pill>
      ) : null}
      {active.audioBlocked ? (
        <Pill bg="#ffffff" fg="#15141c" onPress={() => useCalls.getState().resumeAudio()}>
          Tap to hear the call
        </Pill>
      ) : null}
      {mutedTalking ? (
        <Pill bg="rgba(0,0,0,0.55)">
          <Icon icon={MicOff} size={14} color="#fff" />
          <T style={{ fontSize: 13, fontWeight: '500', color: '#fff' }}>You're muted</T>
        </Pill>
      ) : null}
      {mediaErrorShown ? <Pill bg="rgba(0,0,0,0.6)">{mediaErrorShown}</Pill> : null}
    </View>
  );
}

// ---------------------------------------------------------------------------

export function CallControls({ active }) {
  const insets = useSafeAreaInsets();
  const calls = useCalls.getState;
  const speaker = useCallAudio((s) => s.speaker);
  const camOn = !active.videoOff;
  return (
    <Gradient
      direction="up"
      stops={[
        [0, '#000000', 0.6],
        [0.5, '#000000', 0.25],
        [1, '#000000', 0],
      ]}
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        alignItems: 'center',
        paddingHorizontal: 12,
        paddingTop: 40,
        paddingBottom: Math.max(20, insets.bottom),
      }}
    >
      <View
        accessibilityRole="toolbar"
        accessibilityLabel="Call controls"
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          borderRadius: 999,
          backgroundColor: 'rgba(0,0,0,0.35)',
          paddingHorizontal: 12,
          paddingVertical: 10,
          borderWidth: 1,
          borderColor: 'rgba(255,255,255,0.1)',
          maxWidth: '100%',
        }}
      >
        {camOn && !active.screenSharing ? (
          <CallButton
            icon={SwitchCamera}
            label="Switch camera"
            onPress={() => calls().flipCamera()}
          />
        ) : null}
        <CallButton
          icon={camOn ? VideoIcon : VideoOffIcon}
          label={camOn ? 'Turn camera off' : 'Turn camera on'}
          tone={camOn ? 'light' : 'glass'}
          pressed={camOn}
          onPress={() => calls().toggleVideo()}
        />
        <CallButton
          icon={active.audioMuted ? MicOff : Mic}
          label={active.audioMuted ? 'Unmute' : 'Mute'}
          tone={active.audioMuted ? 'light' : 'glass'}
          pressed={active.audioMuted}
          onPress={() => calls().toggleMute()}
        />
        {speakerToggleSupported ? (
          <CallButton
            icon={Volume2}
            label={speaker ? 'Turn speaker off' : 'Turn speaker on'}
            tone={speaker ? 'light' : 'glass'}
            pressed={speaker}
            onPress={() => useCallAudio.getState().setSpeaker(!speaker)}
          />
        ) : null}
        <CallButton
          icon={PhoneOffIcon}
          label={active.outgoing && !active.connectedAt ? 'Cancel call' : 'End call'}
          tone="danger"
          wide
          onPress={() => calls().leaveCall()}
        />
      </View>
    </Gradient>
  );
}

// ---------------------------------------------------------------------------

function PulsingAvatar({ userId, size, pulse, speaking }) {
  const info = useParticipant(userId);
  return (
    <View>
      {pulse ? (
        <>
          <PingRing size={size} duration={2200} />
          <HaloRings size={size} near={24} far={48} />
        </>
      ) : null}
      <View
        style={{
          borderRadius: size,
          boxShadow: speaking
            ? '0px 0px 0px 4px rgba(168,158,255,0.9), 0px 0px 40px 6px rgba(139,125,255,0.5)'
            : undefined,
        }}
      >
        <Avatar src={info.avatarUrl} name={info.fullName} colorSeed={info.id} size={size} />
      </View>
    </View>
  );
}

function OneToOneStage({ active, peerId }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const remote = active.call.participants.find((p) => p.userId === peerId);
  const remoteStream = useCallStream(peerId);
  const remoteLive = useTrackLive(remoteStream, 'video');
  const localStream = useCallStream(LOCAL_STREAM);
  const localLive = useTrackLive(localStream, 'video');
  const [swapped, setSwapped] = useState(false);

  const remoteVideo = !!remote && remote.status === 'joined' && !remote.videoOff && remoteLive;
  const localVideo = localLive && (!active.videoOff || active.screenSharing);
  const mirrorLocal = active.facingMode === 'user' && !active.screenSharing;
  const ringing = ['starting', 'calling', 'ringing'].includes(active.phase);

  const pipW = Math.min(180, Math.max(96, width * 0.28));
  const pip = useDraggable({
    width: pipW,
    height: (pipW * 4) / 3,
    bounds: { width, height },
    initial: 'br',
    margin: 16,
    topInset: 64 + insets.top,
    bottomInset: 108 + insets.bottom,
    onTap: () => setSwapped((s) => !s),
  });

  const avatarView = (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 96 }}>
      {peerId ? (
        <PulsingAvatar
          userId={peerId}
          size={144}
          pulse={ringing}
          speaking={active.speaking.includes(peerId) && !remote?.audioMuted}
        />
      ) : null}
    </View>
  );

  const remoteView = (z) => (
    <VideoView stream={remoteStream} fit={remote?.screenSharing ? 'contain' : 'cover'} zOrder={z} />
  );
  const localView = (z) => (
    <VideoView
      stream={localStream}
      mirror={mirrorLocal}
      fit={active.screenSharing ? 'contain' : 'cover'}
      zOrder={z}
    />
  );

  let main;
  let small = null;
  if (remoteVideo) {
    main = swapped && localVideo ? localView(0) : remoteView(0);
    small = localVideo ? (swapped ? remoteView(1) : localView(1)) : null;
  } else if (localVideo && ringing) {
    main = (
      <View style={{ flex: 1 }}>
        <View style={[StyleSheet.absoluteFill, { opacity: 0.6 }]}>{localView(0)}</View>
        <Gradient
          direction="down"
          stops={[
            [0, '#000000', 0.4],
            [0.5, '#000000', 0],
            [1, '#000000', 0.6],
          ]}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <View style={{ flex: 1 }}>{avatarView}</View>
      </View>
    );
  } else {
    main = avatarView;
    small = localVideo ? localView(1) : null;
  }

  return (
    <View style={{ flex: 1, overflow: 'hidden' }}>
      <View style={StyleSheet.absoluteFill}>{main}</View>
      {remote?.audioMuted && remote.status === 'joined' ? (
        <View
          style={{
            position: 'absolute',
            top: insets.top + 76,
            alignSelf: 'center',
            zIndex: 10,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 6,
            borderRadius: 999,
            backgroundColor: 'rgba(0,0,0,0.45)',
            paddingHorizontal: 12,
            paddingVertical: 4,
          }}
        >
          <Icon icon={MicOff} size={14} color="#fff" />
          <T style={{ fontSize: 12, color: '#fff' }}>Muted</T>
        </View>
      ) : null}
      {small ? (
        <Animated.View
          {...pip.handlers}
          accessibilityRole="button"
          accessibilityLabel="Switch video views"
          style={[
            pip.style,
            {
              zIndex: 20,
              overflow: 'hidden',
              borderRadius: 16,
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.15)',
              boxShadow: '0px 25px 50px -12px rgba(0,0,0,0.5)',
            },
          ]}
        >
          {small}
        </Animated.View>
      ) : null}
    </View>
  );
}

function GroupStage({ active, selfId }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const tiles = useMemo(() => {
    const parts = active.call.participants.filter(
      (p) => p.status === 'joined' || p.status === 'invited' || p.status === 'ringing',
    );
    const mine = parts.find((p) => p.userId === selfId);
    const others = parts.filter((p) => p.userId !== selfId);
    others.sort((a, b) => Number(b.status === 'joined') - Number(a.status === 'joined'));
    const me = mine ?? {
      userId: selfId,
      status: 'joined',
      joinedAt: null,
      leftAt: null,
      audioMuted: active.audioMuted,
      videoOff: active.videoOff,
      screenSharing: active.screenSharing,
    };
    const meTile = {
      ...me,
      audioMuted: active.audioMuted,
      videoOff: active.videoOff && !active.screenSharing,
      screenSharing: active.screenSharing,
    };
    return [...others, meTile].slice(0, 8);
  }, [active.call.participants, active.audioMuted, active.videoOff, active.screenSharing, selfId]);

  const wide = width > height;
  const cols = gridColumns(tiles.length, wide);
  const compact = tiles.length > 4;
  const rows = [];
  for (let i = 0; i < tiles.length; i += cols) rows.push(tiles.slice(i, i + cols));
  // 3 tiles in 2 columns: the first one spans the top row.
  if (tiles.length === 3 && cols === 2) rows.splice(0, rows.length, [tiles[0]], tiles.slice(1));

  return (
    <View
      style={{
        flex: 1,
        paddingHorizontal: 8,
        paddingTop: insets.top + 68,
        paddingBottom: insets.bottom + 104,
        gap: 8,
      }}
    >
      {rows.map((row, i) => (
        <View key={i} style={{ flex: 1, flexDirection: 'row', gap: 8 }}>
          {row.map((p) => (
            <ParticipantTile
              key={p.userId}
              participant={p}
              isMe={p.userId === selfId}
              connection={
                p.userId === selfId ? undefined : (active.connections[p.userId] ?? 'waiting')
              }
              speaking={active.speaking.includes(p.userId)}
              activeSpeaker={active.activeSpeakerId === p.userId}
              facingMode={active.facingMode}
              compact={compact}
            />
          ))}
          {row.length < cols && !(tiles.length === 3 && cols === 2 && i === 0)
            ? Array.from({ length: cols - row.length }, (_, k) => (
                <View key={`pad${k}`} style={{ flex: 1 }} />
              ))
            : null}
        </View>
      ))}
    </View>
  );
}

// ---------------------------------------------------------------------------

function EndedView({ active, title, peerId }) {
  const insets = useSafeAreaInsets();
  const call = active.call;
  const retry =
    active.outgoing && !call.isGroup && (call.status === 'missed' || call.status === 'declined');
  const duration = call.durationSec
    ? `${Math.floor(call.durationSec / 60)}:${String(call.durationSec % 60).padStart(2, '0')}`
    : null;
  const chat = useChat(call.chatId);
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        gap: 20,
        paddingHorizontal: 24,
        paddingBottom: insets.bottom,
      }}
    >
      {peerId ? (
        <PulsingAvatar userId={peerId} size={120} pulse={false} speaking={false} />
      ) : chat ? (
        <CallAvatar src={chat.avatarUrl} name={chatTitle(chat)} seed={chat.id} group size={120} />
      ) : null}
      <View style={{ alignItems: 'center' }}>
        <T style={{ fontSize: 22, fontWeight: '600', color: '#fff', letterSpacing: -0.5 }}>
          {title}
        </T>
        <T style={{ marginTop: 4, fontSize: 15, color: WHITE_75 }}>
          {active.endReason ?? 'Call ended'}
          {duration && call.status === 'ended' ? ` · ${duration}` : ''}
        </T>
      </View>
      {retry ? (
        <View style={{ marginTop: 24, flexDirection: 'row', alignItems: 'flex-start', gap: 40 }}>
          <CallButton
            icon={PhoneOffIcon}
            label="Close"
            caption="Close"
            tone="glass"
            size="xl"
            onPress={() => useCalls.getState().leaveCall()}
          />
          <CallButton
            icon={call.type === 'video' ? VideoIcon : RotateCcw}
            label="Call again"
            caption="Call again"
            tone="success"
            size="xl"
            onPress={() => void useCalls.getState().startCall(call.chatId, call.type)}
          />
        </View>
      ) : null}
    </View>
  );
}
