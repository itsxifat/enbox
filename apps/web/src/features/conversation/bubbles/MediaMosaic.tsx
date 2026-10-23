/**
 * The photos and videos of a message with several files, as a mosaic (Discord): laid out by
 * count (`mosaicLayout`: two halves, one large + two stacked, 2×2 … 1 + 3×3), rounded outer
 * corners and 4 px gaps, every tile cropped to fill. Videos show their poster with a play
 * badge; animated images their poster with a GIF badge, playing on hover where the device
 * allows (the same gate as a single one: `useAnimationGate`); spoilers stay blurred until
 * clicked, each on its own. Alt text is the tile's `alt`, plus an ALT chip that shows it. A tile
 * opens the viewer on its file. Small tiles load the thumbnail, large ones the file itself.
 */
import { useState, type CSSProperties, type ReactNode } from 'react';
import { ImageOff, Play } from 'lucide-react';
import { formatDuration, type MessageAttachment } from '@enbox/shared';
import { Popover } from '@/components/ui';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ClientMessage } from '@/stores/messages';
import { useUi, type AutoplayAnimatedMedia } from '@/stores/ui';
import { isSpoilerName } from '../dropzone/files';
import { layoutLabel, mosaicLayout } from './attachments';

/** Width of a mosaic (it shrinks with the bubble). */
export const MOSAIC_W = 400;

/**
 * Whether animated images may play: the device pref (`autoplayAnimatedMedia`), reduced motion
 * and a visible app. 'hover' plays them while hovered (or after a first tap).
 */
export function useAnimationGate(): { autoplay: AutoplayAnimatedMedia; allowed: boolean } {
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const reduceMotion = useReducedMotion();
  const appVisible = useAppVisible();
  return { autoplay, allowed: autoplay !== 'never' && !reduceMotion && appVisible };
}

/** The "ALT" chip of a photo or video with alt text: a click shows the text. */
export function AltChip({ text, className }: { text: string; className?: string }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        aria-label="Show alt text"
        aria-expanded={!!anchor}
        onClick={(e) => {
          e.stopPropagation();
          setAnchor(anchor ? null : e.currentTarget);
        }}
        className={cn(
          'absolute bottom-1.5 left-1.5 rounded-[4px] bg-black/60 px-1 text-[10px] leading-4 font-bold tracking-wide text-white backdrop-blur-sm hover:bg-black/75 focus-visible:outline-2 focus-visible:outline-white',
          className,
        )}
      >
        ALT
      </button>
      <Popover
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        placement="top"
        align="start"
        aria-label="Alt text"
        className="max-w-[min(320px,calc(100vw-24px))] px-3 py-2"
      >
        <p className="text-[13px] leading-snug break-words whitespace-pre-wrap text-fg">{text}</p>
      </Popover>
    </>
  );
}

