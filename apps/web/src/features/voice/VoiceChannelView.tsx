import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft,
  Headphones,
  HeadphoneOff,
  Mic,
  MicOff,
  MonitorUp,
  Volume2,
} from 'lucide-react';
import { PhoneOffIcon, VideoIcon, VideoOffIcon } from '@/components/icons';
import { Track, type Participant } from 'livekit-client';
import { PERM, hasPerm, type ChatSummary, type Space } from '@enbox/shared';
import { Avatar, Button, IconButton } from '@/components/ui';
import { SoundboardButton } from '@/features/soundboard/SoundboardButton';
import { SoundFlash } from '@/features/soundboard/SoundFlash';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useVoice, useVoiceChannelStates } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import {
  connectVoice,
  disconnectVoice,
  getVoiceRoom,
  resumeVoiceAudio,
  toggleCamera,
  toggleScreenShare,
  voiceAvailable,
} from './engine';
import { useVoiceUser } from './useVoiceUser';

function VideoTrack({ participant, source }: { participant: Participant; source: Track.Source }) {
  const ref = useRef<HTMLVideoElement>(null);
  const track = participant.getTrackPublication(source)?.track;
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track]);
  if (!track) return null;
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn('absolute inset-0 size-full bg-black', source === Track.Source.ScreenShare ? 'object-contain' : 'object-cover')}
    />
  );
}

export function Tile({
  participant,
  spaceId,
  source,
}: {
  participant: Participant;
  spaceId: string;
  source: Track.Source;
}) {
  const { name, user } = useVoiceUser(spaceId, participant.identity);
  const speaking = useVoice((s) => !!s.speaking[participant.identity]);
  const state = useVoice((s) => s.byUser[participant.identity]);
  const screen = source === Track.Source.ScreenShare;
  const hasVideo = !!participant.getTrackPublication(source)?.track && !participant.getTrackPublication(source)?.isMuted;
  const muted = state ? state.selfMute || state.serverMute : !participant.isMicrophoneEnabled;
  return (
    <div
      className={cn(
        'relative flex aspect-video min-w-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 ring-2 transition-shadow',
        speaking && !screen ? 'ring-success' : 'ring-transparent',
      )}
      aria-label={screen ? `${name}'s screen` : `${name}${muted ? ', muted' : ''}`}
      data-testid="voice-tile"
      data-animate-avatars
    >
      {hasVideo ? (
        <VideoTrack participant={participant} source={source} />
      ) : (
        <Avatar
          src={user?.avatarUrl}
          animatedSrc={user?.avatarAnimatedUrl}
          name={name}
          colorSeed={participant.identity}
          size={80}
          decoration={user?.avatarDecoration}
          decorative
        />
      )}
      <span className="absolute bottom-2 left-2 flex max-w-[80%] items-center gap-1 rounded-md bg-black/55 px-2 py-0.5 text-[13px] font-medium text-white">
        {screen ? <MonitorUp size={14} aria-hidden /> : muted ? <MicOff size={14} aria-hidden /> : null}
        <span className="truncate">{screen ? `${name}'s screen` : name}</span>
      </span>
      {screen ? null : <SoundFlash userId={participant.identity} />}
    </div>
  );
}

function Lobby({ chat, space }: { chat: ChatSummary; space: Space }) {
  const states = useVoiceChannelStates(chat.id);
  const canConnect = hasPerm(chat.spacePermissions, PERM.CONNECT);
  const full = !!chat.space?.userLimit && states.length >= chat.space.userLimit && !hasPerm(chat.spacePermissions, PERM.MOVE_MEMBERS);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-[24px] font-bold text-fg">{chat.name}</h2>
      {states.length ? (
        <div className="flex -space-x-2" aria-label={`${states.length} in voice`}>
          {states.slice(0, 8).map((v) => (
            <LobbyAvatar key={v.userId} spaceId={space.id} userId={v.userId} />
          ))}
        </div>
      ) : (
        <p className="text-[15px] text-muted">No one is currently in voice</p>
      )}
      {!voiceAvailable() ? (
        <p className="max-w-sm text-[14px] text-muted">Voice channels aren’t switched on for this server yet.</p>
      ) : !canConnect ? (
        <p className="text-[14px] text-muted">You don’t have permission to connect here.</p>
      ) : full ? (
        <p className="text-[14px] text-muted">This voice channel is full.</p>
      ) : (
        <Button className="bg-success hover:bg-success/90" onClick={() => void connectVoice(chat)} data-testid="join-voice">
          Join Voice
        </Button>
      )}
    </div>
  );
}

function LobbyAvatar({ spaceId, userId }: { spaceId: string; userId: string }) {
  const { name, user } = useVoiceUser(spaceId, userId);
  return (
    <span className="rounded-full ring-4 ring-surface" title={name}>
      <Avatar src={user?.avatarUrl} name={name} colorSeed={userId} size={48} decoration={user?.avatarDecoration} decorative />
    </span>
  );
}

