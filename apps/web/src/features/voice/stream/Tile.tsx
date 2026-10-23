/**
 * A person's tile in the voice grid: their camera, else their avatar, with the speaking ring,
 * their mic state and a mute only for me; right-click opens their menu. With `onSelect` the
 * tile focuses on click (focus mode, VoiceGrid.tsx): a transparent button covers it, so the
 * tile itself never nests controls. `layout`: a grid cell, the large focused tile or a strip
 * thumbnail.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { MicOff, MonitorUp, UserRound, VolumeX } from 'lucide-react';
import { Track, type Participant } from 'livekit-client';
import { Avatar, contextMenuAnchor, type MenuAnchor } from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { SoundFlash } from '@/features/soundboard/SoundFlash';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { useVoice } from '@/stores/voice';
import { useUserAudio } from '../userAudio';
import { useVoiceUser } from '../useVoiceUser';
import { VoiceUserMenu } from '../VoiceUserMenu';

export type TileLayout = 'grid' | 'focus' | 'strip';

/** A participant's video (camera or screen), attached while it is subscribed. */
export function VideoTrack({
  participant,
  source,
  videoRef,
}: {
  participant: Participant;
  source: Track.Source;
  /** The <video> (picture-in-picture). */
  videoRef?: RefObject<HTMLVideoElement | null>;
}) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef ?? own;
  const track = participant.getTrackPublication(source)?.track;
  useEffect(() => {
    const el = ref.current;
    if (!el || !track) return;
    track.attach(el);
    return () => {
      track.detach(el);
    };
  }, [track, ref]);
  if (!track) return null;
  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      className={cn(
        'absolute inset-0 size-full bg-black',
        source === Track.Source.ScreenShare ? 'object-contain' : 'object-cover',
      )}
    />
  );
}

/** Avatar size per layout. */
const AVATAR_SIZE: Record<TileLayout, number> = { grid: 80, focus: 120, strip: 40 };

export function Tile({
  participant,
  spaceId,
  source = Track.Source.Camera,
  layout = 'grid',
  focused = false,
  onSelect,
}: {
  participant: Participant;
  spaceId: string;
  source?: Track.Source;
  layout?: TileLayout;
  /** This tile is the large one of focus mode. */
  focused?: boolean;
  /** Clicking the tile: focus it, or back to the grid when it is focused. */
  onSelect?: () => void;
}) {
  const { name, user } = useVoiceUser(spaceId, participant.identity);
  const speaking = useVoice((s) => !!s.speaking[participant.identity]);
  const state = useVoice((s) => s.byUser[participant.identity]);
  const me = useAuth((s) => s.user?.id);
  // Muted only for me (my "Mute" in their menu).
  const mutedForMe = useUserAudio(participant.identity).muted && participant.identity !== me;
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const screen = source === Track.Source.ScreenShare;
  const pub = participant.getTrackPublication(source);
  const hasVideo = !!pub?.track && !pub.isMuted;
  const muted = state ? state.selfMute || state.serverMute : !participant.isMicrophoneEnabled;
  const label = screen
    ? `${name}'s screen`
    : [name, muted && 'muted', mutedForMe && 'muted for you'].filter(Boolean).join(', ');
  const strip = layout === 'strip';
  return (
    <>
      <div
        className={cn(
          'relative flex min-w-0 items-center justify-center overflow-hidden rounded-xl bg-surface-2 ring-2 transition-shadow',
          layout === 'focus' ? 'size-full' : 'aspect-video',
          speaking && !screen ? 'ring-success' : 'ring-transparent',
        )}
        aria-label={label}
        onContextMenu={(e) => {
          e.preventDefault();
          setAnchor(contextMenuAnchor(e));
        }}
        data-testid="voice-tile"
        data-layout={layout}
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
            size={AVATAR_SIZE[layout]}
            decoration={user?.avatarDecoration}
            decorative
          />
        )}
        {onSelect ? (
          <button
            type="button"
            className="absolute inset-0 rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            aria-label={`Focus ${name}`}
            aria-pressed={focused}
            onClick={onSelect}
            data-testid="tile-focus"
          />
        ) : null}
        <span
          className={cn(
            'pointer-events-none absolute flex max-w-[80%] items-center gap-1 rounded-md bg-black/55 font-medium text-white',
            strip
              ? 'bottom-1 left-1 px-1.5 text-[11px]'
              : 'bottom-2 left-2 px-2 py-0.5 text-[13px]',
          )}
        >
          {screen ? (
            <MonitorUp size={14} aria-hidden />
          ) : muted ? (
            <MicOff size={14} aria-hidden />
          ) : null}
          {mutedForMe && !screen ? (
            <VolumeX size={14} className="text-danger" aria-hidden data-testid="muted-for-me" />
          ) : null}
          <span className="truncate">{screen ? `${name}'s screen` : name}</span>
        </span>
        {screen ? null : <SoundFlash userId={participant.identity} />}
      </div>
      <VoiceUserMenu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        userId={participant.identity}
        items={[
          {
            label: 'Profile',
            icon: UserRound,
            onSelect: () => openProfile(participant.identity, anchor, { spaceId }),
          },
        ]}
        aria-label={`${name} menu`}
      />
    </>
  );
}
