/**
 * Full-screen in-call UI: 1:1 (remote video full-bleed + draggable local PiP, or big avatar
 * for voice), group grid (≤ 8 tiles with speaking highlight), status/timer header, banners
 * (reconnecting, poor connection, autoplay-blocked audio, muted hint) and the controls bar.
 * Always dark, like native call screens.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, MicOff, RotateCcw, UserPlus, UsersRound, WifiOff } from 'lucide-react';
import { chatTitle, type Call, type ID } from '@enbox/shared';
import { PhoneOffIcon, VideoIcon } from '@/components/icons';
import { Avatar, Spinner, useFocusTrap, useOverlay } from '@/components/ui';
import { useIsDesktop } from '@/hooks/useMediaQuery';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { useCalls, type ActiveCall } from '@/stores/calls';
import { useChat } from '@/stores/chats';
import { LOCAL_STREAM, useCallStream, useTrackLive } from '../engine/streams';
import { callKindLabel, gridColumns, hasPoorConnection, joinedOthers, phaseLabel } from '../logic';
import { CallAvatar } from './CallAvatar';
import { CallButton } from './CallButton';
import { CallControls } from './CallControls';
import { useCallDuration, useDraggable } from './hooks';
import { ParticipantTile, useParticipant } from './ParticipantTile';
import { VideoView } from './VideoView';

/** Background used by every call surface. */
export const CALL_BG =
  'bg-[#0d0c17] bg-[radial-gradient(120%_80%_at_50%_0%,#2a2168_0%,#15122b_45%,#0d0c17_100%)]';

function useCallTitle(active: ActiveCall, selfId: ID): { title: string; peerId: ID | null } {
  const chat = useChat(active.call.chatId);
  const peer = active.call.isGroup
    ? null
    : (active.call.participants.find((p) => p.userId !== selfId)?.userId ??
      (chat?.type === 'direct' ? (chat.peer?.id ?? null) : null));
  const peerInfo = useParticipant(peer ?? selfId);
  if (active.call.isGroup) return { title: chat ? chatTitle(chat) : 'Group call', peerId: null };
  return { title: peer ? peerInfo.fullName : 'Call', peerId: peer };
}

