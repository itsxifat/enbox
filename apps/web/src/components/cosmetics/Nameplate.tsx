import type { CSSProperties } from 'react';
import { useCosmeticMotion } from '@/hooks/useCosmeticMotion';
import { cn } from '@/lib/cn';
import { nameplateArt, type NameplateArt } from './nameplates';
import './cosmetics.css';

export interface NameplateProps {
  /** NAMEPLATES id; null or an unknown id renders nothing. */
  id: string | null | undefined;
  /** Sits absolutely behind a row's content (`absolute inset-0`, rounded like the row). */
  className?: string;
  /** 'hover' (default: animates while the closest `[data-animate-avatars]` host is hovered), 'always', 'never'. */
  animate?: 'hover' | 'always' | 'never';
}

/**
 * A nameplate behind a list row (DM rows, member list rows). Render it as the first child of a
 * `relative` row and make the content after it positioned (`relative`) so it paints on top; the
 * plate covers the row's hover/selected background and inherits the row's border radius.
 * 'hover' is pure CSS like the decorations (no subscription per row).
 */
export function Nameplate({ id, className, animate = 'hover' }: NameplateProps) {
  const art = nameplateArt(id);
  if (!art) return null;
  if (animate === 'always') return <LiveNameplate id={id!} art={art} className={className} />;
  return <NameplateView id={id!} art={art} className={className} play={animate} />;
}

function LiveNameplate({
  id,
  art,
  className,
}: {
  id: string;
  art: NameplateArt;
  className?: string;
}) {
  const motion = useCosmeticMotion();
  return (
    <NameplateView
      id={id}
      art={art}
      className={className}
      play={motion.animate ? 'always' : 'never'}
    />
  );
}

function NameplateView({
  id,
  art,
  className,
  play,
}: {
  id: string;
  art: NameplateArt;
  className?: string;
  play: 'hover' | 'always' | 'never';
}) {
  return (
    <span
      className={cn('cos-art cos-plate', className)}
      data-play={play}
      data-nameplate={id}
      aria-hidden
    >
      <span style={{ '--cos-plate-base': art.base } as CSSProperties} />
      {art.fx ? (
        <span
          className={cn('cos-plate-fx cos-anim', `cos-plate-${art.motion ?? 'drift'}`)}
          style={{
            backgroundImage: art.fx,
            backgroundSize: art.fxSize,
            backgroundPosition: art.fxPosition ?? '0 100%',
            backgroundRepeat: 'repeat',
          }}
        />
      ) : null}
      {art.shine ? <span className="cos-plate-shine cos-anim" /> : null}
    </span>
  );
}
