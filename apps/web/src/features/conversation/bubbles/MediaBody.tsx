/**
 * Photo / video bubble content: sized preview, upload progress (cancel), play badge → viewer.
 * Animated images (GIF / WebP / APNG) show their poster and a GIF badge until hovered or
 * tapped (device pref `autoplayAnimatedMedia` 'hover'), play right away ('always') or stay
 * still ('never', reduced motion, hidden app — the viewer plays them). One without a poster
 * (an upload that came without one) shows a still tile instead: the gates hold either way.
 * Spoilers (a file name starting `SPOILER_`) stay blurred behind a SPOILER pill until
 * clicked, for this message in this view; nothing plays meanwhile.
 *
 * Messages with several files (`Message.attachments`, Discord: up to 10): their photos and
 * videos as a mosaic (MediaMosaic) — a single one at its natural size, as here — and the
 * other files below it, documents as cards and audio as players. Alt text is the picture's
 * `alt` plus an ALT chip that shows it. A message without `attachments` renders as before.
 */
import { useState, type ReactNode } from 'react';
import { ImageOff, Play, RotateCw, X } from 'lucide-react';
import { formatDuration, type MediaAttachment, type MessageAttachment } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ClientMessage } from '@/stores/messages';
import { isSpoilerName } from '../dropzone/files';
import { cancelUpload } from '../lib/sendMedia';
import { AudioFileBody } from './AudioBody';
import { FileBody } from './CardBodies';
import { AltChip, MediaMosaic, useAnimationGate } from './MediaMosaic';
import { fileMessage, isVisualFile } from './attachments';

const MAX_W = 330;
const MAX_H = 380;
const MIN_H = 120;

export function mediaBox(
  width: number | null,
  height: number | null,
): { width: number; height: number } {
  if (!width || !height) return { width: MAX_W, height: Math.round(MAX_W * 0.75) };
  const ratio = width / height;
  let w = Math.min(MAX_W, width);
  let h = w / ratio;
  if (h > MAX_H) {
    h = MAX_H;
    w = Math.max(160, Math.min(MAX_W, h * ratio));
  }
  if (h < MIN_H) h = MIN_H;
  return { width: Math.round(w), height: Math.round(h) };
}

