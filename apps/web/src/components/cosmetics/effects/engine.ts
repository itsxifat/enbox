/**
 * A tiny particle runner for profile effects: one requestAnimationFrame loop per visible
 * effect, a hard particle cap per effect, and a still frame to rest on. Framework-free so the
 * effect definitions can be stepped in tests with a fake context and clock.
 */

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Lifetime in seconds. */
  ttl: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  /** Per-particle random 0..1 (phase, variant). */
  seed: number;
  /** Effect-specific extras (code rain glyph indices…). */
  data?: number[];
}

export interface EffectEnv {
  /** Canvas size in CSS px. */
  w: number;
  h: number;
  /** Scale for sizes and speeds relative to a 300 px wide card. */
  s: number;
  rnd: () => number;
  /** Seconds since the run started. */
  t: number;
}

export interface EffectDef {
  /** Particle cap (never exceeded). */
  max: number;
  /** Spawns per second while emitting. */
  rate: number;
  /** Spawned at once when a run starts. */
  burst?: number;
  /** Seconds a 'once' run emits for (default EMIT_SECONDS). */
  emit?: number;
  spawn(p: Particle, env: EffectEnv, burst: boolean): void;
  /** Physics; the default moves by velocity and spins by `vr`. */
  step?(p: Particle, dt: number, env: EffectEnv): void;
  draw(ctx: CanvasRenderingContext2D, p: Particle, alpha: number, env: EffectEnv): void;
  /** A full-surface layer under the particles (aurora, nebula, grid…), 0..1 intensity. */
  field?(ctx: CanvasRenderingContext2D, env: EffectEnv, intensity: number): void;
}

export const EMIT_SECONDS = 3;
/** A 'once' run cross-fades into its still frame for this long after it stops emitting. */
export const SETTLE_SECONDS = 1.2;
/** Field intensity of the still frame. */
export const STILL_LEVEL = 0.4;

export function seededRandom(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeEnv(w: number, h: number, seed = 1): EffectEnv {
  return { w, h, s: Math.min(1.6, Math.max(0.7, w / 300)), rnd: seededRandom(seed), t: 0 };
}

function blank(): Particle {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    age: 0,
    ttl: 1,
    size: 1,
    rot: 0,
    vr: 0,
    color: '#fff',
    seed: 0,
  };
}

export function spawnParticle(def: EffectDef, env: EffectEnv, burst: boolean): Particle {
  const p = blank();
  p.seed = env.rnd();
  def.spawn(p, env, burst);
  return p;
}

export function stepParticle(def: EffectDef, p: Particle, dt: number, env: EffectEnv): void {
  p.age += dt;
  if (def.step) def.step(p, dt, env);
  else {
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  }
}

export function isAlive(p: Particle, env: EffectEnv): boolean {
  const m = 80 * env.s;
  return p.age < p.ttl && p.x > -m && p.x < env.w + m && p.y > -m * 1.5 && p.y < env.h + m;
}

/** Fade in over the first 12 % of the life, out over the last 30 %. */
export function particleAlpha(p: Particle): number {
  const a = Math.min(1, p.age / (0.12 * p.ttl));
  const b = Math.min(1, (p.ttl - p.age) / (0.3 * p.ttl));
  return Math.max(0, Math.min(a, b));
}

/** Field envelope: up in 0.5 s, full, then down to the still level as a 'once' run ends. */
export function fieldIntensity(t: number, mode: 'once' | 'loop', emit: number): number {
  const up = Math.min(1, t / 0.5);
  if (mode === 'loop') return up;
  const fade = emit - 0.3;
  if (t < fade) return up;
  return Math.max(STILL_LEVEL, 1 - ((t - fade) / (SETTLE_SECONDS + 0.3)) * (1 - STILL_LEVEL));
}

/**
 * The resting frame's particles: a few, each advanced to a different point of its life so the
 * frame looks scattered (seeded: the same frame every time).
 */
