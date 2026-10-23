/**
 * The embeds under a text message (Discord's), one per link it embeds (`embedLinks`: up to
 * MAX_EMBEDS_PER_MESSAGE, not code, spoilers or `<links>`):
 * - a page: a card with an accent bar in the site's theme colour, site, title, description,
 *   then a wide image below or a square one beside (`GET /api/link-preview`);
 * - a direct image link: the picture inline (cards/ImageLinkEmbed);
 * - a YouTube, Vimeo, Twitch, Spotify or SoundCloud link: the preview with a play button
 *   that swaps in the provider's player, on click only (players/PlayerCard);
 * - a video file: a card with "Open video" (nothing is fetched for it);
 * - a link to this app: a message card (cards/MessageLinkCard) or an invite card
 *   (cards/InviteCard); other pages of the app get none.
 *
 * Nothing renders while loading, for links without a preview, when the device pref
 * `linkPreviews` is off (Settings → Chats), or when the message has SUPPRESS_EMBEDS. With the
 * message and its chat, its author (or MANAGE_MESSAGES in a Space channel) gets the X that
 * removes all of them for everyone.
 */
import { memo, useCallback, useMemo, useState } from 'react';
import { MESSAGE_FLAGS, hasMessageFlag, type ChatSummary, type LinkPreview } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useAuth } from '@/stores/auth';
import type { ClientMessage } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { embedLinks, useLinkPreview } from '../lib/linkPreview';
import {
  EmbedFrame,
  accentOf,
  cardClasses,
  cardStyle,
  useGrowNotice,
  type RemoveEmbeds,
} from './cards/EmbedFrame';
import { canRemoveEmbeds, removeEmbeds } from './cards/embedActions';
import { ImageLinkEmbed, isImageOnly } from './cards/ImageLinkEmbed';
import { internalLinkOf } from './cards/internalLinks';
import { InviteCard } from './cards/InviteCard';
import { MessageLinkCard } from './cards/MessageLinkCard';
import { VideoLinkCard } from './cards/VideoLinkCard';
import { PlayerCard } from './players/PlayerCard';
import { playerOf, videoFileOf, type Player } from './players/providers';

/** Wide images go full width under the text; small or squarish ones become a thumbnail. */
function isWide(image: NonNullable<LinkPreview['image']>): boolean {
  return image.width >= 400 && image.width / image.height >= 1.25;
}

function PageCard({ preview, onRemove }: { preview: LinkPreview; onRemove?: RemoveEmbeds }) {
  const [imageFailed, setImageFailed] = useState(false);
  const image = imageFailed ? null : preview.image;
  const wide = image ? isWide(image) : false;
  const accent = accentOf(preview.themeColor);
  const img = image ? (
    <img
      src={mediaUrl(image.url)}
      alt=""
      width={image.width}
      height={image.height}
      loading="lazy"
      decoding="async"
      draggable={false}
      onError={() => setImageFailed(true)}
      className={cn(
        'bg-black/5 object-cover dark:bg-white/5',
        wide ? 'mt-2 max-h-56 w-full rounded-md' : 'size-16 shrink-0 rounded-md',
      )}
      style={wide ? { aspectRatio: `${image.width} / ${image.height}` } : undefined}
    />
  ) : null;
  return (
    <EmbedFrame onRemove={onRemove}>
      <a
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={preview.url}
        data-testid="link-embed"
        className={cardClasses(
          accent,
          'w-[min(340px,62vw)] max-w-full no-underline transition-colors hover:bg-black/[0.07] focus-visible:outline-2 focus-visible:outline-brand dark:hover:bg-white/[0.08]',
        )}
        style={cardStyle(accent)}
      >
        <span className="flex gap-2.5">
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] text-muted">
              {preview.siteName ?? preview.domain}
            </span>
            {preview.title ? (
              <span className="mt-0.5 line-clamp-2 block text-[14px] leading-snug font-semibold text-brand-ink">
                {preview.title}
              </span>
            ) : null}
            {preview.description ? (
              <span className="mt-0.5 line-clamp-3 block text-[13px] leading-snug text-fg/80">
                {preview.description}
              </span>
            ) : null}
          </span>
          {img && !wide ? img : null}
        </span>
        {img && wide ? img : null}
      </a>
    </EmbedFrame>
  );
}

/** A page, image or player link: needs the server's preview (players play without one). */
function PreviewEmbed({
  url,
  player,
  onRemove,
}: {
  url: string;
  player: Player | null;
  onRemove?: RemoveEmbeds;
}) {
  const preview = useLinkPreview(url);
  const shown = player ? preview !== undefined : !!preview;
  useGrowNotice(shown);
  if (player)
    return preview === undefined ? null : (
      <PlayerCard player={player} preview={preview} url={url} onRemove={onRemove} />
    );
  if (!preview) return null;
  if (isImageOnly(preview)) return <ImageLinkEmbed preview={preview} onRemove={onRemove} />;
  return <PageCard preview={preview} onRemove={onRemove} />;
}

function LinkEmbed({ url, onRemove }: { url: string; onRemove?: RemoveEmbeds }) {
  // Cheap URL checks; not memoised, as the public origin may only be known after a render.
  const internal = internalLinkOf(url);
  const player = internal ? null : playerOf(url);
  const videoFile = internal || player ? null : videoFileOf(url);
  if (internal?.kind === 'message') return <MessageLinkCard link={internal} onRemove={onRemove} />;
  if (internal?.kind === 'invite') return <InviteCard link={internal} onRemove={onRemove} />;
  if (internal) return null;
  if (videoFile) return <VideoLinkCard url={url} fileName={videoFile} onRemove={onRemove} />;
  return <PreviewEmbed url={url} player={player} onRemove={onRemove} />;
}

/** The embeds of the links in `text`; pass the message and its chat for flags and the X. */
export const LinkPreviewCard = memo(function LinkPreviewCard({
  text,
  message,
  chat,
}: {
  text: string | null;
  message?: ClientMessage;
  chat?: ChatSummary;
}) {
  const enabled = useUi((s) => s.prefs.linkPreviews);
  const me = useAuth((s) => s.user?.id);
  const suppressed = hasMessageFlag(message?.flags, MESSAGE_FLAGS.SUPPRESS_EMBEDS);
  const links = useMemo(
    () => (enabled && !suppressed ? embedLinks(text) : []),
    [enabled, suppressed, text],
  );
  const removable = !!message && !!chat && canRemoveEmbeds(chat, message, me);
  const onRemove = useCallback<RemoveEmbeds>(
    ({ shift }) => {
      if (message && chat) void removeEmbeds(chat, message, { shift });
    },
    [chat, message],
  );
  if (!links.length) return null;
  return (
    <>
      {links.map((url) => (
        <LinkEmbed key={url} url={url} onRemove={removable ? onRemove : undefined} />
      ))}
    </>
  );
});
