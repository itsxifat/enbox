import { useEffect, useId, useSyncExternalStore } from 'react';
import { isAvatarDecorationId } from '@enbox/shared';
import { useCosmeticMotion } from '@/hooks/useCosmeticMotion';
import type * as DecorationsModule from './decorations';
import type { DecorationArt } from './decorations';
import './cosmetics.css';

// The art (decorations/*) is a lazy chunk: it loads with the first decorated avatar, not with
// every page. Once loaded, decorations render synchronously with no subscription.
let artModule: typeof DecorationsModule | null = null;
let artLoading: Promise<void> | null = null;
const artListeners = new Set<() => void>();

/** Load the decoration art now (tests, or before showing many decorated avatars). */
export function preloadDecorationArt(): Promise<void> {
  artLoading ??= import('./decorations').then((m) => {
    artModule = m;
    for (const notify of artListeners) notify();
  });
  return artLoading;
}

function subscribeArt(notify: () => void): () => void {
  artListeners.add(notify);
  return () => artListeners.delete(notify);
}
const artSnapshot = () => artModule;

export interface AvatarDecorationProps {
  /** AVATAR_DECORATIONS id; null or an unknown id renders nothing. */
  id: string | null | undefined;
  /** The avatar's size in px; the decoration draws at ~1.2x, centred on the avatar. */
  size: number;
  /**
   * 'hover' (lists: plays while the closest `[data-animate-avatars]` host is hovered),
   * 'always' (profiles, editor preview), 'never'. Reduced motion and a hidden app freeze it.
   */
  animate?: 'hover' | 'always' | 'never';
}

/** Scale of the decoration box over the avatar (the art's 120-unit box over a 100-unit avatar). */
export const DECORATION_SCALE = 1.2;

/**
 * Procedural art around an avatar (decorations/*), absolutely centred over the avatar root
 * (which must be `relative`). 'hover' and 'never' are pure CSS (cosmetics.css): no hook, so
 * hundreds of decorated rows cost no subscription. 'always' subscribes to the motion prefs.
 */
export function AvatarDecoration({ id, size, animate = 'hover' }: AvatarDecorationProps) {
  if (!id || !isAvatarDecorationId(id)) return null;
  if (!artModule) return <PendingDecoration id={id} size={size} animate={animate} />;
  const art = artModule.decorationArt(id);
  if (!art) return null;
  if (animate === 'always') return <LiveDecoration id={id} art={art} size={size} />;
  return <DecorationSvg id={id} art={art} size={size} play={animate} />;
}

/** Until the art chunk is in: nothing, then the decoration. */
function PendingDecoration(props: AvatarDecorationProps) {
  const loaded = useSyncExternalStore(subscribeArt, artSnapshot, artSnapshot);
  useEffect(() => {
    void preloadDecorationArt();
  }, []);
  return loaded ? <AvatarDecoration {...props} /> : null;
}

function LiveDecoration({ id, art, size }: { id: string; art: DecorationArt; size: number }) {
  const motion = useCosmeticMotion();
  return <DecorationSvg id={id} art={art} size={size} play={motion.animate ? 'always' : 'never'} />;
}

function DecorationSvg({
  id,
  art: Art,
  size,
  play,
}: {
  id: string;
  art: DecorationArt;
  size: number;
  play: 'hover' | 'always' | 'never';
}) {
  // Gradient ids must be unique in the document; useId's punctuation is not id-safe in url().
  const uid = `cos${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const box = Math.round(size * DECORATION_SCALE);
  return (
    <svg
      className="cos-art cos-deco"
      data-play={play}
      data-decoration={id}
      viewBox="0 0 120 120"
      width={box}
      height={box}
      aria-hidden
      focusable="false"
    >
      <Art uid={uid} lite={size < 40} />
    </svg>
  );
}
