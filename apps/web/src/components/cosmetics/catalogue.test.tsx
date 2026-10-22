import { beforeAll, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { AVATAR_DECORATIONS, NAME_FONTS, NAMEPLATES, PROFILE_EFFECTS } from '@enbox/shared';
import { LOADABLE_NAME_FONTS, NAME_FONT_DEFS, isNameFontRequested, loadNameFont } from '@/lib/nameFonts';
import { AvatarDecoration, preloadDecorationArt } from './AvatarDecoration';
import { DECORATION_ART } from './decorations';
import { EFFECT_DEFS } from './effects/defs';
import { drawStill, makeEnv, runEffect, type EffectDef } from './effects/engine';
import { Nameplate } from './Nameplate';
import { NAMEPLATE_ART } from './nameplates';

let css = '';
beforeAll(() => preloadDecorationArt());

beforeAll(async () => {
  // CSS imports are stubbed under test (`css: false`): read the stylesheet itself.
  const [fs, url] = ['node:fs', 'node:url'];
  const { readFileSync } = (await import(/* @vite-ignore */ fs)) as {
    readFileSync(path: string, encoding: 'utf8'): string;
  };
  const { fileURLToPath } = (await import(/* @vite-ignore */ url)) as {
    fileURLToPath(href: string): string;
  };
  // (Not `new URL(…, import.meta.url)`: Vite rewrites that into an asset URL.)
  css = readFileSync(fileURLToPath(import.meta.url.replace(/[^/]+$/, 'cosmetics.css')), 'utf8');
});

const ids = (list: readonly { id: string }[]) => list.map((i) => i.id).sort();

/** A 2D context that accepts every call (jsdom has no canvas) and counts them. */
function fakeContext() {
  const calls: Record<string, number> = {};
  const props: Record<string, unknown> = {};
  const ctx = new Proxy(props, {
    get(target, key: string) {
      if (key in target) return target[key];
      if (key.startsWith('create')) return () => ({ addColorStop: () => undefined });
      return () => {
        calls[key] = (calls[key] ?? 0) + 1;
      };
    },
    set(target, key: string, value) {
      target[key] = value;
      return true;
    },
  });
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

/** Drive a run frame by frame (16 ms) with a fake clock. */
function drive(def: EffectDef, mode: 'once' | 'loop', frames: number) {
  const { ctx, calls } = fakeContext();
  const queue: ((now: number) => void)[] = [];
  let now = 0;
  let maxDrawn = 0;
  let drawn = 0;
  let finite = true;
  const counted: EffectDef = {
    ...def,
    draw(c, p, alpha, env) {
      drawn++;
      if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(alpha)) finite = false;
      def.draw(c, p, alpha, env);
    },
  };
  const onRest = vi.fn();
  const stop = runEffect({
    ctx,
    def: counted,
    w: 340,
    h: 480,
    mode,
    seed: 42,
    raf: (cb) => queue.push(cb),
    caf: () => undefined,
    onRest,
  });
  let ran = 0;
  while (queue.length && ran < frames) {
    drawn = 0;
    now += 16;
    queue.shift()!(now);
    maxDrawn = Math.max(maxDrawn, drawn);
    ran++;
  }
  stop();
  const pending = queue.length;
  while (queue.length) queue.shift()!((now += 16));
  return { ran, onRest, maxDrawn, finite, calls, pending, afterStop: queue.length };
}

describe('cosmetics catalogue coverage', () => {
  it('has art for every avatar decoration, and nothing else', () => {
    expect(Object.keys(DECORATION_ART).sort()).toEqual(ids(AVATAR_DECORATIONS));
  });

  it('has art for every nameplate, and nothing else', () => {
    expect(Object.keys(NAMEPLATE_ART).sort()).toEqual(ids(NAMEPLATES));
  });

  it('has an effect for every profile effect, and nothing else', () => {
    expect(Object.keys(EFFECT_DEFS).sort()).toEqual(ids(PROFILE_EFFECTS));
  });

  it('has a font for every name font, and a loader for every one but the app font', () => {
    expect(Object.keys(NAME_FONT_DEFS).sort()).toEqual(ids(NAME_FONTS));
    expect([...LOADABLE_NAME_FONTS].sort()).toEqual(ids(NAME_FONTS).filter((id) => id !== 'default'));
    expect(NAME_FONT_DEFS.default.family).toBeNull();
    for (const id of LOADABLE_NAME_FONTS) expect(NAME_FONT_DEFS[id].family).toBeTruthy();
  });

  it('loads every name font once', async () => {
    for (const { id } of NAME_FONTS) await loadNameFont(id);
    for (const id of LOADABLE_NAME_FONTS) expect(isNameFontRequested(id)).toBe(true);
    expect(isNameFontRequested('default')).toBe(false);
  });
});

describe('avatar decoration art', () => {
  // Motion classes the art uses must exist in the stylesheet (a typo would never animate).
  const motionClasses = () =>
    new Set([...css.matchAll(/^\.(cos-[a-z-]+) \{\n\s+--cos-a:/gm)].map((m) => m[1]));
  const keyframes = () => new Set([...css.matchAll(/@keyframes (cos-[a-z-]+)/g)].map((m) => m[1]));

  it.each(AVATAR_DECORATIONS.map((d) => d.id))('%s draws at every size with known motions', (id) => {
    const known = motionClasses();
    for (const size of [24, 40, 144]) {
      const { container, unmount } = render(<AvatarDecoration id={id} size={size} animate="always" />);
      const svg = container.querySelector(`svg[data-decoration="${id}"]`)!;
      expect(svg).not.toBeNull();
      expect(svg).toHaveAttribute('aria-hidden', 'true');
      expect(svg).toHaveAttribute('width', String(Math.round(size * 1.2)));
      expect(svg.querySelectorAll('path, circle, ellipse, rect').length).toBeGreaterThan(0);
      for (const el of svg.querySelectorAll('.cos-anim')) {
        const motion = [...el.classList].find((c) => c !== 'cos-anim');
        expect(motion && known.has(motion), `${id}: ${motion}`).toBe(true);
      }
      unmount();
    }
  });

  it('every motion runs a keyframe that exists', () => {
    const frames = keyframes();
    for (const m of css.matchAll(/--cos-a: (cos-[a-z-]+) /g)) expect(frames.has(m[1]!), m[1]).toBe(true);
    expect(motionClasses().size).toBeGreaterThan(10);
  });

  it('gives each instance its own gradient ids', () => {
    const { container } = render(
      <>
        <AvatarDecoration id="orbit" size={40} />
        <AvatarDecoration id="orbit" size={40} />
      </>,
    );
    const gradients = [...container.querySelectorAll('radialGradient')].map((g) => g.id);
    expect(gradients.length).toBe(4);
    expect(new Set(gradients).size).toBe(4);
    for (const fill of container.querySelectorAll('[fill^="url(#"]')) {
      const ref = fill.getAttribute('fill')!.slice(5, -1);
      expect(gradients).toContain(ref);
    }
  });

  it('draws nothing for an unknown or missing id', () => {
    expect(render(<AvatarDecoration id="not-a-thing" size={40} />).container.innerHTML).toBe('');
    expect(render(<AvatarDecoration id={null} size={40} />).container.innerHTML).toBe('');
    expect(render(<AvatarDecoration id="toString" size={40} />).container.innerHTML).toBe('');
  });
});

describe('nameplate art', () => {
  it.each(NAMEPLATES.map((n) => n.id))('%s renders its layers', (id) => {
    const { container } = render(<Nameplate id={id} />);
    const plate = container.querySelector(`[data-nameplate="${id}"]`) as HTMLElement;
    expect(plate).toHaveClass('cos-plate');
    expect(plate).toHaveAttribute('aria-hidden', 'true');
    const base = plate.firstElementChild as HTMLElement;
    expect(base.style.getPropertyValue('--cos-plate-base')).toContain('gradient');
    const fx = plate.querySelector('.cos-plate-fx') as HTMLElement | null;
    if (fx) expect(fx).toHaveClass('cos-anim');
  });

  it('draws nothing for an unknown or missing id', () => {
    expect(render(<Nameplate id="nope" />).container.innerHTML).toBe('');
    expect(render(<Nameplate id={undefined} />).container.innerHTML).toBe('');
  });
});

describe('profile effect runs', () => {
  it.each(Object.keys(EFFECT_DEFS))('%s plays once, stays under its cap and settles', (id) => {
    const def = EFFECT_DEFS[id]!;
    const run = drive(def, 'once', 600);
    expect(run.onRest).toHaveBeenCalledTimes(1);
    expect(run.pending).toBe(0);
    // ~3 s emitting + the settle, at 16 ms a frame.
    expect(run.ran).toBeGreaterThan(200);
    expect(run.ran).toBeLessThan(300);
    // Live particles plus, while settling, the still frame's few.
    expect(run.maxDrawn).toBeLessThanOrEqual(def.max + 8);
    expect(run.maxDrawn).toBeGreaterThan(0);
    expect(run.finite).toBe(true);
  });

  it.each(Object.keys(EFFECT_DEFS))('%s loops until stopped', (id) => {
    const run = drive(EFFECT_DEFS[id]!, 'loop', 400);
    expect(run.onRest).not.toHaveBeenCalled();
    expect(run.ran).toBe(400);
    // The next frame was still queued when it stopped; it schedules nothing more.
    expect(run.pending).toBe(1);
    expect(run.afterStop).toBe(0);
    expect(run.maxDrawn).toBeLessThanOrEqual(EFFECT_DEFS[id]!.max);
    expect(run.finite).toBe(true);
  });

  it.each(Object.keys(EFFECT_DEFS))('%s draws a still frame', (id) => {
    const { ctx, calls } = fakeContext();
    drawStill(ctx, EFFECT_DEFS[id]!, makeEnv(340, 480));
    expect(calls.clearRect).toBe(1);
    expect(Object.keys(calls).length).toBeGreaterThan(1);
  });
});
