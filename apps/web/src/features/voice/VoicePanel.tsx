import { Link } from 'react-router';
import { MonitorUp, Signal, Volume2 } from 'lucide-react';
import { PhoneOffIcon, VideoIcon } from '@/components/icons';
import { IconButton } from '@/components/ui';
import { SoundboardButton } from '@/features/soundboard/SoundboardButton';
import { cn } from '@/lib/cn';
import { useChat } from '@/stores/chats';
import { useSpace } from '@/stores/spaces';
import { useUi } from '@/stores/ui';
import { useMyVoiceState, useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { disconnectVoice, getVoiceRoom, resumeVoiceAudio, toggleCamera, toggleScreenShare } from './engine';

/** "PTT" while my input mode is push to talk, lit while it sends. */
function PushToTalkBadge() {
  const on = useUi((s) => s.prefs.voiceInputMode === 'pushToTalk');
  const active = useVoiceSelf((s) => s.pttActive);
  if (!on) return null;
  return (
    <span
      className={cn(
        'shrink-0 rounded px-1 text-[10px] leading-4 font-bold tracking-wide transition-colors',
        active ? 'bg-success text-white' : 'bg-surface-2 text-muted',
      )}
      title={active ? 'Push to talk: talking' : 'Push to talk'}
      aria-label={active ? 'Push to talk, talking' : 'Push to talk'}
      data-testid="ptt-badge"
    >
      PTT
    </span>
  );
}

/**
 * Discord's "Voice Connected" panel above the user panel while I am in a voice channel:
 * status (with "PTT" under push to talk), the channel and Space (opens the channel),
 * Disconnect, then Camera, Screen and the soundboard. A Stage audience has no camera or screen
 * (they are for speakers).
 */
export function VoicePanel() {
  const connection = useVoice((s) => s.connection);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  useVoice((s) => s.roomVersion);
  const mine = useMyVoiceState();
  const chat = useChat(connection?.channelId);
  const space = useSpace(connection?.spaceId);
  if (!connection) return null;
  const room = getVoiceRoom();
  const camera = !!room?.localParticipant.isCameraEnabled;
  const screen = !!room?.localParticipant.isScreenShareEnabled;
  const audience = !!mine?.suppressed && mine.channelId === connection.channelId;
  const status =
    connection.status === 'connected' ? 'Voice Connected' : connection.status === 'reconnecting' ? 'Reconnecting' : 'Connecting';
  const tile = (on: boolean) =>
    cn(
      'flex h-8 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium disabled:pointer-events-none disabled:opacity-45',
      on ? 'bg-fg text-surface' : 'bg-surface-2 text-fg hover:bg-hover',
    );
  return (
    <div className="shrink-0 px-2 pt-2 pb-1" data-testid="voice-panel">
      <div className="flex items-center gap-2">
        <Signal
          size={18}
          className={cn('shrink-0', connection.status === 'connected' ? 'text-success' : 'text-warning')}
          aria-hidden
        />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="flex min-w-0 items-center gap-1.5">
            <p
              className={cn('truncate text-[14px] font-semibold', connection.status === 'connected' ? 'text-success' : 'text-warning')}
              role="status"
            >
              {status}
            </p>
            <PushToTalkBadge />
          </div>
          <Link
            to={`/spaces/${connection.spaceId}/${connection.channelId}`}
            className="block truncate text-[12px] text-muted hover:text-fg hover:underline"
          >
            {chat?.name ?? 'Voice'} / {space?.name ?? 'Space'}
          </Link>
        </div>
        <IconButton icon={PhoneOffIcon} label="Disconnect" size="sm" variant="ghost" className="text-fg hover:text-danger" onClick={() => void disconnectVoice()} />
      </div>
      {audioBlocked ? (
        <button
          type="button"
          onClick={() => void resumeVoiceAudio()}
          className="mt-2 flex w-full items-center justify-center gap-2 rounded-md bg-warning/15 py-1.5 text-[13px] font-semibold text-warning"
        >
          <Volume2 size={16} aria-hidden /> Click to hear voice
        </button>
      ) : null}
      <div className="mt-2 grid grid-cols-3 gap-2">
        <button
          type="button"
          aria-pressed={camera}
          disabled={audience}
          onClick={() => void toggleCamera()}
          className={tile(camera)}
        >
          <VideoIcon size={16} aria-hidden /> Camera
        </button>
        <button
          type="button"
          aria-pressed={screen}
          disabled={audience}
          onClick={() => void toggleScreenShare()}
          className={tile(screen)}
        >
          <MonitorUp size={16} aria-hidden /> Screen
        </button>
        <SoundboardButton />
      </div>
    </div>
  );
}
