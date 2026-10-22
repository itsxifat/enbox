/**
 * The 17 profile effects (PROFILE_EFFECTS ids). Particles keep to modest caps; most of the
 * motion sits near the top and the edges of the card so the profile text stays readable.
 */
import type { EffectDef, EffectEnv, Particle } from './engine';

type Ctx = CanvasRenderingContext2D;

const pick = <T>(list: readonly T[], r: number): T =>
  list[Math.floor(r * list.length) % list.length]!;
const TAU = Math.PI * 2;

function circle(ctx: Ctx, x: number, y: number, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, TAU);
  ctx.fill();
}

/** A soft glow: a faint wide disc under a bright core. */
function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha: number) {
  ctx.fillStyle = color;
  ctx.globalAlpha = alpha * 0.22;
  circle(ctx, x, y, r * 2.6);
  ctx.globalAlpha = alpha;
  circle(ctx, x, y, r);
}

function sparklePath(ctx: Ctx, x: number, y: number, r: number) {
  const k = r * 0.22;
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x + k, y - k, x + r, y);
  ctx.quadraticCurveTo(x + k, y + k, x, y + r);
  ctx.quadraticCurveTo(x - k, y + k, x - r, y);
  ctx.quadraticCurveTo(x - k, y - k, x, y - r);
  ctx.closePath();
}

function heartPath(ctx: Ctx, x: number, y: number, s: number) {
  const h = s / 2;
  ctx.beginPath();
  ctx.moveTo(x, y + h * 0.9);
  ctx.bezierCurveTo(x - h * 1.3, y, x - h, y - h * 1.1, x, y - h * 0.4);
  ctx.bezierCurveTo(x + h, y - h * 1.1, x + h * 1.3, y, x, y + h * 0.9);
  ctx.closePath();
}

/** Spawn along the top edge (bursts fill the upper part of the card straight away). */
function fromTop(p: Particle, env: EffectEnv, burst: boolean) {
  p.x = env.rnd() * env.w;
  p.y = burst ? env.rnd() * env.h * 0.45 : -12 * env.s;
}

function fromBottom(p: Particle, env: EffectEnv, burst: boolean) {
  p.x = env.rnd() * env.w;
  p.y = burst ? env.h * (0.55 + env.rnd() * 0.45) : env.h + 12 * env.s;
}

/** Falling things that sway as they go. */
function swayStep(amp: number, freq: number) {
  return (p: Particle, dt: number, env: EffectEnv) => {
    p.x += (p.vx + Math.sin(p.age * freq + p.seed * TAU) * amp * env.s) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  };
}

const starfall: EffectDef = {
  max: 14,
  rate: 5,
  burst: 3,
  spawn(p, env, burst) {
    p.x = env.rnd() * env.w * 1.3;
    p.y = burst ? env.rnd() * env.h * 0.3 : -20 * env.s;
    p.vy = (200 + env.rnd() * 120) * env.s;
    p.vx = -p.vy * 0.45;
    p.size = (1.4 + env.rnd() * 1.3) * env.s;
    p.ttl = 1.6 + env.rnd() * 0.8;
    p.color = pick(['#ffffff', '#fff2b8', '#cfe0ff'], env.rnd());
  },
  draw(ctx, p, alpha, env) {
    const len = 30 * env.s;
    const sp = Math.hypot(p.vx, p.vy) || 1;
    const tx = p.x - (p.vx / sp) * len;
    const ty = p.y - (p.vy / sp) * len;
    const g = ctx.createLinearGradient(tx, ty, p.x, p.y);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(1, p.color);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = g;
    ctx.lineWidth = p.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    glow(ctx, p.x, p.y, p.size * 0.9, p.color, alpha);
  },
};

const AURORA = ['#57ffb0', '#3fd6ff', '#b58cff'];