function MosaicTile({
  m,
  file,
  index,
  total,
  large,
  gate,
  onOpen,
  className,
  style,
}: {
  m: ClientMessage;
  file: MessageAttachment;
  index: number;
  total: number;
  /** A tile wide enough to load the file itself rather than its thumbnail. */
  large: boolean;
  /** `useAnimationGate()`, once for the whole mosaic. */
  gate: ReturnType<typeof useAnimationGate>;
  onOpen: (index: number) => void;
  className?: string;
  style?: CSSProperties;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hot, setHot] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const { autoplay, allowed } = gate;
  const hidden = isSpoilerName(file.fileName) && !revealed;
  const video = file.kind === 'video';
  const animated = !video && (file.animated || file.mimeType === 'image/gif');
  const canPlay = animated && allowed;
  const playing = canPlay && !hidden && (autoplay === 'always' || hot);
  const poster = mediaUrl(file.thumbnailUrl);
  const full = mediaUrl(file.url);
  const src = video || (animated && !playing) ? poster : large || !poster ? full : poster;
  // The thumbnail stands in (blurred) while a large tile's file loads.
  const placeholder = !video && !animated && src !== poster ? poster : undefined;
  const verb = video ? 'Play video' : animated ? 'Open GIF' : 'Open photo';
  return (
    <div
      className={cn(
        'relative min-h-0 min-w-0 overflow-hidden bg-black/10 dark:bg-white/5',
        className,
      )}
      style={style}
      data-testid="mosaic-tile"
      data-kind={file.kind}
    >
      <button
        type="button"
        className={cn(
          'absolute inset-0 block size-full outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
          hidden && 'scale-110 blur-2xl',
        )}
        tabIndex={hidden ? -1 : undefined}
        aria-hidden={hidden || undefined}
        aria-label={
          file.description ? `${verb}: ${file.description}` : `${verb} ${index + 1} of ${total}`
        }
        onClick={(e) => {
          e.stopPropagation();
          if (!m.failed) onOpen(index);
        }}
        onPointerEnter={(e) => e.pointerType !== 'touch' && canPlay && setHot(true)}
        onPointerLeave={(e) => e.pointerType !== 'touch' && setHot(false)}
      >
        {placeholder && !loaded ? (
          <img
            src={placeholder}
            alt=""
            aria-hidden
            className="absolute inset-0 size-full scale-110 object-cover blur-md"
          />
        ) : null}
        {src && !broken ? (
          <img
            src={src}
            alt={file.description ?? (video ? 'Video' : animated ? 'GIF' : 'Photo')}
            className={cn(
              'absolute inset-0 size-full object-cover transition-opacity duration-300',
              loaded || !placeholder ? 'opacity-100' : 'opacity-0',
            )}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
          />
        ) : video && !broken ? (
          <video
            src={full}
            preload="metadata"
            muted
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        ) : animated && !broken ? (
          <span
            className="absolute inset-0 flex items-center justify-center text-muted"
            aria-hidden
          >
            <Play size={24} className="fill-current opacity-70" />
          </span>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-1 text-muted">
            <ImageOff size={22} aria-hidden />
            <span className="sr-only">Media unavailable</span>
          </span>
        )}
      </button>

      {hidden ? (
        <button
          type="button"
          aria-label={video ? 'Reveal spoiler video' : 'Reveal spoiler image'}
          onClick={(e) => {
            e.stopPropagation();
            setRevealed(true);
          }}
          className="absolute inset-0 flex items-center justify-center bg-black/25 outline-none hover:bg-black/15 focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
        >
          <span className="rounded-full bg-black/70 px-2.5 py-1 text-[11px] font-bold tracking-wider text-white">
            SPOILER
          </span>
        </button>
      ) : null}

      {animated && !playing && !hidden ? (
        <span
          className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white backdrop-blur-sm"
          aria-hidden
        >
          GIF
        </span>
      ) : null}

      {video && !hidden ? (
        <>
          <span className="pointer-events-none absolute inset-0 m-auto flex size-10 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play size={18} className="ml-0.5 fill-current" aria-hidden />
          </span>
          {file.durationMs ? (
            <span className="pointer-events-none absolute top-1.5 right-2 text-[11px] font-medium text-white tabular-nums drop-shadow">
              {formatDuration(file.durationMs)}
            </span>
          ) : null}
        </>
      ) : null}

      {file.description && !hidden ? <AltChip text={file.description} /> : null}
    </div>
  );
}

/**
 * The mosaic of a message's photos and videos (two or more; `files` in order). `onOpen` gets
 * the tile's index among them; `children` (the time) sits in the bottom-right corner.
 */
export function MediaMosaic({
  m,
  files,
  onOpen,
  rounded,
  children,
}: {
  m: ClientMessage;
  files: MessageAttachment[];
  onOpen: (index: number) => void;
  /** The outer corners' radius class (the tiles are square-cornered inside). */
  rounded: string;
  children?: ReactNode;
}) {
  const layout = mosaicLayout(files.length);
  const gate = useAnimationGate();
  const tile = (
    index: number,
    large: boolean,
    props: { className?: string; style?: CSSProperties } = {},
  ) => (
    <MosaicTile
      key={`${files[index]!.id}:${index}`}
      m={m}
      file={files[index]!}
      index={index}
      total={files.length}
      large={large}
      gate={gate}
      onOpen={onOpen}
      {...props}
    />
  );
  const corner = children ? (
    <span className="pointer-events-none absolute right-1.5 bottom-1.5">{children}</span>
  ) : null;

  if (layout.kind === 'three') {
    return (
      <div
        className={cn('relative grid gap-1 overflow-hidden', rounded)}
        style={{
          width: MOSAIC_W,
          maxWidth: '100%',
          aspectRatio: '3 / 2',
          gridTemplateColumns: '2fr 1fr',
          gridTemplateRows: 'repeat(2, minmax(0, 1fr))',
        }}
        data-testid="media-mosaic"
        data-layout="three"
      >
        {tile(0, true, { className: 'row-span-2' })}
        {tile(1, false)}
        {tile(2, false)}
        {corner}
      </div>
    );
  }

  let start = 0;
  return (
    <div
      className={cn('relative flex flex-col gap-1 overflow-hidden', rounded)}
      style={{ width: MOSAIC_W, maxWidth: '100%' }}
      data-testid="media-mosaic"
      data-layout={layoutLabel(layout)}
    >
      {layout.rows.map((cols, r) => {
        const first = start;
        start += cols;
        return (
          <div
            key={r}
            className="grid gap-1"
            style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
            data-testid="mosaic-row"
          >
            {Array.from({ length: cols }, (_, i) =>
              first + i < files.length
                ? tile(first + i, cols <= 2, {
                    style: { aspectRatio: cols === 1 ? '2 / 1' : '1 / 1' },
                  })
                : null,
            )}
          </div>
        );
      })}
      {corner}
    </div>
  );
}
