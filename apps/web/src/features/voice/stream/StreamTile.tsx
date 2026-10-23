/**
 * A stream tile (someone's shared screen) in the voice grid — Discord's Go Live tile:
 * - someone else's stream, not watched: their avatar, LIVE and Watch Stream (subscribes to the
 *   screen and its audio; the stream comes into focus). Nothing of it is downloaded before;
 * - watched: the video, and on hover Stop Watching, picture-in-picture and fullscreen;
 * - mine: a local preview with how many watch, and Stop Streaming instead.
 * Clicking the tile focuses it (VoiceGrid.tsx): a transparent button covers it for that, and
 * the controls sit above it. Right-click: their menu (profile, watch, their volume).
 */
import { useRef, useState, type ReactNode } from 'react';
import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
  MonitorUp,
  PictureInPicture2,
  ScreenShareOff,
  UserRound,
} from 'lucide-react';
import { Track, type Participant } from 'livekit-client';
import {
  Avatar,
  Button,
  IconButton,
  Spinner,
  contextMenuAnchor,
  type MenuAnchor,
} from '@/components/ui';
import { openProfile } from '@/features/profile/open';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import { toggleScreenShare } from '../engine';
import { useVoiceUser } from '../useVoiceUser';
import { VoiceUserMenu } from '../VoiceUserMenu';
import { LivePill } from './LivePill';
import {
  pictureInPictureSupported,
  togglePictureInPicture,
  usePictureInPictureElement,
} from './media';
import { useStreams, useViewerCount } from './store';
import { VideoTrack, type TileLayout } from './Tile';

