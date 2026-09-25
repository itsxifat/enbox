import { useEffect, useState } from 'react';
import { Megaphone, UserRound, UsersRound } from 'lucide-react';
import { mediaUrl } from '@/lib/api';
import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

export type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl';
export type AvatarKind = 'user' | 'group' | 'channel' | 'community';

export const AVATAR_PX: Record<AvatarSize, number> = {
  xs: 24,
  sm: 32,
  md: 40,
  lg: 48,
  xl: 64,
  '2xl': 96,
  '3xl': 144,
};

/** Fallback background palette (white text passes AA on all of them). */
const PALETTE = [
  '#6d5dfc',
  '#0e7fc0',
  '#0f8a6a',
  '#c2410c',
  '#be185d',
  '#7c3aed',
  '#0f766e',
  '#b45309',
  '#4f46e5',
  '#a21caf',
];

/** Deterministic color for a seed (user/chat id or name). */
export function avatarColor(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (Math.imul(h, 31) + seed.charCodeAt(i)) | 0;
  return PALETTE[Math.abs(h) % PALETTE.length]!;
}

export interface AvatarProps {
  /** Image URL (relative `/uploads/…` is resolved against the API origin). */
  src?: string | null;
  /** Used for initials and alt text. */
  name: string;
  /** Seed for the fallback color (defaults to name). Pass the user/chat id for stability. */
  colorSeed?: string;
  size?: AvatarSize | number;
  /** Fallback glyph when there is no image: initials for users, icons for the rest. */
  kind?: AvatarKind;
  /** Green presence dot. */
  online?: boolean;
  /** Status ring: 'unseen' (brand) / 'seen' (muted). */
  ring?: 'unseen' | 'seen' | null;
  className?: string;
  /** Decorative (next to a visible name) — hides it from screen readers. */
  decorative?: boolean;
}

export function Avatar({
  src,
  name,
  colorSeed,
  size = 'md',
  kind = 'user',
  online,
  ring,
  className,
  decorative = true,
}: AvatarProps) {
  const px = typeof size === 'number' ? size : AVATAR_PX[size];
  const url = mediaUrl(src);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  const showImage = !!url && !failed;
  // Communities use a rounded square like WhatsApp; everything else is a circle.
  const shape = kind === 'community' ? 'rounded-[28%]' : 'rounded-full';
  const Icon =
    kind === 'group'
      ? UsersRound
      : kind === 'channel'
        ? Megaphone
        : kind === 'community'
          ? UsersRound
          : UserRound;
  const text = initials(name);
  const dot = Math.max(8, Math.round(px * 0.26));

  return (
    <span
      className={cn('relative inline-flex shrink-0', className)}
      style={{ width: px, height: px }}
      role={decorative ? undefined : 'img'}
      aria-label={decorative ? undefined : name}
      aria-hidden={decorative || undefined}
    >
      <span
        className={cn(
          'flex size-full items-center justify-center overflow-hidden font-semibold text-white select-none',
          shape,
          ring === 'unseen' && 'ring-2 ring-brand ring-offset-2 ring-offset-surface',
          ring === 'seen' && 'ring-2 ring-line-strong ring-offset-2 ring-offset-surface',
        )}
        style={{
          backgroundColor: showImage
            ? 'var(--surface-2)'
            : kind === 'user'
              ? avatarColor(colorSeed ?? name)
              : 'var(--line-strong)',
          fontSize: Math.max(10, Math.round(px * (text.length > 1 ? 0.38 : 0.44))),
        }}
      >
        {showImage ? (
          <img
            src={url}
            alt=""
            className="size-full object-cover"
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailed(true)}
          />
        ) : kind === 'user' && text !== '?' ? (
          <span aria-hidden>{text}</span>
        ) : (
          <Icon
            size={Math.round(px * 0.52)}
            strokeWidth={1.8}
            className={kind === 'user' ? 'text-white' : 'text-white dark:text-fg'}
            aria-hidden
          />
        )}
      </span>
      {online ? (
        <span
          className="absolute right-0 bottom-0 rounded-full bg-online ring-2 ring-surface"
          style={{ width: dot, height: dot }}
          aria-label={decorative ? undefined : 'online'}
        />
      ) : null}
    </span>
  );
}
