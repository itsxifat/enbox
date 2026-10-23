/**
 * A direct image link's embed: the picture inline (the server's stored copy, never the
 * site's own URL), fitted into MAX_W × MAX_H, opening the link on click. The server keeps
 * animated GIF and WebP for direct links, so those show their first frame — drawn into a
 * canvas from an image that never enters the document, so it never advances — until the
 * device's animation preference lets them play: always, while the message row is hovered,
 * or never (reduced motion and a hidden app always show the still), like stickers.
 */
import { useEffect, useRef, useState } from 'react';
import type { LinkPreview } from '@enbox/shared';
import { useStickerPlayback } from '@/features/stickers/StickerImage';
import { mediaUrl } from '@/lib/api';
import { EmbedFrame, type RemoveEmbeds } from './EmbedFrame';

const MAX_W = 400;
const MAX_H = 300;

/** Whether a preview is a direct image link's: an image and nothing to read. */
export function isImageOnly(
  p: LinkPreview,
): p is LinkPreview & { image: NonNullable<LinkPreview['image']> } {
  return !!p.image && !p.title && !p.description;
}

/** Display size of a `w`×`h` picture inside MAX_W × MAX_H (never enlarged). */
export function fitImage(w: number, h: number): { width: number; height: number } {
  const scale = Math.min(1, MAX_W / w, MAX_H / h);
  return { width: Math.max(1, Math.round(w * scale)), height: Math.max(1, Math.round(h * scale)) };
}

/** The first frame of `src` in a canvas, drawn once it scrolls into view. */
function FirstFrame({
  src,
  width,
  height,
  onFail,
}: {
  src: string;
  width: number;
  height: number;
  /** A state setter (stable): called with true when the picture can't be loaded. */
  onFail: (failed: true) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let cancelled = false;
    const img = new Image();
    const draw = () => {
      img.onload = () => {
        if (cancelled || !img.naturalWidth || !img.naturalHeight) return;
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
        canvas.getContext('2d')?.drawImage(img, 0, 0, canvas.width, canvas.height);
      };
      img.onerror = () => {
        if (!cancelled) onFail(true);
      };
      img.src = src;
    };
    let io: IntersectionObserver | null = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io?.disconnect();
        draw();
      });
      io.observe(canvas);
    } else draw();
    return () => {
      cancelled = true;
      io?.disconnect();
      img.onload = null;
      img.onerror = null;
    };
  }, [src, width, height, onFail]);
  return (
    <canvas
      ref={ref}
      aria-hidden
      data-still
      className="block h-auto max-w-full rounded-md bg-black/5 dark:bg-white/5"
      style={{ width, aspectRatio: `${width} / ${height}` }}
    />
  );
}

export function ImageLinkEmbed({
  preview,
  onRemove,
}: {
  preview: LinkPreview & { image: NonNullable<LinkPreview['image']> };
  onRemove?: RemoveEmbeds;
}) {
  const ref = useRef<HTMLAnchorElement>(null);
  const [failed, setFailed] = useState(false);
  const src = mediaUrl(preview.image.url) ?? preview.image.url;
  const maybeAnimated = /\.(?:gif|webp)$/i.test(preview.image.url);
  const playing = useStickerPlayback(ref, maybeAnimated, 'row');
  useEffect(() => setFailed(false), [src]);
  if (failed) return null;
  const { width, height } = fitImage(preview.image.width, preview.image.height);
  const still = maybeAnimated && !playing;
  return (
    <EmbedFrame onRemove={onRemove}>
      <a
        ref={ref}
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        title={preview.url}
        onClick={(e) => e.stopPropagation()}
        data-testid="image-embed"
        data-animated={maybeAnimated ? (still ? 'still' : 'playing') : undefined}
        className="relative block w-fit max-w-full rounded-md focus-visible:outline-2 focus-visible:outline-brand"
      >
        {still ? (
          <FirstFrame src={src} width={width} height={height} onFail={setFailed} />
        ) : (
          <img
            src={src}
            alt=""
            width={width}
            height={height}
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
            className="block h-auto max-w-full rounded-md bg-black/5 dark:bg-white/5"
            style={{ width }}
          />
        )}
        {still && /\.gif$/i.test(preview.image.url) ? (
          <span className="pointer-events-none absolute bottom-1.5 left-1.5 rounded-[4px] bg-black/60 px-1 text-[10px] leading-4 font-bold tracking-wide text-white">
            GIF
          </span>
        ) : null}
      </a>
    </EmbedFrame>
  );
}