const aurora: EffectDef = {
  max: 16,
  rate: 6,
  burst: 4,
  spawn(p, env) {
    p.x = env.rnd() * env.w;
    p.y = env.rnd() * env.h * 0.4;
    p.size = (0.8 + env.rnd() * 1.1) * env.s;
    p.ttl = 2 + env.rnd() * 1.2;
    p.color = '#ffffff';
  },
  draw(ctx, p, alpha) {
    glow(ctx, p.x, p.y, p.size, p.color, alpha * 0.9);
  },
  field(ctx, env, k) {
    const { w, h, t } = env;
    AURORA.forEach((color, b) => {
      const base = h * (0.16 + b * 0.075);
      const thick = h * (0.11 + b * 0.025);
      const amp = h * 0.035;
      const g = ctx.createLinearGradient(0, base - thick - amp, 0, base + amp);
      g.addColorStop(0, 'rgba(0,0,0,0)');
      g.addColorStop(0.75, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = k * 0.42;
      ctx.fillStyle = g;
      ctx.beginPath();
      const y = (x: number) =>
        base +
        Math.sin(x * 0.011 + t * 0.7 + b * 1.9) * amp +
        Math.sin(x * 0.027 - t * 0.4 + b) * amp * 0.4;
      ctx.moveTo(0, y(0) - thick);
      for (let x = 0; x <= w + 12; x += 12) ctx.lineTo(x, y(x) - thick);
      for (let x = w + 12; x >= 0; x -= 12) ctx.lineTo(x, y(x));
      ctx.closePath();
      ctx.fill();
    });
  },
};

const NEBULA = [
  { x: 0.1, y: 0.08, c: '#ff5fd2' },
  { x: 0.9, y: 0.14, c: '#7b5cff' },
  { x: 0.5, y: -0.02, c: '#3fc8ff' },
  { x: 0.96, y: 0.55, c: '#ff8a5c' },
  { x: 0.04, y: 0.62, c: '#9b6bff' },
];

const nebula: EffectDef = {
  max: 26,
  rate: 9,
  burst: 8,
  spawn(p, env) {
    p.x = env.rnd() * env.w;
    p.y = env.rnd() * env.h;
    p.size = (1.6 + env.rnd() * 2.6) * env.s;
    p.ttl = 1.4 + env.rnd() * 1.2;
    p.color = pick(['#ffffff', '#ffd6f5', '#cfe0ff'], env.rnd());
  },
  draw(ctx, p, alpha) {
    const k = Math.sin((Math.PI * p.age) / p.ttl);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    sparklePath(ctx, p.x, p.y, p.size * (0.4 + 0.6 * k));
    ctx.fill();
  },
  field(ctx, env, k) {
    const { w, h, t } = env;
    const r = Math.max(w, h) * 0.38;
    for (const [i, n] of NEBULA.entries()) {
      const x = w * n.x + Math.sin(t * 0.25 + i * 2) * w * 0.04;
      const y = h * n.y + Math.cos(t * 0.2 + i) * h * 0.03;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, n.c);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.globalAlpha = k * 0.3;
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  },
};

const petals: EffectDef = {
  max: 26,
  rate: 8,
  burst: 8,
  spawn(p, env, burst) {
    fromTop(p, env, burst);
    p.vy = (38 + env.rnd() * 34) * env.s;
    p.vx = (10 + env.rnd() * 22) * env.s;
    p.size = (5 + env.rnd() * 3.6) * env.s;
    p.vr = (env.rnd() - 0.5) * 4;
    p.rot = env.rnd() * TAU;
    p.ttl = 4 + env.rnd() * 2;
    p.color = pick(['#ffb7d0', '#ffc9dc', '#ff9cc0', '#ffe1ec'], env.rnd());
  },
  step: swayStep(22, 2),
  draw(ctx, p, alpha) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, 0.55 + 0.45 * Math.abs(Math.cos(p.age * 2.4 + p.seed * 6)));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.ellipse(0, 0, p.size, p.size * 0.62, 0, 0, TAU);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.6;
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.ellipse(-p.size * 0.3, -p.size * 0.12, p.size * 0.38, p.size * 0.2, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  },
};