function Stage({ space }: { space: Space }) {
  useVoice((s) => s.roomVersion);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  const room = getVoiceRoom();
  if (!room) return <div className="flex-1" />;
  const people: Participant[] = [room.localParticipant, ...room.remoteParticipants.values()];
  const tiles: { p: Participant; source: Track.Source; key: string }[] = [];
  for (const p of people) {
    if (p.isScreenShareEnabled || p.getTrackPublication(Track.Source.ScreenShare)?.track)
      tiles.push({ p, source: Track.Source.ScreenShare, key: `${p.identity}:screen` });
    tiles.push({ p, source: Track.Source.Camera, key: `${p.identity}:camera` });
  }
  const cols = tiles.length <= 1 ? 'grid-cols-1' : tiles.length <= 4 ? 'grid-cols-2' : tiles.length <= 9 ? 'grid-cols-3' : 'grid-cols-4';
  return (
    <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-4">
      <div className={cn('grid w-full max-w-6xl gap-3', cols)}>
        {tiles.map((t) => (
          <Tile key={t.key} participant={t.p} source={t.source} spaceId={space.id} />
        ))}
      </div>
      {audioBlocked ? (
        <Button className="absolute top-4" onClick={() => void resumeVoiceAudio()}>
          Click to hear voice
        </Button>
      ) : null}
    </div>
  );
}

function ControlBar({ chat }: { chat: ChatSummary }) {
  useVoice((s) => s.roomVersion);
  const { muted, deafened, toggleMute, toggleDeafen } = useVoiceSelf();
  const room = getVoiceRoom();
  const camera = !!room?.localParticipant.isCameraEnabled;
  const screen = !!room?.localParticipant.isScreenShareEnabled;
  const canVideo = hasPerm(chat.spacePermissions, PERM.VIDEO);
  const canStream = hasPerm(chat.spacePermissions, PERM.STREAM);
  const btn = 'size-12 rounded-full';
  return (
    <div className="flex shrink-0 items-center justify-center gap-3 pb-4" role="toolbar" aria-label="Voice controls">
      {canVideo ? (
        <IconButton icon={camera ? VideoIcon : VideoOffIcon} label={camera ? 'Turn off camera' : 'Turn on camera'} variant={camera ? 'brand' : 'solid'} className={btn} onClick={() => void toggleCamera()} />
      ) : null}
      {canStream ? (
        <IconButton icon={MonitorUp} label={screen ? 'Stop sharing' : 'Share your screen'} variant={screen ? 'brand' : 'solid'} className={btn} onClick={() => void toggleScreenShare()} />
      ) : null}
      <IconButton icon={muted || deafened ? MicOff : Mic} label={muted || deafened ? 'Unmute' : 'Mute'} variant="solid" className={cn(btn, (muted || deafened) && 'text-danger')} onClick={toggleMute} />
      <IconButton icon={deafened ? HeadphoneOff : Headphones} label={deafened ? 'Undeafen' : 'Deafen'} variant="solid" className={cn(btn, deafened && 'text-danger')} onClick={toggleDeafen} />
      <SoundboardButton look="bar" />
      <IconButton icon={PhoneOffIcon} label="Disconnect" variant="danger" className={btn} onClick={() => void disconnectVoice()} data-testid="voice-disconnect" />
    </div>
  );
}

/** /spaces/:spaceId/:chatId for a voice channel: the lobby, or the call while I am in it. */
export function VoiceChannelView({ chat, space }: { chat: ChatSummary; space: Space }) {
  useEffect(() => {
    void useVoice
      .getState()
      .loadSpace(space.id)
      .catch(() => undefined);
  }, [space.id]);
  const desktop = useIsDesktop();
  const navigate = useNavigate();
  const here = useVoice((s) => s.connection?.channelId === chat.id);
  const status = useVoice((s) => (s.connection?.channelId === chat.id ? s.connection.status : null));
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="voice-channel">
      <header className="flex h-14 shrink-0 items-center gap-2 px-3">
        {desktop ? null : (
          <IconButton icon={ArrowLeft} label="Back" variant="ghost" onClick={() => navigate(`/spaces/${space.id}`)} />
        )}
        <Volume2 size={22} className="text-muted" aria-hidden />
        <h1 className="truncate text-[16px] font-bold">{chat.name}</h1>
        {status && status !== 'connected' ? <span className="text-[13px] text-warning">{status === 'connecting' ? 'Connecting…' : 'Reconnecting…'}</span> : null}
      </header>
      {here ? (
        <>
          <Stage space={space} />
          <ControlBar chat={chat} />
        </>
      ) : (
        <Lobby chat={chat} space={space} />
      )}
    </div>
  );
}