export function CallScreen({ active }: { active: ActiveCall }) {
  const me = useMe();
  const selfId = me?.id ?? '';
  const { title, peerId } = useCallTitle(active, selfId);
  const duration = useCallDuration(active.connectedAt);
  const desktop = useIsDesktop();
  const { call, phase } = active;
  const ended = phase === 'ended';

  const status =
    phase === 'connected' || (phase === 'reconnecting' && duration)
      ? (duration ?? '0:00')
      : ended
        ? (active.endReason ?? 'Call ended')
        : phaseLabel(phase, { outgoing: active.outgoing, isGroup: call.isGroup });

  const spokenStatus =
    phase === 'connected'
      ? 'Connected'
      : phase === 'reconnecting'
        ? '' // the banner below announces it
        : ended
          ? (active.endReason ?? 'Call ended')
          : phaseLabel(phase, { outgoing: active.outgoing, isGroup: call.isGroup });

  // Escape minimizes (only when no menu/dialog is open above the call: overlay stack).
  useOverlay(!ended, () => useCalls.getState().setMinimized(true));
  const root = useRef<HTMLDivElement>(null);
  useFocusTrap(root, true);
  useEffect(() => {
    if (ended) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      if ((e.key === 'm' || e.key === 'M') && !e.metaKey && !e.ctrlKey && !e.altKey) {
        useCalls.getState().toggleMute();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ended]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${callKindLabel(call)} with ${title}`}
      ref={root}
      tabIndex={-1}
      data-testid="call-screen"
      data-phase={phase}
      data-call-id={call.id || undefined}
      className={cn(
        'fixed inset-0 z-[45] flex animate-fade-in flex-col text-white outline-none px-safe',
        CALL_BG,
      )}
    >
      {ended ? (
        <EndedView active={active} title={title} peerId={peerId} />
      ) : call.isGroup ? (
        <GroupStage active={active} selfId={selfId} desktop={desktop} />
      ) : (
        <OneToOneStage active={active} peerId={peerId} />
      )}

      {!ended ? (
        <>
          <header className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/55 via-black/20 to-transparent pt-safe">
            <div className="pointer-events-auto flex h-16 items-center gap-2 px-2 sm:px-4">
              <CallButton
                icon={ChevronDown}
                label="Minimize call"
                size="md"
                tone="ghost"
                onClick={() => useCalls.getState().setMinimized(true)}
              />
              <div className="min-w-0 flex-1 text-center">
                <h2 className="truncate text-[17px] font-semibold tracking-tight">{title}</h2>
                <p
                  className="truncate text-[13px] text-white/75 tabular-nums"
                  data-testid={phase === 'connected' ? 'call-timer' : 'call-status'}
                  role={duration ? 'timer' : undefined}
                >
                  {status}
                </p>
                {/* Announce phase changes only: the ticking timer above is not a live region. */}
                <span className="sr-only" aria-live="polite">
                  {spokenStatus}
                </span>
              </div>
              {call.isGroup ? (
                <div className="flex items-center">
                  <span
                    className="hidden items-center gap-1 pr-1 text-[13px] text-white/80 sm:flex"
                    aria-label={`${joinedOthers(call, selfId).length + 1} in the call`}
                  >
                    <UsersRound size={16} aria-hidden />
                    {joinedOthers(call, selfId).length + 1}
                  </span>
                  <CallButton
                    icon={UserPlus}
                    label="Add participant"
                    size="md"
                    tone="ghost"
                    disabled={!call.id || phase === 'starting'}
                    onClick={() =>
                      useCalls
                        .getState()
                        .openPicker({ chatId: call.chatId, type: call.type, mode: 'invite' })
                    }
                  />
                </div>
              ) : (
                <span className="w-12" aria-hidden />
              )}
            </div>
            <Banners active={active} selfId={selfId} />
          </header>
          <CallControls active={active} />
        </>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function Banners({ active, selfId }: { active: ActiveCall; selfId: ID }) {
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

  const pill =
    'pointer-events-auto flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[13px] font-medium shadow-lg backdrop-blur-md';
  return (
    <div className="flex flex-col items-center gap-2 px-4" aria-live="polite">
      {active.phase === 'reconnecting' ? (
        <span className={cn(pill, 'bg-amber-500/90 text-black')}>
          <Spinner size={14} label={null} /> Reconnecting…
        </span>
      ) : poor ? (
        <span className={cn(pill, 'bg-amber-500/85 text-black')}>
          <WifiOff size={14} aria-hidden /> Poor connection
        </span>
      ) : null}
      {active.audioBlocked ? (
        <button
          type="button"
          className={cn(pill, 'bg-white text-[#15141c] hover:bg-white/90')}
          onClick={() => useCalls.getState().resumeAudio()}
        >
          Tap to hear the call
        </button>
      ) : null}
      {mutedTalking ? (
        <span className={cn(pill, 'bg-black/55 text-white')}>
          <MicOff size={14} aria-hidden /> You're muted
        </span>
      ) : null}
      {mediaErrorShown ? (
        <span className={cn(pill, 'bg-black/60 text-white')}>{mediaErrorShown}</span>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------

function PulsingAvatar({
  userId,
  size,
  pulse,
  speaking,
}: {
  userId: ID;
  size: number;
  pulse: boolean;
  speaking: boolean;
}) {
  const info = useParticipant(userId);
  return (
    <span className="relative inline-flex">
      {pulse ? (
        <>
          <span
            className="absolute inset-0 animate-ping rounded-full bg-violet-400/20 [animation-duration:2.2s]"
            aria-hidden
          />
          <span className="absolute -inset-6 rounded-full border border-white/10" aria-hidden />
          <span className="absolute -inset-12 rounded-full border border-white/5" aria-hidden />
        </>
      ) : null}
      <span
        className={cn(
          'relative rounded-full transition-shadow duration-300',
          speaking && 'shadow-[0_0_0_4px_rgba(168,158,255,0.9),0_0_40px_6px_rgba(139,125,255,0.5)]',
        )}
      >
        <Avatar src={info.avatarUrl} name={info.fullName} colorSeed={info.id} size={size} />
      </span>
    </span>
  );
}

function OneToOneStage({ active, peerId }: { active: ActiveCall; peerId: ID | null }) {
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

  const pip = useDraggable<HTMLDivElement>({
    initial: 'br',
    margin: 16,
    bottomInset: 108,
    topInset: 64,
    onTap: () => setSwapped((s) => !s),
  });

  const avatarView = (
    <div className="flex flex-1 items-center justify-center pb-24">
      {peerId ? (
        <PulsingAvatar
          userId={peerId}
          size={144}
          pulse={ringing}
          speaking={active.speaking.includes(peerId) && !remote?.audioMuted}
        />
      ) : null}
    </div>
  );

  const remoteView = (
    <VideoView
      stream={remoteStream}
      remote
      fit={remote?.screenSharing ? 'contain' : 'cover'}
      label="Remote video"
    />
  );
  const localView = (
    <VideoView
      stream={localStream}
      mirror={mirrorLocal}
      fit={active.screenSharing ? 'contain' : 'cover'}
      label="Your video"
    />
  );

  let main: React.ReactNode;
  let small: React.ReactNode = null;
  if (remoteVideo) {
    main = swapped && localVideo ? localView : remoteView;
    small = localVideo ? (swapped ? remoteView : localView) : null;
  } else if (localVideo && ringing) {
    // Outgoing video call: my camera full screen behind the ringing avatar.
    main = (
      <div className="relative flex flex-1">
        <div className="absolute inset-0 opacity-60">{localView}</div>
        <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-transparent to-black/60" />
        <div className="relative flex flex-1">{avatarView}</div>
      </div>
    );
  } else {
    main = avatarView;
    small = localVideo ? localView : null;
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="absolute inset-0 flex">{main}</div>
      {remote?.audioMuted && remote.status === 'joined' ? (
        <span className="absolute top-[calc(env(safe-area-inset-top)+76px)] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-black/45 px-3 py-1 text-[12px] backdrop-blur">
          <MicOff size={14} aria-hidden /> Muted
        </span>
      ) : null}
      {small ? (
        <div
          ref={pip.ref}
          {...pip.handlers}
          style={pip.style}
          data-testid="call-pip"
          aria-label="Switch video views"
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              setSwapped((s) => !s);
            }
          }}
          className={cn(
            'absolute z-20 aspect-[3/4] w-[28vw] max-w-[180px] min-w-[96px] cursor-grab touch-none overflow-hidden rounded-2xl shadow-2xl ring-1 ring-white/15 sm:w-[200px] sm:max-w-[220px]',
            'transition-[top,left,right,bottom] duration-200 ease-out',
            pip.dragging && 'cursor-grabbing',
          )}
        >
          {small}
        </div>
      ) : null}
    </div>
  );
}

function GroupStage({
  active,
  selfId,
  desktop,
}: {
  active: ActiveCall;
  selfId: ID;
  desktop: boolean;
}) {
  const tiles = useMemo(() => {
    const parts = active.call.participants.filter(
      (p) => p.status === 'joined' || p.status === 'invited' || p.status === 'ringing',
    );
    const mine = parts.find((p) => p.userId === selfId);
    const others = parts.filter((p) => p.userId !== selfId);
    // Joined first, then ringing; me last on phones (bottom-right), first on desktop.
    others.sort((a, b) => Number(b.status === 'joined') - Number(a.status === 'joined'));
    const me = mine ?? {
      userId: selfId,
      status: 'joined' as const,
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

  const wide = desktop || (typeof window !== 'undefined' && window.innerWidth > window.innerHeight);
  const cols = gridColumns(tiles.length, wide);
  const rows = Math.ceil(tiles.length / cols);
  const compact = tiles.length > 4;

  return (
    <div className="flex min-h-0 flex-1 flex-col px-2 pt-[calc(env(safe-area-inset-top)+68px)] pb-[calc(env(safe-area-inset-bottom)+104px)] sm:px-4">
      <div
        className="mx-auto grid size-full max-w-6xl gap-2 sm:gap-3"
        style={{
          gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
        }}
      >
        {tiles.map((p) => (
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
            className={cn(
              tiles.length === 3 && cols === 2 && p.userId === tiles[0]!.userId && 'col-span-2',
            )}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function EndedView({
  active,
  title,
  peerId,
}: {
  active: ActiveCall;
  title: string;
  peerId: ID | null;
}) {
  const call: Call = active.call;
  const retry =
    active.outgoing && !call.isGroup && (call.status === 'missed' || call.status === 'declined');
  const duration = call.durationSec
    ? `${Math.floor(call.durationSec / 60)}:${String(call.durationSec % 60).padStart(2, '0')}`
    : null;
  const chat = useChat(call.chatId);
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-5 px-6 pb-safe text-center">
      {peerId ? (
        <PulsingAvatar userId={peerId} size={120} pulse={false} speaking={false} />
      ) : chat ? (
        <CallAvatar src={chat.avatarUrl} name={chatTitle(chat)} seed={chat.id} group size={120} />
      ) : null}
      <div>
        <h2 className="text-[22px] font-semibold tracking-tight">{title}</h2>
        <p className="mt-1 text-[15px] text-white/75" data-testid="call-end-reason">
          {active.endReason ?? 'Call ended'}
          {duration && call.status === 'ended' ? ` · ${duration}` : ''}
        </p>
      </div>
      {retry ? (
        <div className="mt-6 flex items-start gap-10">
          <CallButton
            icon={PhoneOffIcon}
            label="Close"
            caption="Close"
            tone="glass"
            size="xl"
            onClick={() => useCalls.getState().leaveCall()}
          />
          <CallButton
            icon={call.type === 'video' ? VideoIcon : RotateCcw}
            label="Call again"
            caption="Call again"
            tone="success"
            size="xl"
            onClick={() => void useCalls.getState().startCall(call.chatId, call.type)}
          />
        </div>
      ) : null}
    </div>
  );
}