const leaves: EffectDef = {
  max: 18,
  rate: 5,
  burst: 6,
  spawn(p, env, burst) {
    fromTop(p, env, burst);
    p.vy = (48 + env.rnd() * 34) * env.s;
    p.vx = (env.rnd() - 0.3) * 20 * env.s;
    p.size = (6 + env.rnd() * 4) * env.s;
    p.vr = (env.rnd() - 0.5) * 5;
    p.rot = env.rnd() * TAU;
    p.ttl = 4 + env.rnd() * 2;
    p.color = pick(['#e8743b', '#d94f2b', '#f2a93b', '#c9772c', '#b5482f'], env.rnd());
  },
  step: swayStep(34, 1.6),
  draw(ctx, p, alpha) {
    const s = p.size;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(Math.cos(p.age * 3 + p.seed * 6), 1);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.quadraticCurveTo(s * 0.9, -s * 0.2, 0, s);
    ctx.quadraticCurveTo(-s * 0.9, -s * 0.2, 0, -s);
    ctx.fill();
    ctx.strokeStyle = 'rgba(90,40,10,0.55)';
    ctx.lineWidth = Math.max(0.6, s * 0.08);
    ctx.beginPath();
    ctx.moveTo(0, -s * 0.85);
    ctx.lineTo(0, s * 1.15);
    ctx.stroke();
    ctx.restore();
  },
};

const fireflies: EffectDef = {
  max: 18,
  rate: 6,
  burst: 6,
  spawn(p, env) {
    p.x = env.rnd() * env.w;
    p.y = env.h * (0.08 + env.rnd() * 0.84);
    p.vx = (env.rnd() - 0.5) * 24 * env.s;
    p.vy = (env.rnd() - 0.5) * 24 * env.s;
    p.size = (1.9 + env.rnd() * 1.6) * env.s;
    p.ttl = 2.4 + env.rnd() * 1.6;
    p.color = pick(['#e9ff7a', '#c8ff5c', '#fff27a'], env.rnd());
  },
  step(p, dt, env) {
    p.vx += (env.rnd() - 0.5) * 60 * env.s * dt;
    p.vy += (env.rnd() - 0.5) * 60 * env.s * dt;
    p.vx *= 1 - 0.6 * dt;
    p.vy *= 1 - 0.6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  },
  draw(ctx, p, alpha) {
    const pulse = 0.55 + 0.45 * Math.sin(p.age * 5 + p.seed * 10);
    glow(ctx, p.x, p.y, p.size, p.color, alpha * pulse);
  },
};

const snowfall: EffectDef = {
  max: 40,
  rate: 14,
  burst: 14,
  spawn(p, env, burst) {
    fromTop(p, env, burst);
    p.size = (1.1 + env.rnd() * 2.4) * env.s;
    p.vy = (26 + p.size * 12) * env.s;
    p.vx = (env.rnd() - 0.5) * 10 * env.s;
    p.ttl = 4 + env.rnd() * 2;
    p.color = '#ffffff';
  },
  step: swayStep(14, 1.4),
  draw(ctx, p, alpha) {
    ctx.globalAlpha = alpha * 0.35;
    ctx.fillStyle = '#8fa9d9';
    circle(ctx, p.x, p.y, p.size + 0.8);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    circle(ctx, p.x, p.y, p.size);
  },
};

const embers: EffectDef = {
  max: 34,
  rate: 12,
  burst: 10,
  spawn(p, env, burst) {
    fromBottom(p, env, burst);
    p.vy = -(42 + env.rnd() * 56) * env.s;
    p.vx = (env.rnd() - 0.5) * 16 * env.s;
    p.size = (1.4 + env.rnd() * 1.8) * env.s;
    p.ttl = 2 + env.rnd() * 1.4;
    p.color = pick(['#ff9a3c', '#ffcf5c', '#ff6a2b'], env.rnd());
  },
  step: swayStep(18, 4),
  draw(ctx, p, alpha) {
    const flick = 0.6 + 0.4 * Math.sin(p.age * 18 + p.seed * 20);
    glow(ctx, p.x, p.y, p.size, p.color, alpha * flick);
  },
};

const rain: EffectDef = {
  max: 46,
  rate: 34,
  burst: 16,
  spawn(p, env, burst) {
    p.x = env.rnd() * (env.w + 60 * env.s) - 10 * env.s;
    p.y = burst ? env.rnd() * env.h : -20 * env.s;
    p.vy = (520 + env.rnd() * 160) * env.s;
    p.vx = -p.vy * 0.16;
    p.size = (0.9 + env.rnd() * 0.6) * env.s;
    p.ttl = 1.4;
    p.color = '#9cc7ff';
  },
  draw(ctx, p, alpha, env) {
    const len = 14 * env.s;
    const sp = Math.hypot(p.vx, p.vy) || 1;
    ctx.globalAlpha = alpha * 0.75;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = p.size;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(p.x - (p.vx / sp) * len, p.y - (p.vy / sp) * len);
    ctx.stroke();
  },
};

