/**
 * A sticker message (`Message.sticker`: an `image` message whose media is the sticker's
 * picture): the picture at 160×160, object-contain, with no frame and no viewer; its alt is
 * the sticker's name. An animated one follows the device pref like animated emoji (playing
 * while its message row is hovered on 'hover', StickerImage.tsx), its poster standing in
 * meanwhile. A click opens a small popout: the sticker large, its name, the description when
 * known and, when I am in its Space, "From <Space>" with the Space's icon.
 */
import { useRef, useState, type ReactNode } from 'react';
import type { MessageStickerRef } from '@enbox/shared';
import { Popover } from '@/components/ui';
import { SpaceIcon } from '@/features/spaces/community/SpaceIcon';
import type { ClientMessage } from '@/stores/messages';
import { useSpaces } from '@/stores/spaces';
import { findSticker, useStickers } from '@/stores/stickers';
import { StickerImage, useStickerPlayback } from './StickerImage';

export const STICKER_SIZE = 160;

export function StickerBody({ m, meta }: { m: ClientMessage; meta?: ReactNode }) {
  const sticker = m.sticker!;
  const media = m.media;
  const ref = useRef<HTMLButtonElement>(null);
  const animated = !!media && (media.animated || media.mimeType === 'image/gif');
  const playing = useStickerPlayback(ref, animated, 'row');
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="flex flex-col items-start" data-testid="sticker-body">
      <button
        ref={ref}
        type="button"
        title={sticker.name}
        aria-haspopup="dialog"
        aria-expanded={!!anchor}
        onClick={(e) => {
          e.stopPropagation();
          if (!m.pending && !m.failed) setAnchor(anchor ? null : e.currentTarget);
        }}
        className="block rounded-lg outline-none focus-visible:outline-2 focus-visible:outline-brand"
      >
        {media ? (
          <StickerImage
            url={media.url}
            stillUrl={media.thumbnailUrl}
            animated={animated}
            playing={playing}
            alt={sticker.name}
            size={STICKER_SIZE}
          />
        ) : (
          <span className="block px-2 py-1 text-chat text-muted italic">{sticker.name}</span>
        )}
      </button>
      {meta ? <div className="flex w-full justify-end px-1.5 pt-0.5 pb-1">{meta}</div> : null}
      {anchor ? (
        <StickerPopout
          sticker={sticker}
          url={media?.url ?? null}
          stillUrl={media?.thumbnailUrl ?? null}
          animated={animated}
          anchor={anchor}
          onClose={() => setAnchor(null)}
        />
      ) : null}
    </div>
  );
}

function StickerPopout({
  sticker,
  url,
  stillUrl,
  animated,
  anchor,
  onClose,
}: {
  sticker: MessageStickerRef;
  url: string | null;
  stillUrl: string | null;
  animated: boolean;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const playing = useStickerPlayback(ref, animated, 'open');
  const space = useSpaces((s) => (sticker.spaceId ? s.byId[sticker.spaceId] : undefined));
  const description = useStickers(
    (s) => findSticker(s, sticker.id, sticker.spaceId)?.description ?? null,
  );
  return (
    <Popover
      open
      anchor={anchor}
      onClose={onClose}
      placement="right"
      align="start"
      aria-label={`Sticker: ${sticker.name}`}
    >
      <div
        ref={ref}
        className="flex w-64 flex-col items-center gap-3 p-4"
        data-testid="sticker-popout"
      >
        {url ? (
          <StickerImage
            url={url}
            stillUrl={stillUrl}
            animated={animated}
            playing={playing}
            alt={sticker.name}
            size={208}
          />
        ) : null}
        <div className="w-full min-w-0 text-center">
          <p className="truncate text-[16px] font-bold">{sticker.name}</p>
          {description ? <p className="mt-0.5 text-[13px] text-muted">{description}</p> : null}
        </div>
        {space ? (
          <div className="flex w-full min-w-0 items-center gap-2.5 rounded-xl bg-surface-2 px-3 py-2">
            <SpaceIcon name={space.name} iconUrl={space.iconUrl} size={32} />
            <p className="min-w-0 truncate text-[13px] text-muted">
              From <span className="font-semibold text-fg">{space.name}</span>
            </p>
          </div>
        ) : null}
      </div>
    </Popover>
  );
}
