import { useNavigate } from 'react-router';
import { Headphones, HeadphoneOff, Mic, MicOff, Settings } from 'lucide-react';
import { activePresenceNote, effectiveAvailability, type Availability } from '@enbox/shared';
import { Avatar, IconButton } from '@/components/ui';
import { selfPresenceState } from '@/features/profile/model';
import { openProfile } from '@/features/profile/open';
import { cn } from '@/lib/cn';
import { useMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { VoicePanel } from '@/features/voice/VoicePanel';

const AVAILABILITY_LABEL: Record<Availability, string> = {
  online: 'Online',
  idle: 'Idle',
  dnd: 'Do Not Disturb',
  invisible: 'Invisible',
};

/**
 * Discord's user panel at the bottom of the sidebar: the Voice Connected panel while I am in
 * voice, then my avatar + status (opens my profile card), mute / deafen (the active call or
 * voice channel follows them) and User Settings.
 */
export function UserPanel({ className }: { className?: string }) {
  const me = useMe();
  const navigate = useNavigate();
  const inCall = useCalls((s) => !!s.active);
  const callMuted = useCalls((s) => !!s.active?.audioMuted);
  const { muted: selfMuted, deafened, toggleMute, toggleDeafen } = useVoiceSelf();
  const muted = inCall ? callMuted : selfMuted || deafened;
  if (!me) return null;
  const note = activePresenceNote(me.presenceNote, Date.now());
  const status = note
    ? [note.emoji, note.text].filter(Boolean).join(' ')
    : AVAILABILITY_LABEL[effectiveAvailability(me, Date.now())];

  const onMute = () => {
    if (inCall) useCalls.getState().toggleMute();
    else toggleMute();
  };
  const onDeafen = () => {
    toggleDeafen();
    // Deafening mutes the mic too (Discord); undeafening leaves the call's mic as it was.
    if (inCall && !deafened && !callMuted) useCalls.getState().toggleMute();
  };

  return (
    <div className={cn('flex shrink-0 flex-col bg-surface-2/60', className)}>
      <VoicePanel />
      <div className="flex h-[52px] shrink-0 items-center gap-1 px-2" data-testid="user-panel">
        <button
          type="button"
          aria-label="Your profile"
          aria-haspopup="dialog"
          onClick={(e) => openProfile(me.id, e.currentTarget)}
          className="group/me flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pr-1 pl-0.5 text-left hover:bg-hover focus-visible:outline-2 focus-visible:outline-brand"
          data-testid="nav-self-avatar"
        >
          <Avatar
            src={me.avatarUrl}
            animatedSrc={me.avatarAnimatedUrl}
            name={me.displayName}
            colorSeed={me.id}
            size={32}
            presence={selfPresenceState(me)}
          />
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block truncate text-[14px] font-semibold text-fg">{me.displayName}</span>
            <span className="relative block h-4 overflow-hidden text-[12px] text-muted">
              <span className="block truncate transition-transform duration-150 group-hover/me:-translate-y-4">{status}</span>
              <span className="block truncate transition-transform duration-150 group-hover/me:-translate-y-4">@{me.username}</span>
            </span>
          </span>
        </button>
        <IconButton
          icon={muted ? MicOff : Mic}
          label={muted ? 'Unmute' : 'Mute'}
          size="sm"
          variant="ghost"
          aria-pressed={muted}
          className={cn(muted && 'text-danger')}
          onClick={onMute}
        />
        <IconButton
          icon={deafened ? HeadphoneOff : Headphones}
          label={deafened ? 'Undeafen' : 'Deafen'}
          size="sm"
          variant="ghost"
          aria-pressed={deafened}
          className={cn(deafened && 'text-danger')}
          onClick={onDeafen}
        />
        <IconButton icon={Settings} label="User Settings" size="sm" variant="ghost" onClick={() => void navigate('/settings')} />
      </div>
    </div>
  );
}
