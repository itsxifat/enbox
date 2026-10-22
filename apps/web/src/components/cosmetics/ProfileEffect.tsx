import { useEffect, useRef, useState } from 'react';
import { useCosmeticMotion } from '@/hooks/useCosmeticMotion';
import { cn } from '@/lib/cn';
import { effectDef } from './effects/defs';
import { drawStill, makeEnv, runEffect, type EffectDef } from './effects/engine';

export interface ProfileEffectProps {
  /** PROFILE_EFFECTS id; null or an unknown id renders nothing. */
  id: string | null | undefined;
  /** Overlay over the whole profile surface (`absolute inset-0 pointer-events-none`). */
  className?: string;
  /**
   * 'once' (default: plays when shown, then rests on a still frame; replays when `replayKey`
   * changes, e.g. on hover), 'loop' (editor preview, Collectibles), 'still'.
   */
  play?: 'once' | 'loop' | 'still';
  replayKey?: number | string;
}

/** Device pixels per CSS pixel (capped: a 3x phone would quadruple the fill cost for no gain). */
const MAX_DPR = 2;

/**
 * A profile effect: a canvas over the card (effects/defs.ts), one frame loop while it plays.
 * Reduced motion, animated media off or a hidden app draw the still frame instead; the loop
 * stops on unmount, when a 'once' run settles, and while the app is hidden.
 */
export function ProfileEffect({ id, className, play = 'once', replayKey }: ProfileEffectProps) {
  const def = effectDef(id);
  if (!def) return null;
  return (
    <EffectCanvas id={id!} def={def} className={className} play={play} replayKey={replayKey} />
  );
}

function EffectCanvas({
  id,
  def,
  className,
  play,
  replayKey,
}: {
  id: string;
  def: EffectDef;
  className?: string;
  play: 'once' | 'loop' | 'still';
  replayKey?: number | string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const motion = useCosmeticMotion();
  const mode = motion.reduced || motion.autoplay === 'never' ? 'still' : play;
  const running = mode !== 'still' && motion.visible;
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  // The replay key a 'once' run already finished for (it then rests on the still frame).
  const played = useRef<{ key: number | string | undefined } | null>(null);
  // A new effect plays again.
  useEffect(() => {
    played.current = null;
  }, [id]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const measure = () => {
      const r = canvas.getBoundingClientRect();
      const w = Math.round(r.width);
      const h = Math.round(r.height);
      setSize((s) => (s && s.w === w && s.h === h ? s : w && h ? { w, h } : null));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas || !size) return;
    let ctx: CanvasRenderingContext2D | null;
    try {
      ctx = canvas.getContext('2d');
    } catch {
      // No canvas support (some test and privacy environments): no effect.
      return;
    }
    if (!ctx) return;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const rested = mode === 'once' && played.current !== null && played.current.key === replayKey;
    if (!running || rested) {
      drawStill(ctx, def, makeEnv(size.w, size.h));
      return;
    }
    return runEffect({
      ctx,
      def,
      w: size.w,
      h: size.h,
      mode: mode === 'loop' ? 'loop' : 'once',
      onRest: () => {
        played.current = { key: replayKey };
      },
    });
  }, [def, size, mode, running, replayKey]);

  return (
    <canvas
      ref={ref}
      className={cn('pointer-events-none absolute inset-0 size-full', className)}
      data-effect={id}
      data-mode={running ? mode : 'still'}
      aria-hidden
    />
  );
}