const bubbles: EffectDef = {
  max: 18,
  rate: 5,
  burst: 5,
  spawn(p, env, burst) {
    fromBottom(p, env, burst);
    p.vy = -(30 + env.rnd() * 32) * env.s;
    p.size = (3 + env.rnd() * 5) * env.s;
    p.ttl = 4 + env.rnd() * 2;
    p.color = '#8fe3ff';
  },
  step: swayStep(16, 2.5),
  draw(ctx, p, alpha) {
    ctx.globalAlpha = alpha * 0.14;
    ctx.fillStyle = '#bfeeff';
    circle(ctx, p.x, p.y, p.size);
    ctx.globalAlpha = alpha * 0.85;
    ctx.strokeStyle = p.color;
    ctx.lineWidth = Math.max(0.8, p.size * 0.14);
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size, 0, TAU);
    ctx.stroke();
    ctx.strokeStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * 0.62, Math.PI * 1.05, Math.PI * 1.45);
    ctx.stroke();
  },
};

const CONFETTI = ['#ff5c8a', '#ffd34d', '#4dd2ff', '#7cf29a', '#b48cff', '#ff9a3c'];

const confetti: EffectDef = {
  max: 70,
  rate: 6,
  burst: 56,
  spawn(p, env, burst) {
    if (burst) {
      p.x = env.w * (0.3 + env.rnd() * 0.4);
      p.y = -8 * env.s;
      p.vx = (env.rnd() - 0.5) * 300 * env.s;
      p.vy = (30 + env.rnd() * 170) * env.s;
    } else {
      p.x = env.rnd() * env.w;
      p.y = -10 * env.s;
      p.vx = (env.rnd() - 0.5) * 40 * env.s;
      p.vy = (50 + env.rnd() * 60) * env.s;
    }
    p.size = (4 + env.rnd() * 3) * env.s;
    p.rot = env.rnd() * TAU;
    p.vr = (env.rnd() - 0.5) * 12;
    p.ttl = 3 + env.rnd();
    p.color = pick(CONFETTI, env.rnd());
  },
  step(p, dt, env) {
    p.vy += 160 * env.s * dt;
    p.vy = Math.min(p.vy, 170 * env.s);
    p.vx *= 1 - 1.1 * dt;
    p.x += (p.vx + Math.sin(p.age * 3 + p.seed * TAU) * 14 * env.s) * dt;
    p.y += p.vy * dt;
    p.rot += p.vr * dt;
  },
  draw(ctx, p, alpha) {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.scale(1, Math.cos(p.age * 7 + p.seed * 6));
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.size / 2, -p.size * 0.28, p.size, p.size * 0.56);
    ctx.restore();
  },
};

const PIXEL_COLORS = ['#2be8ff', '#ff2bd6', '#ffe14d', '#6bff8f', '#ffffff'];

const pixels: EffectDef = {
  max: 50,
  rate: 6,
  burst: 36,
  spawn(p, env, burst) {
    if (burst) {
      const a = env.rnd() * TAU;
      const v = (80 + env.rnd() * 160) * env.s;
      p.x = env.w / 2;
      p.y = env.h * 0.22;
      p.vx = Math.cos(a) * v;
      p.vy = Math.sin(a) * v;
      p.ttl = 1.4 + env.rnd() * 1.2;
    } else {
      fromBottom(p, env, false);
      p.vy = -(24 + env.rnd() * 30) * env.s;
      p.ttl = 3 + env.rnd() * 2;
    }
    p.size = Math.round((3 + env.rnd() * 3) * env.s);
    p.color = pick(PIXEL_COLORS, env.rnd());
  },
  step(p, dt, env) {
    p.vx *= 1 - 1.4 * dt;
    if (p.vx !== 0) p.vy += 50 * env.s * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  },
  draw(ctx, p, alpha) {
    const g = Math.max(2, p.size);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.fillRect(Math.round(p.x / g) * g, Math.round(p.y / g) * g, g, g);
  },
};

const GLYPHS = '01アイウエオカキクケコサシスセソ<>/{}=+*';
const TRAIL = 9;

