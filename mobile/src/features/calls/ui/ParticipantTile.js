/**
 * One participant in the group grid (web features/calls/ui/ParticipantTile.tsx): video or
 * avatar, name, mute/screen badges, speaking ring.
 */
import { StyleSheet, View } from 'react-native';
import { MicOff, MonitorUp } from 'lucide-react-native';
import { userDisplayName } from '@enbox/shared';
import { Icon } from '@/components/icons';
import { Avatar, Gradient, Spinner, T } from '@/components/ui';
import { useMe } from '@/stores/auth';
import { useUser } from '@/stores/users';
import { LOCAL_STREAM, useCallStream, useTrackLive } from '../engine/streams';
import { PingRing, VideoView } from './primitives';

/** Display name + avatar data of a call participant (me → "You"). */
export function useParticipant(userId) {
  const me = useMe();
  const isMe = me?.id === userId;
  const user = useUser(isMe ? null : userId);
  if (isMe && me) {
    return { id: me.id, name: 'You', fullName: me.displayName, avatarUrl: me.avatarUrl };
  }
  const name = user ? userDisplayName(user) : '…';
  return {
    id: userId,
    name,
    fullName: name,
    avatarUrl: user?.isDeleted ? null : (user?.avatarUrl ?? null),
  };
}

function pendingLabel(p) {
  switch (p.status) {
    case 'invited':
      return 'Calling…';
    case 'ringing':
      return 'Ringing…';
    case 'busy':
      return 'On another call';
    case 'declined':
      return 'Declined';
    case 'missed':
      return 'No answer';
    case 'left':
      return 'Left';
    default:
      return null;
  }
}

export function ParticipantTile({
  participant,
  isMe,
  connection,
  speaking,
  activeSpeaker,
  facingMode = 'user',
  compact,
  style,
}) {
  const info = useParticipant(participant.userId);
  const stream = useCallStream(isMe ? LOCAL_STREAM : participant.userId);
  const videoLive = useTrackLive(stream, 'video');
  const joined = participant.status === 'joined';
  const showVideo = joined && !participant.videoOff && videoLive;
  const pending = joined ? null : pendingLabel(participant);
  const connecting = joined && !isMe && connection !== undefined && connection !== 'connected';
  const talking = speaking && joined && !participant.audioMuted;
  const avatarSize = compact ? 56 : 88;

  return (
    <View
      style={[
        {
          flex: 1,
          minWidth: 0,
          minHeight: 0,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          backgroundColor: '#1c1a2e',
          borderRadius: compact ? 12 : 16,
          borderWidth: talking ? 3 : activeSpeaker ? 2 : 1,
          borderColor: talking
            ? '#a89eff'
            : activeSpeaker
              ? 'rgba(168,158,255,0.6)'
              : 'rgba(255,255,255,0.06)',
        },
        style,
      ]}
    >
      {showVideo ? (
        <VideoView
          stream={stream}
          mirror={isMe && facingMode === 'user' && !participant.screenSharing}
          fit={participant.screenSharing ? 'contain' : 'cover'}
          style={StyleSheet.absoluteFill}
        />
      ) : (
        <View style={{ alignItems: 'center', gap: 8, opacity: joined ? 1 : 0.7 }}>
          <View>
            {talking ? (
              <PingRing
                size={avatarSize}
                inset={8}
                color="rgba(167,139,250,0.25)"
                duration={1000}
              />
            ) : null}
            <Avatar
              src={info.avatarUrl}
              name={info.fullName}
              colorSeed={info.id}
              size={avatarSize}
            />
          </View>
          {pending ? (
            <T style={{ fontSize: 13, color: 'rgba(255,255,255,0.7)' }}>{pending}</T>
          ) : null}
        </View>
      )}

      {connecting ? (
        <View
          style={{
            ...StyleSheet.absoluteFillObject,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(0,0,0,0.35)',
          }}
        >
          <Spinner size={22} color="#ffffff" />
        </View>
      ) : null}

      <Gradient
        direction="up"
        stops={[
          [0, '#000000', 0.6],
          [1, '#000000', 0],
        ]}
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingHorizontal: 10,
          paddingTop: 24,
          paddingBottom: 8,
        }}
      >
        <T
          numberOfLines={1}
          style={{ flexShrink: 1, fontSize: 13, fontWeight: '500', color: '#ffffff' }}
        >
          {info.name}
        </T>
        {participant.audioMuted && joined ? (
          <View
            accessibilityLabel="Muted"
            style={{
              width: 20,
              height: 20,
              borderRadius: 10,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: 'rgba(0,0,0,0.45)',
            }}
          >
            <Icon icon={MicOff} size={12} color="#ffffff" />
          </View>
        ) : null}
      </Gradient>
      {participant.screenSharing && joined ? (
        <View
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 4,
            borderRadius: 999,
            backgroundColor: 'rgba(0,0,0,0.5)',
            paddingHorizontal: 8,
            paddingVertical: 2,
          }}
        >
          <Icon icon={MonitorUp} size={12} color="#ffffff" />
          <T style={{ fontSize: 11, fontWeight: '500', color: '#ffffff' }}>Presenting</T>
        </View>
      ) : null}
    </View>
  );
}
