import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';

/** Discord's server acronym: first letters of the words (max 5), e.g. "Gaming Lounge" → "GL". */
export function acronymOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return (words.map((w) => Array.from(w)[0] ?? '').join('') || '?').slice(0, 5);
}

/**
 * A Space's icon: its image, else its acronym on a tile (rounded square, like the rail).
 * Decorative: the Space's name is always shown next to it.
 */
export function SpaceIcon({
  name,
  iconUrl,
  size = 48,
  className,
}: {
  name: string;
  iconUrl: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const style = { width: size, height: size, borderRadius: Math.round(size * 0.3) };
  if (iconUrl)
    return (
      <img
        src={mediaUrl(iconUrl)}
        alt=""
        aria-hidden
        draggable={false}
        className={cn('shrink-0 bg-surface-2 object-cover', className)}
        style={style}
      />
    );
  const text = acronymOf(name);
  return (
    <span
      aria-hidden
      className={cn('flex shrink-0 items-center justify-center bg-surface-2 font-semibold text-fg select-none', className)}
      style={{ ...style, fontSize: Math.max(11, Math.round(size / (text.length > 2 ? 3.4 : 2.6))) }}
    >
      {text}
    </span>
  );
}
