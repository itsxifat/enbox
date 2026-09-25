import { MicOff, MonitorUp } from 'lucide-react';
import { userDisplayName, type CallParticipant } from '@enbox/shared';
import { Avatar, Spinner } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import type { PeerConnectionState } from '@/stores/calls';
import { useUser } from '@/stores/users';
import { LOCAL_STREAM, useCallStream, useTrackLive } from '../engine/streams';
import { VideoView } from './VideoView';

export interface ParticipantTileProps {
  participant: CallParticipant;
  isMe: boolean;
  connection?: PeerConnectionState;
  speaking?: boolean;
  activeSpeaker?: boolean;
  /** Local camera facing mode (mirror the front camera). */
  facingMode?: 'user' | 'environment';
  /** Compact tile (many participants on a phone). */
  compact?: boolean;
  className?: string;
}

/** Display name + avatar data of a call participant (me → "You"). */
export function useParticipant(userId: string) {
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

function pendingLabel(p: CallParticipant): string | null {
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

/** One participant in the group grid: video or avatar, name, mute/screen badges, speaking ring. */
export function ParticipantTile({
  participant,
  isMe,
  connection,
  speaking,
  activeSpeaker,
  facingMode = 'user',
  compact,
  className,
}: ParticipantTileProps) {
  const info = useParticipant(participant.userId);
  const stream = useCallStream(isMe ? LOCAL_STREAM : participant.userId);
  const videoLive = useTrackLive(stream, 'video');
  const joined = participant.status === 'joined';
  const showVideo = joined && !participant.videoOff && videoLive;
  const pending = joined ? null : pendingLabel(participant);
  const connecting = joined && !isMe && connection !== undefined && connection !== 'connected';

  return (
    <div
      data-testid="call-tile"
      data-user-id={participant.userId}
      data-connection={isMe ? 'self' : (connection ?? 'waiting')}
      data-speaking={speaking ? '' : undefined}
      className={cn(
        'relative isolate flex min-h-0 min-w-0 items-center justify-center overflow-hidden bg-[#1c1a2e]',
        compact ? 'rounded-xl' : 'rounded-2xl',
        'transition-shadow duration-300',
        speaking && joined && !participant.audioMuted
          ? 'shadow-[0_0_0_3px_#a89eff,0_0_24px_2px_rgba(139,125,255,0.45)]'
          : activeSpeaker
            ? 'shadow-[0_0_0_2px_rgba(168,158,255,0.6)]'
            : 'shadow-[0_0_0_1px_rgba(255,255,255,0.06)]',
        className,
      )}
    >
      {showVideo ? (
        <VideoView
          stream={stream}
          remote={!isMe}
          mirror={isMe && facingMode === 'user' && !participant.screenSharing}
          fit={participant.screenSharing ? 'contain' : 'cover'}
          label={`${info.fullName} video`}
        />
      ) : (
        <div className={cn('flex flex-col items-center gap-2', !joined && 'opacity-70')}>
          <span className="relative">
            {speaking && joined && !participant.audioMuted ? (
              <span
                className="absolute -inset-2 animate-ping rounded-full bg-violet-400/25"
                aria-hidden
              />
            ) : null}
            <Avatar
              src={info.avatarUrl}
              name={info.fullName}
              colorSeed={info.id}
              size={compact ? 56 : 88}
              className="relative"
            />
          </span>
          {pending ? <span className="text-[13px] text-white/70">{pending}</span> : null}
        </div>
      )}

      {connecting ? (
        <div className="absolute inset-0 flex items-center justify-center bg-black/35">
          <Spinner size={22} className="text-white" label="Connecting" />
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/60 to-transparent px-2.5 pt-6 pb-2">
        <span className="min-w-0 truncate text-[13px] font-medium text-white drop-shadow">
          {info.name}
        </span>
        {participant.audioMuted && joined ? (
          <span
            className="flex size-5 shrink-0 items-center justify-center rounded-full bg-black/45"
            aria-label="Muted"
            role="img"
          >
            <MicOff size={12} className="text-white" aria-hidden />
          </span>
        ) : null}
      </div>
      {participant.screenSharing && joined ? (
        <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-black/50 px-2 py-0.5 text-[11px] font-medium text-white">
          <MonitorUp size={12} aria-hidden /> Presenting
        </span>
      ) : null}
    </div>
  );
}