export function stillParticles(def: EffectDef, env: EffectEnv): Particle[] {
  const rnd = seededRandom(97);
  const local: EffectEnv = { ...env, rnd, t: 0 };
  const n = Math.max(3, Math.min(8, Math.round(def.max / 4)));
  const out: Particle[] = [];
  for (let i = 0; i < n; i++) {
    const p = spawnParticle(def, local, false);
    const until = p.ttl * (0.25 + rnd() * 0.45);
    while (p.age < until) stepParticle(def, p, 1 / 30, local);
    if (isAlive(p, local)) out.push(p);
  }
  return out;
}

/**
 * The still frame: the field dimmed to STILL_LEVEL and the still particles drawn faintly.
 * `fade` scales the particles (a 'once' run cross-fades into it); `field: false` skips the field.
 */
export function drawStill(
  ctx: CanvasRenderingContext2D,
  def: EffectDef,
  env: EffectEnv,
  { fade = 1, field = true, parts }: { fade?: number; field?: boolean; parts?: Particle[] } = {},
): void {
  if (field) {
    ctx.clearRect(0, 0, env.w, env.h);
    if (def.field) def.field(ctx, env, STILL_LEVEL);
  }
  if (fade <= 0) return;
  for (const p of parts ?? stillParticles(def, env))
    def.draw(ctx, p, fade * 0.45 * Math.max(0.4, particleAlpha(p)), env);
}

export interface RunOptions {
  ctx: CanvasRenderingContext2D;
  def: EffectDef;
  w: number;
  h: number;
  mode: 'once' | 'loop';
  seed?: number;
  raf?: (cb: (now: number) => void) => number;
  caf?: (id: number) => void;
  /** A 'once' run finished and drew its still frame. */
  onRest?: () => void;
}

/** Start a run; returns `stop` (cancels the frame loop). */
export function runEffect({
  ctx,
  def,
  w,
  h,
  mode,
  seed = (Math.random() * 2 ** 31) | 0,
  raf = (cb) => requestAnimationFrame(cb),
  caf = (id) => cancelAnimationFrame(id),
  onRest,
}: RunOptions): () => void {
  const env = makeEnv(w, h, seed);
  const emit = def.emit ?? EMIT_SECONDS;
  const parts: Particle[] = [];
  const still = mode === 'once' ? stillParticles(def, makeEnv(w, h)) : [];
  for (let i = 0; i < Math.min(def.burst ?? 0, def.max); i++)
    parts.push(spawnParticle(def, env, true));
  let last: number | null = null;
  let carry = 0;
  let id = 0;
  let stopped = false;

  const frame = (now: number) => {
    if (stopped) return;
    const dt = last === null ? 0 : Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    env.t += dt;
    const emitting = mode === 'loop' || env.t < emit;
    if (emitting) {
      carry += def.rate * dt;
      while (carry >= 1 && parts.length < def.max) {
        carry -= 1;
        parts.push(spawnParticle(def, env, false));
      }
      if (parts.length >= def.max) carry = 0;
    }
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i]!;
      stepParticle(def, p, dt, env);
      if (!isAlive(p, env)) parts.splice(i, 1);
    }
    if (mode === 'once' && env.t >= emit + SETTLE_SECONDS) {
      drawStill(ctx, def, env, { parts: still });
      stopped = true;
      onRest?.();
      return;
    }
    ctx.clearRect(0, 0, w, h);
    if (def.field) def.field(ctx, env, fieldIntensity(env.t, mode, emit));
    // A 'once' run cross-fades its live particles into the still frame while it settles.
    const settle = mode === 'once' ? Math.max(0, Math.min(1, (env.t - emit) / SETTLE_SECONDS)) : 0;
    for (const p of parts) def.draw(ctx, p, particleAlpha(p) * (1 - settle), env);
    if (settle > 0) drawStill(ctx, def, env, { fade: settle, field: false, parts: still });
    id = raf(frame);
  };
  id = raf(frame);
  return () => {
    stopped = true;
    caf(id);
  };
}
