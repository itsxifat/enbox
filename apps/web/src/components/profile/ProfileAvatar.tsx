import type { CSSProperties } from 'react';
import type { PresenceState } from '@enbox/shared';
import { Avatar } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface ProfileAvatarProps {
  name: string;
  /** Seed of the fallback colour (the user id). */
  colorSeed: string;
  src: string | null | undefined;
  animatedSrc: string | null | undefined;
  decoration?: string | null;
  presence: PresenceState | null;
  size: number;
  /** Ring around the avatar in the surface colour (also behind the presence badge). */
  ring: string;
  ringWidth: number;
  /** Makes the avatar a button (e.g. "View full profile", "View photo"). */
  onClick?: () => void;
  /** Accessible name of the button. */
  label?: string;
  className?: string;
  /** Positioning (e.g. `top` of an absolutely placed avatar). */
  style?: CSSProperties;
}

/**
 * The big avatar of a profile surface: ringed in the surface colour so it cuts into the
 * banner, the presence badge cut out of the same colour, the decoration playing (profiles are
 * where animations always play, motion preferences permitting).
 */
export function ProfileAvatar({
  name,
  colorSeed,
  src,
  animatedSrc,
  decoration,
  presence,
  size,
  ring,
  ringWidth,
  onClick,
  label,
  className,
  style,
}: ProfileAvatarProps) {
  const avatar = (
    <Avatar
      src={src}
      animatedSrc={animatedSrc}
      animate="always"
      name={name}
      colorSeed={colorSeed}
      size={size}
      presence={presence}
      decoration={decoration}
      decorative={!!onClick}
    />
  );
  return (
    <span
      className={cn('relative inline-flex shrink-0 rounded-full', className)}
      // The presence badge's ring and cut-outs use --surface: match them to the ring.
      style={{ ...style, padding: ringWidth, background: ring, '--surface': ring } as CSSProperties}
      data-testid="profile-avatar"
    >
      {onClick ? (
        <button
          type="button"
          onClick={onClick}
          aria-label={label}
          className="rounded-full outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {avatar}
        </button>
      ) : (
        avatar
      )}
    </span>
  );
}
