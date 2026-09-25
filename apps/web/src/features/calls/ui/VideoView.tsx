import { useEffect, useRef } from 'react';
import { cn } from '@/lib/cn';

export interface VideoViewProps {
  stream: MediaStream | null;
  /** Mirror (front camera preview). */
  mirror?: boolean;
  /** cover (tiles, full-bleed) or contain (screen shares). */
  fit?: 'cover' | 'contain';
  className?: string;
  /** Marks remote videos for tests/automation. */
  remote?: boolean;
  label?: string;
}

/**
 * A muted <video> bound to a MediaStream (audio plays through the engine's audio sinks, so
 * layout changes never interrupt it).
 */
export function VideoView({
  stream,
  mirror,
  fit = 'cover',
  className,
  remote,
  label,
}: VideoViewProps) {
  const ref = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (el.srcObject !== stream) el.srcObject = stream;
    if (stream) void el.play().catch(() => undefined);
  }, [stream]);

  return (
    <video
      ref={ref}
      autoPlay
      playsInline
      muted
      aria-label={label}
      data-remote-video={remote ? '' : undefined}
      data-local-video={remote ? undefined : ''}
      className={cn(
        'size-full bg-black',
        fit === 'cover' ? 'object-cover' : 'object-contain',
        mirror && '-scale-x-100',
        className,
      )}
    />
  );
}
