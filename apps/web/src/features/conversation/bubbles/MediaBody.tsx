/**
 * Photo / video bubble content: sized preview, upload progress (cancel), play badge → viewer.
 * Animated images (GIF / WebP / APNG with a poster) show the poster and a GIF badge until
 * hovered or tapped (device pref `autoplayAnimatedMedia` 'hover'), play right away ('always')
 * or stay still ('never', reduced motion, hidden app — the viewer plays them).
 */
import { useState, type ReactNode } from 'react';
import { ImageOff, Play, RotateCw, X } from 'lucide-react';
import { formatDuration } from '@enbox/shared';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { ClientMessage } from '@/stores/messages';
import { useUi } from '@/stores/ui';
import { cancelUpload } from '../lib/sendMedia';

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

export function MediaBody({
  m,
  onOpen,
  onRetry,
  rounded,
  children,
}: {
  m: ClientMessage;
  onOpen: () => void;
  onRetry: () => void;
  /** Extra classes for the inner radius (depends on caption/quote around it). */
  rounded: string;
  /** Overlay (meta) rendered in the bottom-right corner. */
  children?: ReactNode;
}) {
  const media = m.media!;
  const [broken, setBroken] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [hot, setHot] = useState(false);
  const box = mediaBox(media.width, media.height);
  const video = m.type === 'video';
  const uploading = !!m.pending && m.uploadProgress !== undefined && m.uploadProgress < 1;
  // Animated images with a poster (see the header); without one the animation shows as-is.
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const reduceMotion = useReducedMotion();
  const appVisible = useAppVisible();
  const poster = media.thumbnailUrl ? mediaUrl(media.thumbnailUrl) : undefined;
  const animated = !video && media.animated && !!poster;
  const canPlay = animated && autoplay !== 'never' && !reduceMotion && appVisible;
  const playing = canPlay && (autoplay === 'always' || hot);
  const src = video || (animated && !playing) ? poster : mediaUrl(m.localUrl ?? media.url);
  const placeholder = !video && !animated ? poster : undefined;

  return (
    <div
      className={cn('relative overflow-hidden bg-black/10 dark:bg-white/5', rounded)}
      style={{ width: box.width, maxWidth: '100%', aspectRatio: `${box.width} / ${box.height}` }}
    >
      <button
        type="button"
        className="absolute inset-0 block size-full outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-inset"
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
            alt={m.text ?? (video ? 'Video' : animated ? 'GIF' : 'Photo')}
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
            src={mediaUrl(m.localUrl ?? media.url)}
            preload="metadata"
            muted
            playsInline
            className="absolute inset-0 size-full object-cover"
          />
        ) : (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-muted">
            <ImageOff size={28} aria-hidden />
            <span className="text-xs">Media unavailable</span>
          </span>
        )}
      </button>

      {animated && !playing && !uploading && !m.failed ? (
        <span
          className="pointer-events-none absolute top-1.5 left-1.5 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-white backdrop-blur-sm"
          aria-hidden
        >
          GIF
        </span>
      ) : null}

      {video && !uploading && !m.failed ? (
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
