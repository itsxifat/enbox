import { Link } from 'react-router';
import { MonitorUp, Signal, Volume2 } from 'lucide-react';
import { PhoneOffIcon, VideoIcon } from '@/components/icons';
import { IconButton } from '@/components/ui';
import { cn } from '@/lib/cn';
import { useChat } from '@/stores/chats';
import { useSpace } from '@/stores/spaces';
import { useVoice } from '@/stores/voice';
import { disconnectVoice, getVoiceRoom, resumeVoiceAudio, toggleCamera, toggleScreenShare } from './engine';

/**
 * Discord's "Voice Connected" panel above the user panel while I am in a voice channel:
 * status, the channel and Space (opens the channel), Disconnect, then Camera and Screen.
 */
export function VoicePanel() {
  const connection = useVoice((s) => s.connection);
  const audioBlocked = useVoice((s) => s.audioBlocked);
  useVoice((s) => s.roomVersion);
  const chat = useChat(connection?.channelId);
  const space = useSpace(connection?.spaceId);
  if (!connection) return null;
  const room = getVoiceRoom();
  const camera = !!room?.localParticipant.isCameraEnabled;
  const screen = !!room?.localParticipant.isScreenShareEnabled;
  const status =
    connection.status === 'connected' ? 'Voice Connected' : connection.status === 'reconnecting' ? 'Reconnecting' : 'Connecting';
  return (
    <div className="shrink-0 px-2 pt-2 pb-1" data-testid="voice-panel">
      <div className="flex items-center gap-2">
        <Signal
          size={18}
          className={cn('shrink-0', connection.status === 'connected' ? 'text-success' : 'text-warning')}
          aria-hidden
        />
        <div className="min-w-0 flex-1 leading-tight">
          <p
            className={cn('truncate text-[14px] font-semibold', connection.status === 'connected' ? 'text-success' : 'text-warning')}
            role="status"
          >
            {status}
          </p>
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
      <div className="mt-2 grid grid-cols-2 gap-2">
        <button
          type="button"
          aria-pressed={camera}
          onClick={() => void toggleCamera()}
          className={cn('flex h-8 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium', camera ? 'bg-fg text-surface' : 'bg-surface-2 text-fg hover:bg-hover')}
        >
          <VideoIcon size={16} aria-hidden /> Camera
        </button>
        <button
          type="button"
          aria-pressed={screen}
          onClick={() => void toggleScreenShare()}
          className={cn('flex h-8 items-center justify-center gap-1.5 rounded-md text-[13px] font-medium', screen ? 'bg-fg text-surface' : 'bg-surface-2 text-fg hover:bg-hover')}
        >
          <MonitorUp size={16} aria-hidden /> Screen
        </button>
      </div>
    </div>
  );
}
