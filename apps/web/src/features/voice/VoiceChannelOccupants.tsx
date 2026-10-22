import { useEffect } from 'react';
import { HeadphoneOff, MicOff } from 'lucide-react';
import { VideoIcon } from '@/components/icons';
import { userDisplayName, type ChatSummary, type VoiceState } from '@enbox/shared';
import { Avatar } from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { cn } from '@/lib/cn';
import { useSpaceAuthor } from '@/stores/spaces';
import { useUser } from '@/stores/users';
import { useVoice, useVoiceChannelStates } from '@/stores/voice';

function Occupant({ state, speaking }: { state: VoiceState; speaking: boolean }) {
  const user = useUser(state.userId);
  const author = useSpaceAuthor(state.spaceId, state.userId);
  const name = author?.nickname || userDisplayName(user);
  const muted = state.selfMute || state.serverMute;
  const deaf = state.selfDeaf || state.serverDeaf;
  const label = [name, muted && 'muted', deaf && 'deafened', state.selfVideo && 'camera on', state.selfStream && 'live'].filter(Boolean).join(', ');
  return (
    <li>
      <button
        type="button"
        onClick={(e) => openProfile(state.userId, e.currentTarget, { spaceId: state.spaceId })}
        aria-label={label}
        className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-[14px] text-muted hover:bg-hover hover:text-fg"
        data-testid="voice-occupant"
      >
        <span className={cn('shrink-0 rounded-full ring-2 transition-shadow', speaking ? 'ring-success' : 'ring-transparent')}>
          <Avatar src={user?.avatarUrl} name={name} colorSeed={state.userId} size={24} decorative />
        </span>
        <span className={cn('min-w-0 flex-1 truncate', speaking && 'text-fg')}>{name}</span>
        {state.selfStream ? (
          <span className="shrink-0 rounded bg-danger px-1 text-[10px] leading-4 font-bold text-white">LIVE</span>
        ) : null}
        {state.selfVideo ? <VideoIcon size={15} className="shrink-0" aria-hidden /> : null}
        {muted ? <MicOff size={15} className={cn('shrink-0', state.serverMute && 'text-danger')} aria-hidden /> : null}
        {deaf ? <HeadphoneOff size={15} className={cn('shrink-0', state.serverDeaf && 'text-danger')} aria-hidden /> : null}
      </button>
    </li>
  );
}

/** Who is in a voice channel, listed under its row in the channel sidebar (Discord). */
export function VoiceChannelOccupants({ chat }: { chat: ChatSummary }) {
  const spaceId = chat.space?.spaceId;
  useEffect(() => {
    if (spaceId)
      void useVoice
        .getState()
        .loadSpace(spaceId)
        .catch(() => undefined);
  }, [spaceId]);
  const states = useVoiceChannelStates(chat.id);
  const speaking = useVoice((s) => s.speaking);
  if (!states.length) return null;
  return (
    <ul className="mb-1 flex flex-col pr-2 pl-7" aria-label={`In ${chat.name ?? 'voice'}`}>
      {states.map((v) => (
        <Occupant key={v.userId} state={v} speaking={!!speaking[v.userId]} />
      ))}
    </ul>
  );
}