export function ProgressRing({
  value,
  onCancel,
  label = 'Cancel upload',
}: {
  value: number;
  onCancel?: () => void;
  label?: string;
}) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0.04, Math.min(1, value));
  return (
    <span className="relative flex size-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm">
      <svg viewBox="0 0 48 48" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="3"
        />
        <circle
          cx="24"
          cy="24"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          className="transition-[stroke-dashoffset] duration-200"
        />
      </svg>
      {onCancel ? (
        <button
          type="button"
          aria-label={label}
          onClick={(e) => {
            e.stopPropagation();
            onCancel();
          }}
          className="relative flex size-9 items-center justify-center rounded-full hover:bg-white/10"
        >
          <X size={20} aria-hidden />
        </button>
      ) : (
        <span
          className="sr-only"
          role="progressbar"
          aria-valuenow={Math.round(pct * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      )}
    </span>
  );
}

/** One photo or video at its natural size (within MAX_W × MAX_H): the message's, or one of its files. */
function SingleMedia({
  m,
  media,
  alt,
  onOpen,
  onRetry,
  rounded,
  children,
}: {
  m: ClientMessage;
  media: MediaAttachment;
  /** Alt text (null = none). */
  alt: string | null;
  onOpen: () => void;
  onRetry: () => void;
  rounded: string;
  children?: ReactNode;
}) {
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hot, setHot] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const hidden = isSpoilerName(media.fileName) && !revealed;
  const box = mediaBox(media.width, media.height);
  const video = media.kind === 'video';
  // The local copy and the upload belong to the message's own media (`Message.media`).
  const own = media.id === m.media?.id;
  const localUrl = own ? m.localUrl : undefined;
  const uploading = own && !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  // Animated images (see the header): `media.animated`, or a GIF stored before uploads were
  // probed (migration 0001 marks those animated too; this covers a row it did not reach).
  const { autoplay, allowed } = useAnimationGate();
  const poster = media.thumbnailUrl ? mediaUrl(media.thumbnailUrl) : undefined;
  const animated = !video && (media.animated || media.mimeType === 'image/gif');
  const canPlay = animated && allowed;
  const playing = canPlay && !hidden && (autoplay === 'always' || hot);
  const src = video || (animated && !playing) ? poster : mediaUrl(localUrl ?? media.url);
  const placeholder = !video && !animated ? poster : undefined;

  return (
    <div
      className={cn('relative overflow-hidden bg-black/10 dark:bg-white/5', rounded)}
      style={{ width: box.width, maxWidth: '100%', aspectRatio: `${box.width} / ${box.height}` }}
    >
      <button
        type="button"
        className={cn(
          'absolute inset-0 block size-full outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset',
          hidden && 'scale-110 blur-2xl',
        )}
        tabIndex={hidden ? -1 : undefined}
        aria-hidden={hidden || undefined}
        onClick={(e) => {
          e.stopPropagation();
          if (uploading || m.failed) return;
          // The first tap on a still GIF plays it in place (touch has no hover); the next opens it.
          if (canPlay && autoplay === 'hover' && !hot) setHot(true);
          else onOpen();
        }}
        onPointerEnter={(e) => e.pointerType !== 'touch' && canPlay && setHot(true)}
        onPointerLeave={(e) => e.pointerType !== 'touch' && setHot(false)}
        aria-label={
          video ? 'Play video' : animated ? (playing ? 'Open GIF' : 'Play GIF') : 'Open photo'
        }
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
            alt={alt ?? m.text ?? (video ? 'Video' : animated ? 'GIF' : 'Photo')}
            className={cn(
              'absolute inset-0 size-full object-cover transition-opacity duration-300',
              loaded ? 'opacity-100' : 'opacity-0',
            )}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={() => setLoaded(true)}
            onError={() => setBroken(true)}
          />
        ) : video && !broken ? (
          <video
            src={mediaUrl(localUrl ?? media.url)}
            preload="metadata"
            muted
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        ) : animated && !broken ? (
          // No poster to stand in: a still tile until the animation may play.
          <span
            className="absolute inset-0 flex items-center justify-center text-muted"
            aria-hidden
            data-testid="animated-still"
          >
            <Play size={28} className="fill-current opacity-70" />
          </span>
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
            <ImageOff size={28} aria-hidden />
            <span className="text-xs">Media unavailable</span>
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
          <span className="rounded-full bg-black/70 px-3.5 py-1.5 text-[13px] font-bold tracking-wider text-white">
            SPOILER
          </span>
        </button>
      ) : null}

      {animated && !playing && !uploading && !m.failed && !hidden ? (
        <span
          className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white backdrop-blur-sm"
          aria-hidden
        >
          GIF
        </span>
      ) : null}

      {video && !uploading && !m.failed && !hidden ? (
        <>
          <span className="pointer-events-none absolute inset-0 m-auto flex size-12 items-center justify-center rounded-full bg-black/45 text-white backdrop-blur-sm">
            <Play size={22} className="ml-0.5 fill-current" aria-hidden />
          </span>
          {media.durationMs ? (
            <span className="pointer-events-none absolute bottom-1.5 left-2 flex items-center gap-1 text-[11px] font-medium text-white drop-shadow">
              <Play size={10} className="fill-current" aria-hidden />
              {formatDuration(media.durationMs)}
            </span>
          ) : null}
        </>
      ) : null}

      {alt && !hidden && !uploading && !m.failed ? (
        <AltChip text={alt} className={video && media.durationMs ? 'bottom-6' : undefined} />
      ) : null}

      {uploading ? (
        <span className="absolute inset-0 m-auto flex size-12">
          <ProgressRing
            value={m.uploadProgress ?? 0}
            onCancel={m.clientId ? () => cancelUpload(m.clientId!) : undefined}
          />
        </span>
      ) : null}
      {m.failed ? (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRetry();
          }}
          className="absolute inset-0 m-auto flex h-10 w-fit items-center gap-2 rounded-full bg-black/55 px-4 text-sm font-medium text-white backdrop-blur-sm hover:bg-black/65"
        >
          <RotateCw size={16} aria-hidden /> Retry
        </button>
      ) : null}
      {children ? (
        <span className="pointer-events-none absolute right-1.5 bottom-1.5">{children}</span>
      ) : null}
    </div>
  );
}