export function StreamTile({
  participant,
  spaceId,
  layout = 'grid',
  focused = false,
  fullscreen = false,
  onSelect,
  onFullscreen,
}: {
  participant: Participant;
  spaceId: string;
  layout?: TileLayout;
  /** This tile is the large one of focus mode. */
  focused?: boolean;
  /** Its focus area is shown fullscreen. */
  fullscreen?: boolean;
  /** Clicking the tile: focus it, or back to the grid when it is focused. */
  onSelect?: () => void;
  /** The fullscreen button (none: no button). */
  onFullscreen?: () => void;
}) {
  const identity = participant.identity;
  const { name, user } = useVoiceUser(spaceId, identity);
  const me = useAuth((s) => s.user?.id);
  const own = identity === me;
  const watching = useStreams((s) => !!s.watching[identity]);
  const viewers = useViewerCount(identity);
  const pipElement = usePictureInPictureElement();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  const track = participant.getTrackPublication(Track.Source.ScreenShare)?.track;
  const shown = own || watching;
  const playing = shown && !!track;
  const strip = layout === 'strip';
  const inPip = !!pipElement && pipElement === videoRef.current;
  const { watch, stopWatching } = useStreams.getState();

  let body: ReactNode;
  if (playing)
    body = (
      <VideoTrack participant={participant} source={Track.Source.ScreenShare} videoRef={videoRef} />
    );
  else if (shown)
    body = (
      <div className="flex flex-col items-center gap-2 text-[13px] text-white/80">
        <Spinner
          size={strip ? 16 : 24}
          label={own ? 'Starting your stream' : 'Loading the stream'}
        />
        {strip ? null : own ? 'Starting your stream…' : 'Loading the stream…'}
      </div>
    );
  else
    body = (
      <div className="flex flex-col items-center gap-2 px-3 text-center">
        {strip ? null : (
          <Avatar
            src={user?.avatarUrl}
            animatedSrc={user?.avatarAnimatedUrl}
            name={name}
            colorSeed={identity}
            size={layout === 'focus' ? 96 : 56}
            decorative
          />
        )}
        {strip ? null : (
          <p className="max-w-full truncate text-[14px] font-semibold text-white">{name} is live</p>
        )}
        <Button
          size="sm"
          leftIcon={Eye}
          className="relative z-[2]"
          onClick={() => watch(identity)}
          data-testid="watch-stream"
        >
          Watch Stream
        </Button>
      </div>
    );

  return (
    <>
      <div
        className={cn(
          'group/stream relative flex min-w-0 items-center justify-center overflow-hidden rounded-xl bg-neutral-900',
          layout === 'focus' ? 'size-full' : 'aspect-video',
        )}
        aria-label={`${name}'s stream`}
        onContextMenu={(e) => {
          e.preventDefault();
          setAnchor(contextMenuAnchor(e));
        }}
        data-testid="stream-tile"
        data-layout={layout}
        data-watching={watching || undefined}
      >
        {body}
        {onSelect ? (
          <button
            type="button"
            className="absolute inset-0 z-[1] rounded-xl focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand"
            aria-label={`Focus ${name}'s stream`}
            aria-pressed={focused}
            onClick={onSelect}
            data-testid="tile-focus"
          />
        ) : null}
        <span
          className={cn(
            'pointer-events-none absolute z-[2] flex items-center gap-1.5',
            strip ? 'top-1 left-1' : 'top-2 left-2',
          )}
        >
          <LivePill />
          {viewers > 0 ? (
            <span
              className="flex items-center gap-1 rounded bg-black/55 px-1.5 text-[11px] leading-4 font-semibold text-white"
              aria-label={`${viewers} watching`}
              title={`${viewers} watching`}
              data-testid="stream-viewers"
            >
              <Eye size={12} aria-hidden /> {viewers}
              {own && !strip ? ' watching' : null}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            'pointer-events-none absolute z-[2] flex max-w-[60%] items-center gap-1 rounded-md bg-black/55 font-medium text-white',
            strip
              ? 'bottom-1 left-1 px-1.5 text-[11px]'
              : 'bottom-2 left-2 px-2 py-0.5 text-[13px]',
          )}
        >
          <MonitorUp size={14} aria-hidden />
          <span className="truncate">{name}</span>
        </span>
        {strip || !shown ? null : (
          <div
            className="absolute right-2 bottom-2 z-[2] flex items-center gap-1.5 opacity-0 transition-opacity group-focus-within/stream:opacity-100 group-hover/stream:opacity-100 pointer-coarse:opacity-100"
            role="toolbar"
            aria-label="Stream controls"
          >
            {own ? (
              <IconButton
                icon={ScreenShareOff}
                label="Stop Streaming"
                variant="glass"
                size="sm"
                onClick={() => void toggleScreenShare()}
              />
            ) : (
              <IconButton
                icon={EyeOff}
                label="Stop Watching"
                variant="glass"
                size="sm"
                onClick={() => stopWatching(identity)}
                data-testid="stop-watching"
              />
            )}
            {playing && pictureInPictureSupported() ? (
              <IconButton
                icon={PictureInPicture2}
                label={inPip ? 'Exit picture-in-picture' : 'Picture-in-picture'}
                variant="glass"
                size="sm"
                active={inPip}
                onClick={() => void togglePictureInPicture(videoRef.current)}
              />
            ) : null}
            {onFullscreen ? (
              <IconButton
                icon={fullscreen ? Minimize2 : Maximize2}
                label={fullscreen ? 'Exit full screen' : 'Full screen'}
                variant="glass"
                size="sm"
                onClick={onFullscreen}
              />
            ) : null}
          </div>
        )}
      </div>
      <VoiceUserMenu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        userId={identity}
        items={[
          {
            label: 'Profile',
            icon: UserRound,
            onSelect: () => openProfile(identity, anchor, { spaceId }),
          },
          ...(own
            ? []
            : [
                watching
                  ? { label: 'Stop Watching', icon: EyeOff, onSelect: () => stopWatching(identity) }
                  : { label: 'Watch Stream', icon: Eye, onSelect: () => watch(identity) },
              ]),
        ]}
        aria-label={`${name}'s stream menu`}
      />
    </>
  );
}
