/**
 * Minimized call: a draggable floating window (snaps to corners) so the user can keep using
 * the app. Desktop: video/avatar + name, timer and quick controls. Phones: a compact bubble
 * with the timer and an end button; tap to return to the call.
 */
import { Maximize2, Mic, MicOff } from 'lucide-react';
import { chatTitle, type ID } from '@enbox/shared';
import { PhoneOffIcon } from '@/components/icons';
import { Avatar, Portal } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { useCalls, type ActiveCall } from '@/stores/calls';
import { useChat } from '@/stores/chats';
import { LOCAL_STREAM, useCallStream, useTrackLive } from '../engine/streams';
import { joinedOthers, phaseLabel } from '../logic';
import { CALL_BG } from './CallScreen';
import { useCallDuration, useDraggable } from './hooks';
import { useParticipant } from './ParticipantTile';
import { VideoView } from './VideoView';

function useFeatured(active: ActiveCall, selfId: ID): ID | null {
  const others = joinedOthers(active.call, selfId);
  if (active.activeSpeakerId && others.some((p) => p.userId === active.activeSpeakerId)) {
    return active.activeSpeakerId;
  }
  return (
    others[0]?.userId ?? active.call.participants.find((p) => p.userId !== selfId)?.userId ?? null
  );
}

export function CallMiniWindow({ active }: { active: ActiveCall }) {
  const desktop = useIsDesktop();
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
  const drag = useDraggable<HTMLDivElement>({
    initial: desktop ? 'br' : 'tr',
    margin: 16,
    topInset: desktop ? 0 : 60,
    bottomInset: desktop ? 0 : 72,
    onTap: desktop ? undefined : expand,
  });

  const featuredP = active.call.participants.find((p) => p.userId === featured);
  const showRemote = !!featuredP && !featuredP.videoOff && remoteLive;
  const showLocal = !showRemote && localLive && !active.videoOff;
  const title = active.call.isGroup ? (chat ? chatTitle(chat) : 'Group call') : info.fullName;
  const status =
    active.phase === 'connected' || (active.phase === 'reconnecting' && duration)
      ? (duration ?? '0:00')
      : phaseLabel(active.phase, { outgoing: active.outgoing, isGroup: active.call.isGroup });

  const visual = showRemote ? (
    <VideoView stream={remoteStream} remote label={`${info.fullName} video`} />
  ) : showLocal ? (
    <VideoView stream={localStream} mirror={active.facingMode === 'user'} label="Your video" />
  ) : (
    <div className="flex size-full items-center justify-center">
      <span
        className={cn(
          'rounded-full transition-shadow',
          featured && active.speaking.includes(featured) && 'shadow-[0_0_0_3px_#a89eff]',
        )}
      >
        <Avatar
          src={info.avatarUrl}
          name={info.fullName}
          colorSeed={info.id}
          size={desktop ? 72 : 56}
        />
      </span>
    </div>
  );

  return (
    <Portal>
      <div
        ref={drag.ref}
        {...drag.handlers}
        style={drag.style}
        data-testid="call-mini"
        data-phase={active.phase}
        role="region"
        aria-label={`Call with ${title}`}
        className={cn(
          'fixed z-[45] touch-none overflow-hidden text-white shadow-2xl ring-1 ring-white/10 select-none',
          'transition-[top,left,right,bottom] duration-200 ease-out',
          CALL_BG,
          desktop ? 'w-[300px] rounded-3xl' : 'w-[124px] rounded-2xl',
          drag.dragging ? 'cursor-grabbing' : 'cursor-grab',
        )}
      >
        <div className={cn('relative', desktop ? 'aspect-video' : 'aspect-[3/4]')}>
          {visual}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-3 pt-6 pb-2">
            {desktop ? <p className="truncate text-[14px] font-semibold">{title}</p> : null}
            <p className="truncate text-[12px] text-white/80 tabular-nums">{status}</p>
          </div>
          {desktop ? (
            <button
              type="button"
              onClick={expand}
              aria-label="Return to call"
              title="Return to call"
              className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-black/40 hover:bg-black/60"
            >
              <Maximize2 size={16} aria-hidden />
            </button>
          ) : null}
        </div>
        {desktop ? (
          <div className="flex items-center justify-center gap-3 px-3 py-2.5">
            <button
              type="button"
              aria-label={active.audioMuted ? 'Unmute' : 'Mute'}
              title={active.audioMuted ? 'Unmute' : 'Mute'}
              aria-pressed={active.audioMuted}
              onClick={() => useCalls.getState().toggleMute()}
              className={cn(
                'flex size-10 items-center justify-center rounded-full',
                active.audioMuted ? 'bg-white text-[#15141c]' : 'bg-white/14 hover:bg-white/24',
              )}
            >
              {active.audioMuted ? <MicOff size={18} aria-hidden /> : <Mic size={18} aria-hidden />}
            </button>
            <button
              type="button"
              aria-label="End call"
              title="End call"
              onClick={() => useCalls.getState().leaveCall()}
              className="flex h-10 w-14 items-center justify-center rounded-full bg-[#ef4444] hover:bg-[#dc2626]"
            >
              <PhoneOffIcon size={18} aria-hidden />
            </button>
          </div>
        ) : (
          <button
            type="button"
            aria-label="End call"
            onClick={() => useCalls.getState().leaveCall()}
            className="flex h-9 w-full items-center justify-center bg-[#ef4444] hover:bg-[#dc2626]"
          >
            <PhoneOffIcon size={16} aria-hidden />
          </button>
        )}
      </div>
    </Portal>
  );
}