/**
 * A message with several files: the photos and videos first (a mosaic, or one at its natural
 * size), then the others in order — audio as players, the rest as document cards. The time
 * (`children`) sits on the pictures, or after the files when there are any.
 */
function AttachmentsBody({
  m,
  files,
  mine,
  onOpen,
  onRetry,
  rounded,
  children,
}: {
  m: ClientMessage;
  files: MessageAttachment[];
  mine: boolean;
  onOpen: (index: number) => void;
  onRetry: () => void;
  rounded: string;
  children?: ReactNode;
}) {
  const visual = files.filter(isVisualFile);
  const others = files.flatMap((file, i) => (isVisualFile(file) ? [] : [{ file, i }]));
  const onMedia = others.length === 0 ? children : null;
  return (
    <div className="flex min-w-0 flex-col gap-1" data-testid="message-attachments">
      {visual.length === 1 ? (
        <SingleMedia
          m={m}
          media={visual[0]!}
          alt={visual[0]!.description}
          onOpen={() => onOpen(0)}
          onRetry={onRetry}
          rounded={rounded}
        >
          {onMedia}
        </SingleMedia>
      ) : visual.length > 1 ? (
        <MediaMosaic m={m} files={visual} onOpen={onOpen} rounded={rounded}>
          {onMedia}
        </MediaMosaic>
      ) : null}
      {others.length ? (
        <ul className="flex flex-col gap-1 px-0.5 pb-0.5" aria-label="Files">
          {others.map(({ file, i }) => (
            <li key={`${file.id}:${i}`} data-testid="attachment-file">
              {file.kind === 'audio' || file.kind === 'voice' ? (
                <AudioFileBody m={fileMessage(m, file, i)} mine={mine} />
              ) : (
                <FileBody m={fileMessage(m, file, i)} mine={mine} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
      {others.length && children ? (
        <span className="flex justify-end px-1 pb-0.5">{children}</span>
      ) : null}
    </div>
  );
}

export function MediaBody({
  m,
  mine = false,
  onOpen,
  onRetry,
  rounded,
  children,
}: {
  m: ClientMessage;
  /** Sent by me (colours of the document cards and players of a message with several files). */
  mine?: boolean;
  /** Open the viewer on the message's `index`-th photo or video (0 for a single one). */
  onOpen: (index: number) => void;
  onRetry: () => void;
  /** Extra classes for the inner radius (depends on caption/quote around it). */
  rounded: string;
  /** Overlay (meta) rendered in the bottom-right corner. */
  children?: ReactNode;
}) {
  const files = m.attachments;
  if (files && files.length > 1)
    return (
      <AttachmentsBody
        m={m}
        files={files}
        mine={mine}
        onOpen={onOpen}
        onRetry={onRetry}
        rounded={rounded}
      >
        {children}
      </AttachmentsBody>
    );
  return (
    <SingleMedia
      m={m}
      media={m.media!}
      alt={files?.[0]?.description ?? null}
      onOpen={() => onOpen(0)}
      onRetry={onRetry}
      rounded={rounded}
    >
      {children}
    </SingleMedia>
  );
}
