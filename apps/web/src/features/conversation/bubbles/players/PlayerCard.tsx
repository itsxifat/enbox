/**
 * A video or music link's embed (Discord's): the link preview's site, title and cached
 * thumbnail with a play button; clicking it swaps in the provider's player (players.ts) —
 * never before, so nothing loads from the provider until someone chooses to play. Videos
 * play in a 16:9 frame, Spotify and SoundCloud in their compact players. The iframe is
 * sandboxed to what the players need (scripts on their own origin, popups to open the
 * provider's site, fullscreen and picture-in-picture).
 */
import { useState } from 'react';
import { Play } from 'lucide-react';
import type { LinkPreview } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import {
  EmbedFrame,
  accentOf,
  cardClasses,
  cardStyle,
  type RemoveEmbeds,
} from '../cards/EmbedFrame';
import type { Player, PlayerProvider } from './providers';

/** The providers' brand colours: the accent bar when the page names none. */
const PROVIDER_ACCENT: Record<PlayerProvider, string> = {
  youtube: '#ff0033',
  vimeo: '#17d5ff',
  twitch: '#9146ff',
  spotify: '#1ed760',
  soundcloud: '#ff5500',
};

/** `sandbox` of player iframes: what the providers need to play, nothing of ours. */
export const PLAYER_SANDBOX =
  'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-presentation allow-forms';
export const PLAYER_ALLOW = 'autoplay; encrypted-media; picture-in-picture; fullscreen';

function PlayButton({
  label,
  onPlay,
  small,
}: {
  label: string;
  onPlay: () => void;
  small?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={(e) => {
        e.stopPropagation();
        onPlay();
      }}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-black/65 text-white shadow-lg backdrop-blur-sm transition-transform',
        'hover:scale-105 hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
        small ? 'size-10' : 'size-14',
      )}
    >
      <Play size={small ? 18 : 24} fill="currentColor" aria-hidden className="translate-x-px" />
    </button>
  );
}

function PlayerFrame({ player, title }: { player: Player; title: string }) {
  return (
    <iframe
      src={player.src}
      title={title}
      allow={PLAYER_ALLOW}
      allowFullScreen
      sandbox={PLAYER_SANDBOX}
      referrerPolicy="strict-origin-when-cross-origin"
      className="block h-full w-full border-0"
    />
  );
}

export function PlayerCard({
  player,
  preview,
  url,
  onRemove,
}: {
  player: Player;
  /** The page's preview (null: none — the card still plays). */
  preview: LinkPreview | null;
  url: string;
  onRemove?: RemoveEmbeds;
}) {
  const [playing, setPlaying] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const accent = accentOf(preview?.themeColor) ?? PROVIDER_ACCENT[player.provider];
  const image = imageFailed ? null : (preview?.image ?? null);
  const title = preview?.title ?? null;
  const name = title ?? `${player.label} ${player.kind === 'video' ? 'video' : 'player'}`;
  const playLabel = `Play ${name}`;
  const thumb = image ? (
    <img
      src={mediaUrl(image.url)}
      alt=""
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setImageFailed(true)}
      className="h-full w-full object-cover"
    />
  ) : null;

  let media;
  if (player.kind === 'video') {
    media = (
      <div className="relative mt-2 aspect-video w-full overflow-hidden rounded-md bg-black">
        {playing ? (
          <PlayerFrame player={player} title={`${player.label} player: ${name}`} />
        ) : (
          <>
            {thumb}
            <span className="absolute inset-0 flex items-center justify-center">
              <PlayButton label={playLabel} onPlay={() => setPlaying(true)} />
            </span>
          </>
        )}
      </div>
    );
  } else {
    const height = player.height ?? 152;
    media = (
      <div
        className="relative mt-2 w-full overflow-hidden rounded-md bg-black/10 dark:bg-white/[0.06]"
        style={{ height }}
      >
        {playing ? (
          <PlayerFrame player={player} title={`${player.label} player: ${name}`} />
        ) : (
          <span className="flex h-full items-center gap-3 p-3">
            <span
              className="relative aspect-square h-full max-h-32 shrink-0 overflow-hidden rounded-md bg-black/20"
              aria-hidden
            >
              {thumb}
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 text-[14px] leading-snug font-semibold text-fg">
                {name}
              </span>
              {preview?.description ? (
                <span className="mt-0.5 line-clamp-2 text-[12.5px] leading-snug text-muted">
                  {preview.description}
                </span>
              ) : null}
            </span>
            <PlayButton label={playLabel} onPlay={() => setPlaying(true)} small />
          </span>
        )}
      </div>
    );
  }

  return (
    <EmbedFrame onRemove={onRemove}>
      <div
        className={cardClasses(accent, 'w-[min(432px,72vw)] max-w-full')}
        style={cardStyle(accent)}
        data-testid="player-embed"
        data-provider={player.provider}
      >
        <span className="block truncate text-[12px] text-muted">
          {preview?.siteName ?? player.label}
        </span>
        {title ? (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="mt-0.5 line-clamp-2 block text-[14px] leading-snug font-semibold text-link hover:underline"
          >
            {title}
          </a>
        ) : null}
        {media}
      </div>
    </EmbedFrame>
  );
}