const codeRain: EffectDef = {
  max: 14,
  rate: 4,
  burst: 6,
  spawn(p, env, burst) {
    const col = 14 * env.s;
    p.x = Math.floor(env.rnd() * (env.w / col)) * col + col / 2;
    p.y = burst ? env.rnd() * env.h * 0.6 : -env.rnd() * 40 * env.s;
    p.vy = (90 + env.rnd() * 70) * env.s;
    p.ttl = (env.h + TRAIL * col) / p.vy;
    p.data = Array.from({ length: TRAIL }, () => Math.floor(env.rnd() * GLYPHS.length));
  },
  step(p, dt, env) {
    p.y += p.vy * dt;
    if (p.data && env.rnd() < dt * 4)
      p.data[Math.floor(env.rnd() * p.data.length)] = Math.floor(env.rnd() * GLYPHS.length);
  },
  draw(ctx, p, alpha, env) {
    const step = 14 * env.s;
    ctx.font = `${Math.round(12 * env.s)}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    p.data?.forEach((g, k) => {
      ctx.globalAlpha = alpha * (k === 0 ? 1 : 0.75 * (1 - k / TRAIL));
      ctx.fillStyle = k === 0 ? '#d8ffe6' : '#3dff8a';
      ctx.fillText(GLYPHS[g] ?? '0', p.x, p.y - k * step);
    });
  },
};

const hearts: EffectDef = {
  max: 16,
  rate: 5,
  burst: 4,
  spawn(p, env, burst) {
    fromBottom(p, env, burst);
    p.vy = -(40 + env.rnd() * 40) * env.s;
    p.size = (10 + env.rnd() * 7) * env.s;
    p.ttl = 3 + env.rnd() * 1.5;
    p.rot = (env.rnd() - 0.5) * 0.5;
    p.color = pick(['#ff5c8a', '#ff8fb1', '#ff3d6e', '#ffb3c8'], env.rnd());
  },
  step: swayStep(18, 2),
  draw(ctx, p, alpha) {
    const pop = Math.min(1, p.age * 4);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot + Math.sin(p.age * 2 + p.seed * 6) * 0.15);
    ctx.scale(pop, pop);
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    heartPath(ctx, 0, 0, p.size);
    ctx.fill();
    ctx.globalAlpha = alpha * 0.7;
    ctx.fillStyle = '#ffffff';
    circle(ctx, -p.size * 0.22, -p.size * 0.16, p.size * 0.1);
    ctx.restore();
  },
};

const sparkles: EffectDef = {
  max: 24,
  rate: 12,
  burst: 8,
  spawn(p, env) {
    p.x = env.rnd() * env.w;
    p.y = env.rnd() * env.h * 0.7;
    p.vy = -8 * env.s;
    p.size = (6 + env.rnd() * 6) * env.s;
    p.ttl = 0.9 + env.rnd() * 0.6;
    p.rot = env.rnd() * 0.6;
    p.vr = 1.2;
    p.color = pick(['#ffffff', '#fff2a8', '#e3d1ff', '#bdf3ff'], env.rnd());
  },
  draw(ctx, p, alpha) {
    const k = Math.sin((Math.PI * p.age) / p.ttl);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = p.color;
    circle(ctx, 0, 0, p.size * 0.5 * k);
    ctx.globalAlpha = alpha;
    sparklePath(ctx, 0, 0, Math.max(0.5, p.size * k));
    ctx.fill();
    ctx.restore();
  },
};

function magicCenter(env: EffectEnv) {
  return { x: env.w / 2, y: env.h * 0.26, r: Math.min(env.w, env.h) * 0.32 };
}

const magic: EffectDef = {
  max: 22,
  rate: 9,
  burst: 6,
  spawn(p, env) {
    const c = magicCenter(env);
    const a = env.rnd() * TAU;
    p.x = c.x + Math.cos(a) * c.r;
    p.y = c.y + Math.sin(a) * c.r;
    p.vy = -(18 + env.rnd() * 26) * env.s;
    p.size = (1.2 + env.rnd() * 1.4) * env.s;
    p.ttl = 1.5 + env.rnd();
    p.color = pick(['#c9a4ff', '#8ff0ff', '#ffb8f2'], env.rnd());
  },
  draw(ctx, p, alpha) {
    glow(ctx, p.x, p.y, p.size, p.color, alpha);
  },
  field(ctx, env, k) {
    const { x, y, r } = magicCenter(env);
    const lw = 1.2 * env.s;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(env.t * 0.35);
    ctx.lineWidth = lw;
    for (const [color, width, a] of [
      ['#9b6bff', lw * 4, 0.18],
      ['#d9c2ff', lw, 0.6],
    ] as const) {
      ctx.globalAlpha = k * a;
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.moveTo(r * 0.82, 0);
      ctx.arc(0, 0, r * 0.82, 0, TAU);
      // Hexagram.
      for (const off of [0, Math.PI / 3]) {
        for (let i = 0; i <= 3; i++) {
          const ang = off + (i * TAU) / 3 - Math.PI / 2;
          const px = Math.cos(ang) * r * 0.8;
          const py = Math.sin(ang) * r * 0.8;
          if (i === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
      }
      ctx.stroke();
    }
    ctx.globalAlpha = k * 0.55;
    ctx.strokeStyle = '#d9c2ff';
    ctx.lineWidth = lw;
    ctx.beginPath();
    for (let i = 0; i < 24; i++) {
      const ang = (i * TAU) / 24;
      ctx.moveTo(Math.cos(ang) * r * 0.86, Math.sin(ang) * r * 0.86);
      ctx.lineTo(
        Math.cos(ang) * r * (i % 2 ? 0.92 : 0.96),
        Math.sin(ang) * r * (i % 2 ? 0.92 : 0.96),
      );
    }
    ctx.stroke();
    ctx.restore();
  },
};

const neonGrid: EffectDef = {
  max: 14,
  rate: 4,
  burst: 5,
  spawn(p, env) {
    p.x = env.rnd() * env.w;
    p.y = env.rnd() * env.h * 0.45;
    p.size = (1 + env.rnd() * 1.2) * env.s;
    p.ttl = 1.6 + env.rnd() * 1.2;
    p.color = pick(['#2fe0ff', '#ff4fd8', '#ffffff'], env.rnd());
  },
  draw(ctx, p, alpha) {
    glow(ctx, p.x, p.y, p.size, p.color, alpha * 0.8);
  },
  field(ctx, env, k) {
    const { w, h, t } = env;
    const y0 = h * 0.64;
    const glowBand = ctx.createLinearGradient(0, y0 - h * 0.12, 0, y0 + 2);
    glowBand.addColorStop(0, 'rgba(255,79,216,0)');
    glowBand.addColorStop(1, '#ff4fd8');
    ctx.globalAlpha = k * 0.28;
    ctx.fillStyle = glowBand;
    ctx.fillRect(0, y0 - h * 0.12, w, h * 0.12 + 2);
    ctx.globalAlpha = k * 0.42;
    ctx.strokeStyle = '#ff4fd8';
    ctx.lineWidth = 1.2 * env.s;
    ctx.beginPath();
    const rows = 7;
    const phase = (t * 0.45) % 1;
    for (let i = 0; i <= rows; i++) {
      const f = (i + phase) / rows;
      const y = y0 + (h - y0) * f * f;
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
    }
    const cols = 10;
    for (let i = -cols; i <= cols; i++) {
      ctx.moveTo(w / 2 + i * w * 0.035, y0);
      ctx.lineTo(w / 2 + i * w * 0.22, h);
    }
    ctx.stroke();
    ctx.globalAlpha = k * 0.6;
    ctx.strokeStyle = '#2fe0ff';
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(w, y0);
    ctx.stroke();
  },
};

/** Effect per PROFILE_EFFECTS id (the catalogue test fails when one is missing). */
export const EFFECT_DEFS: Readonly<Record<string, EffectDef>> = {
  starfall,
  aurora,
  nebula,
  petals,
  leaves,
  fireflies,
  snowfall,
  embers,
  rain,
  bubbles,
  confetti,
  pixels,
  'code-rain': codeRain,
  hearts,
  sparkles,
  magic,
  'neon-grid': neonGrid,
};

export function effectDef(id: string | null | undefined): EffectDef | null {
  return id && Object.hasOwn(EFFECT_DEFS, id) ? EFFECT_DEFS[id]! : null;
}
