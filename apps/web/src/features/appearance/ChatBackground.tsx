/**
 * The wallpaper layer behind a message list: first child of the `.chat-wallpaper` container,
 * absolutely filling it, never interactive. Flat presets come from `--wallpaper` on the root;
 * the animated presets are classes from appearance.css (loaded lazily on first mount); an
 * uploaded wallpaper is an <img> or a muted looping <video>. Under reduced motion or while
 * the app is hidden a GIF/video shows its poster and the animated presets stand still.
 */
import { useEffect, useRef } from 'react';
import { useAppVisible } from '@/hooks/useAppVisible';
import { useReducedMotion } from '@/hooks/useMediaQuery';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { WALLPAPER_PRESET_DEFS, type ResolvedAppearance } from './presets';

let cssLoaded = false;
function loadAppearanceCss(): void {
  if (cssLoaded) return;
  cssLoaded = true;
  void import('./appearance.css').catch(() => {
    cssLoaded = false;
  });
}

export function ChatBackground({
  appearance,
  className,
}: {
  appearance: ResolvedAppearance;
  className?: string;
}) {
  const visible = useAppVisible();
  const reduced = useReducedMotion();
  const motion = visible && !reduced;
  const { wallpaper, media, dim, blur } = appearance;
  const preset = wallpaper.kind === 'preset' ? WALLPAPER_PRESET_DEFS[wallpaper.id] : null;
  const animated = !!preset?.animated;

  useEffect(() => {
    if (animated) loadAppearanceCss();
  }, [animated]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = media?.kind === 'video';
  useEffect(() => {
    const el = videoRef.current;
    if (!el || !isVideo) return;
    if (motion) void el.play?.()?.catch?.(() => undefined);
    else el.pause?.();
  }, [motion, isVideo, media?.url]);

  const mediaStyle = blur ? { filter: `blur(${blur}px)`, transform: 'scale(1.06)' } : undefined;
  const poster = mediaUrl(media?.thumbnailUrl);

  return (
    <div
      aria-hidden
      data-testid="chat-background-layer"
      data-motion={motion ? 'on' : 'off'}
      className={cn(
        'pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]',
        animated && wallpaper.kind === 'preset' && `wp-anim wp-${wallpaper.id}`,
        className,
      )}
    >
      {media && isVideo ? (
        <video
          ref={videoRef}
          data-testid="chat-background"
          src={mediaUrl(media.url)}
          poster={poster}
          muted
          loop
          playsInline
          autoPlay={motion}
          preload="metadata"
          className="absolute inset-0 size-full object-cover"
          style={mediaStyle}
        />
      ) : media ? (
        <img
          data-testid="chat-background"
          src={media.animated && !motion && poster ? poster : mediaUrl(media.url)}
          alt=""
          draggable={false}
          className="absolute inset-0 size-full object-cover"
          style={mediaStyle}
        />
      ) : null}
      {dim > 0 ? (
        <div
          data-testid="chat-background-dim"
          className="absolute inset-0 bg-black"
          style={{ opacity: dim / 100 }}
        />
      ) : null}
    </div>
  );
}
