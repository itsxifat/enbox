/**
 * The burst of a super reaction: sparks and dots in the emoji's two colours fly out of the
 * chip's emoji and a ring spreads, for about a second. It draws on a canvas over the page
 * (message rows clip overflow) that follows the emoji while it plays, with the particle
 * engine of profile effects. Callers decide whether it may play (reduced motion, the
 * `superReactionAnimations` pref); it skips itself when hidden, off screen or crowded.
 */
import { useEffect, useRef } from 'react';
import { Portal } from '@/components/ui';
import {
  isAlive,
  makeEnv,
  particleAlpha,
  spawnParticle,
  stepParticle,
  type EffectDef,
} from '@/components/cosmetics/effects/engine';
import type { EmojiColors } from './emojiColors';

/** Canvas size in CSS px, centred on the emoji. */
const W = 160;
const H = 120;
const MAX_DPR = 2;
/** Bursts playing at once (more are skipped). */
const MAX_LIVE = 4;
/** Seconds the ring spreads for, and the longest a burst may run. */
const RING_SECONDS = 0.4;
const MAX_SECONDS = 1.2;
const TAU = Math.PI * 2;

let live = 0;

/** A four-pointed sparkle of radius `r`. */
function sparkle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, rot: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    const k = i % 2 === 0 ? r : r * 0.3;
    ctx.lineTo(Math.cos((i * Math.PI) / 4) * k, Math.sin((i * Math.PI) / 4) * k);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

/** Every particle at once from the centre, slowing down and falling a little. */
export function burstDef([a, b]: EmojiColors): EffectDef {
  return {
    max: 28,
    rate: 0,
    burst: 26,
    emit: 0,
    spawn(p, env) {
      const angle = env.rnd() * TAU;
      const speed = 70 + env.rnd() * 120;
      p.x = env.w / 2 + Math.cos(angle) * 7;
      p.y = env.h / 2 + Math.sin(angle) * 7;
      p.vx = Math.cos(angle) * speed;
      p.vy = Math.sin(angle) * speed - 24;
      p.ttl = 0.5 + env.rnd() * 0.45;
      p.size = 1.5 + env.rnd() * 2.5;
      p.rot = env.rnd() * TAU;
      p.vr = (env.rnd() - 0.5) * 8;
      p.color = env.rnd() < 0.55 ? a : b;
    },
    step(p, dt) {
      const drag = Math.max(0, 1 - 3 * dt);
      p.vx *= drag;
      p.vy = p.vy * drag + 90 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
    },
    draw(ctx, p, alpha) {
      ctx.globalAlpha = alpha;
      ctx.fillStyle = p.color;
      if (p.seed < 0.4) sparkle(ctx, p.x, p.y, p.size * 2.2, p.rot);
      else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, TAU);
        ctx.fill();
      }
    },
  };
}

export function SuperBurst({
  anchor,
  colors,
  onDone,
}: {
  /** The element the burst comes out of (the chip's emoji). */
  anchor: HTMLElement;
  colors: EmojiColors;
  /** Played (or skipped): unmount it. */
  onDone: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const canvas = ref.current;
    const at = anchor.getBoundingClientRect();
    const onScreen =
      at.bottom > 0 && at.top < window.innerHeight && at.right > 0 && at.left < window.innerWidth;
    let ctx: CanvasRenderingContext2D | null = null;
    try {
      ctx =
        canvas && onScreen && !document.hidden && live < MAX_LIVE ? canvas.getContext('2d') : null;
    } catch {
      // No canvas support (some test and privacy environments).
    }
    if (!canvas || !ctx) {
      done.current();
      return;
    }
    const g = ctx;
    const dpr = Math.min(MAX_DPR, window.devicePixelRatio || 1);
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const def = burstDef(colors);
    const env = { ...makeEnv(W, H, (Math.random() * 2 ** 31) | 0), s: 1 };
    const parts = Array.from({ length: def.burst ?? 0 }, () => spawnParticle(def, env, true));
    let last: number | null = null;
    let id = 0;
    let stopped = false;
    live += 1;

    // Centred on the emoji, following it if the list scrolls while it plays.
    const place = () => {
      const r = anchor.getBoundingClientRect();
      const x = Math.round(r.left + r.width / 2 - W / 2);
      const y = Math.round(r.top + r.height / 2 - H / 2);
      canvas.style.transform = `translate(${x}px, ${y}px)`;
    };
    const finish = () => {
      if (stopped) return;
      stopped = true;
      live -= 1;
      cancelAnimationFrame(id);
    };
    const frame = (now: number) => {
      if (stopped) return;
      if (!anchor.isConnected) {
        finish();
        done.current();
        return;
      }
      const dt = last === null ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
      last = now;
      env.t += dt;
      place();
      g.clearRect(0, 0, W, H);
      if (env.t < RING_SECONDS) {
        const k = env.t / RING_SECONDS;
        g.globalAlpha = (1 - k) * 0.7;
        g.strokeStyle = colors[0];
        g.lineWidth = 0.6 + 2 * (1 - k);
        g.beginPath();
        g.arc(W / 2, H / 2, 9 + k * 30, 0, TAU);
        g.stroke();
      }
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]!;
        stepParticle(def, p, dt, env);
        if (!isAlive(p, env)) parts.splice(i, 1);
      }
      for (const p of parts) def.draw(g, p, particleAlpha(p), env);
      g.globalAlpha = 1;
      if ((parts.length === 0 && env.t >= RING_SECONDS) || env.t >= MAX_SECONDS) {
        finish();
        g.clearRect(0, 0, W, H);
        done.current();
        return;
      }
      id = requestAnimationFrame(frame);
    };
    place();
    id = requestAnimationFrame(frame);
    return finish;
    // One run per mount: the caller re-keys it to play again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Portal>
      <canvas
        ref={ref}
        aria-hidden
        data-testid="super-burst"
        className="pointer-events-none fixed top-0 left-0 z-[60]"
        style={{ width: W, height: H }}
      />
    </Portal>
  );
}
