import type { ReactNode } from 'react';
import type { Status } from '@enbox/shared';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { fontStyle, ringSegments, textStatusSize } from './logic';

/**
 * Segmented status ring (one arc per status, oldest first, clockwise from 12 o'clock):
 * unseen arcs in brand color, seen arcs grey. `children` sits inside (avatar/preview).
 */
export function StatusRing({
  statuses,
  size = 56,
  stroke = 2.5,
  children,
  className,
}: {
  statuses: Pick<Status, 'id' | 'viewed'>[];
  size?: number;
  stroke?: number;
  children: ReactNode;
  className?: string;
}) {
  const segs = ringSegments(statuses.length, size, stroke);
  const inner = size - stroke * 2 - 4;
  return (
    <span
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0 -rotate-90"
        aria-hidden
      >
        {segs.map((s, i) => (
          <circle
            key={statuses[i]?.id ?? i}
            cx={size / 2}
            cy={size / 2}
            r={s.r}
            fill="none"
            strokeWidth={stroke}
            strokeLinecap="round"
            strokeDasharray={s.dasharray}
            strokeDashoffset={s.dashoffset}
            style={{ stroke: statuses[i]?.viewed ? 'var(--line-strong)' : 'var(--brand)' }}
          />
        ))}
      </svg>
      <span
        className="flex items-center justify-center overflow-hidden rounded-full"
        style={{ width: inner, height: inner }}
      >
        {children}
      </span>
    </span>
  );
}

/** A tiny preview of a status (photo/video poster or the text on its color). */
export function StatusThumb({ status, size }: { status: Status; size: number }) {
  if (status.type === 'text') {
    // A faithful miniature: lay the text out in a 160px square, then scale it down.
    const box = 160;
    const text = status.text ?? '';
    return (
      <span
        className="relative flex size-full items-center justify-center overflow-hidden"
        style={{ backgroundColor: status.backgroundColor ?? '#6D5DFC' }}
        aria-hidden
      >
        <span
          className="absolute top-1/2 left-1/2 flex items-center justify-center p-6 text-center leading-tight text-white"
          style={{
            width: box,
            height: box,
            transform: `translate(-50%, -50%) scale(${size / box})`,
            fontSize: Math.max(14, Math.round(textStatusSize(text) * 0.55)),
            ...fontStyle(status.font),
          }}
        >
          <span className="line-clamp-4 break-words">{text}</span>
        </span>
      </span>
    );
  }
  const src = mediaUrl(
    status.media?.thumbnailUrl ?? (status.type === 'image' ? status.media?.url : null),
  );
  if (src) return <img src={src} alt="" className="size-full object-cover" draggable={false} />;
  return (
    <video
      src={mediaUrl(status.media?.url)}
      muted
      playsInline
      preload="metadata"
      className="size-full bg-black object-cover"
      aria-hidden
    />
  );
}
