/**
 * A sticker's picture in a `size`×`size` box (object-contain): the picker, the settings grid,
 * message bodies and their popout. An animated sticker plays while `playing`; otherwise it
 * shows a still — its poster when known (`stillUrl`: a message's media thumbnail), else its
 * first frame drawn into a canvas once it scrolls into view (`SpaceSticker` carries no poster).
 *
 * `useStickerPlayback` decides `playing` with the rules of animated emoji and avatars: the
 * device pref `autoplayAnimatedMedia` ('always' plays, 'never' doesn't, 'hover' plays while
 * hovered or focused), and reduced motion or a hidden or unfocused app always show the still.
 */
import { useEffect, useRef, useState, type RefObject } from 'react';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useUi } from '@/stores/ui';

/**
 * What "hover" means for a sticker: 'row' the closest `[data-animate-avatars]` ancestor (a
 * message row) or the sticker, 'self' the element itself (picker cells, settings cards),
 * 'open' nothing — it plays whenever animation is allowed (popouts, upload previews).
 */
export type StickerPlayback = 'row' | 'self' | 'open';

export function useStickerPlayback(
  ref: RefObject<HTMLElement | null>,
  animated: boolean,
  mode: StickerPlayback = 'self',
): boolean {
  const autoplay = useUi((s) => s.prefs.autoplayAnimatedMedia);
  const reduceMotion = useReducedMotion();
  const appVisible = useAppVisible();
  const canAnimate = animated && autoplay !== 'never' && !reduceMotion && appVisible;
  const onHover = canAnimate && autoplay !== 'always' && mode !== 'open';
  const [hot, setHot] = useState(false);
  useEffect(() => {
    if (!onHover) return;
    const self = ref.current;
    if (!self) return;
    const host =
      (mode === 'row' ? self.closest<HTMLElement>('[data-animate-avatars]') : null) ?? self;
    const on = () => setHot(true);
    const off = () => setHot(false);
    host.addEventListener('pointerenter', on);
    host.addEventListener('pointerleave', off);
    host.addEventListener('focusin', on);
    host.addEventListener('focusout', off);
    return () => {
      host.removeEventListener('pointerenter', on);
      host.removeEventListener('pointerleave', off);
      host.removeEventListener('focusin', on);
      host.removeEventListener('focusout', off);
      setHot(false);
    };
  }, [onHover, mode, ref]);
  return canAnimate && (!onHover || hot);
}

export interface StickerImageProps {
  /** The picture (relative `/uploads/…` is resolved against the API origin). */
  url: string;
  /** A still of an animated sticker, when known (else its first frame is drawn). */
  stillUrl?: string | null;
  animated: boolean;
  playing: boolean;
  /** Alt text; '' when a labelled control around it names it. */
  alt: string;
  size: number;
  className?: string;
}

export function StickerImage({
  url,
  stillUrl,
  animated,
  playing,
  alt,
  size,
  className,
}: StickerImageProps) {
  const [failed, setFailed] = useState(false);
  const still = animated && !playing;
  const src = mediaUrl(still && stillUrl ? stillUrl : url) ?? url;
  useEffect(() => setFailed(false), [src]);
  const box = { width: size, height: size };
  const state = animated ? (still ? 'still' : 'playing') : undefined;
  if (failed)
    return (
      <span
        role={alt ? 'img' : undefined}
        aria-label={alt || undefined}
        aria-hidden={alt ? undefined : true}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-lg bg-surface-2',
          className,
        )}
        style={box}
      />
    );
  if (still && !stillUrl)
    return (
      <FirstFrame src={src} size={size} alt={alt} className={className} data-animated={state} />
    );
  return (
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      draggable={false}
      loading="lazy"
      decoding="async"
      data-animated={state}
      className={cn('shrink-0 object-contain', className)}
      style={box}
      onError={() => setFailed(true)}
    />
  );
}

/** The first frame of an animated picture in a canvas, drawn once it comes into view. */
function FirstFrame({
  src,
  size,
  alt,
  className,
  ...rest
}: {
  src: string;
  size: number;
  alt: string;
  className?: string;
  'data-animated'?: string;
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
        const px = Math.round(size * Math.min(2, window.devicePixelRatio || 1));
        canvas.width = px;
        canvas.height = px;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        // An image that is not in the document never advances: this is its first frame.
        const scale = Math.min(px / img.naturalWidth, px / img.naturalHeight);
        const w = img.naturalWidth * scale;
        const h = img.naturalHeight * scale;
        ctx.drawImage(img, (px - w) / 2, (px - h) / 2, w, h);
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
    };
  }, [src, size]);
  return (
    <canvas
      ref={ref}
      role={alt ? 'img' : undefined}
      aria-label={alt || undefined}
      aria-hidden={alt ? undefined : true}
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
      {...rest}
    />
  );
}
