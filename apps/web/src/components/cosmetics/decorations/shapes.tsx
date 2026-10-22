/**
 * Geometry for the decoration art. Every decoration draws in a 120×120 viewBox: the avatar is
 * the circle of radius 50 around (60, 60), so the art keeps to the ring outside r ≈ 44 (on
 * and around the rim) and leaves the face clear. Angles are degrees clockwise from the top.
 */
import type { CSSProperties, JSX, ReactNode } from 'react';

export const C = 60;
export const AVATAR_R = 50;

export interface ArtProps {
  /** Unique per instance (gradient ids). */
  uid: string;
  /** Small avatars (< 40 px): fewer, bolder parts. */
  lite: boolean;
}
export type DecorationArt = (props: ArtProps) => JSX.Element;

const r2 = (n: number) => Math.round(n * 100) / 100;

/** Point at radius `r`, angle `deg` (0 = top, clockwise). */
export function pt(r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [r2(C + r * Math.cos(a)), r2(C + r * Math.sin(a))];
}

/** Clockwise arc path along the circle of radius `r` from `a0` to `a1` degrees. */
export function arc(r: number, a0: number, a1: number): string {
  const [x0, y0] = pt(r, a0);
  const [x1, y1] = pt(r, a1);
  const sweep = (((a1 - a0) % 360) + 360) % 360;
  return `M${x0} ${y0}A${r} ${r} 0 ${sweep > 180 ? 1 : 0} 1 ${x1} ${y1}`;
}

/** A 4-point sparkle centred on (x, y). */
export function sparkle(x: number, y: number, s: number): string {
  const k = s * 0.22;
  return `M${r2(x)} ${r2(y - s)}Q${r2(x + k)} ${r2(y - k)} ${r2(x + s)} ${r2(y)}Q${r2(x + k)} ${r2(y + k)} ${r2(x)} ${r2(y + s)}Q${r2(x - k)} ${r2(y + k)} ${r2(x - s)} ${r2(y)}Q${r2(x - k)} ${r2(y - k)} ${r2(x)} ${r2(y - s)}Z`;
}

/** A 5-point star centred on (x, y). */
export function star(x: number, y: number, outer: number, inner = outer * 0.45): string {
  const p: string[] = [];
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? inner : outer;
    const a = (i * 36 - 90) * (Math.PI / 180);
    p.push(`${r2(x + r * Math.cos(a))} ${r2(y + r * Math.sin(a))}`);
  }
  return `M${p.join('L')}Z`;
}

/** A heart centred on (x, y), `s` wide. */
export function heart(x: number, y: number, s: number): string {
  const h = s / 2;
  return `M${r2(x)} ${r2(y + h * 0.9)}C${r2(x - h * 1.3)} ${r2(y)} ${r2(x - h)} ${r2(y - h * 1.1)} ${r2(x)} ${r2(y - h * 0.4)}C${r2(x + h)} ${r2(y - h * 1.1)} ${r2(x + h * 1.3)} ${r2(y)} ${r2(x)} ${r2(y + h * 0.9)}Z`;
}

/** A path of `p`-sized squares for a pixel bitmap ('#' = filled), centred on (x, y). */
export function pixels(rows: readonly string[], x: number, y: number, p: number): string {
  const w = rows[0]!.length * p;
  const h = rows.length * p;
  let d = '';
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++)
      if (row[i] === '#')
        d += `M${r2(x - w / 2 + i * p)} ${r2(y - h / 2 + j * p)}h${r2(p)}v${r2(p)}h${r2(-p)}Z`;
  });
  return d;
}

/** Linear interpolation between two `#rrggbb` colours. */
export function mix(a: string, b: string, t: number): string {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return `#${pa
    .map((v, i) =>
      Math.round(v + (pb[i]! - v) * t)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

/** Positioned group (`transform` attribute), so the animated child keeps its CSS transform free. */
export function At({
  x,
  y,
  rotate = 0,
  scale = 1,
  children,
}: {
  x: number;
  y: number;
  rotate?: number;
  scale?: number;
  children: ReactNode;
}) {
  const t = `translate(${r2(x)} ${r2(y)})${rotate ? ` rotate(${r2(rotate)})` : ''}${scale !== 1 ? ` scale(${scale})` : ''}`;
  return <g transform={t}>{children}</g>;
}

/** A moving part: `motion` is a cos-* class from cosmetics.css. */
export function Anim({
  motion,
  delay,
  duration,
  style,
  children,
}: {
  motion: string;
  delay?: number;
  duration?: number;
  style?: CSSProperties;
  children: ReactNode;
}) {
  return (
    <g
      className={`cos-anim ${motion}`}
      style={
        delay || duration || style
          ? {
              ...style,
              ...(delay ? { animationDelay: `${delay}s` } : null),
              ...(duration ? { animationDuration: `${duration}s` } : null),
            }
          : undefined
      }
    >
      {children}
    </g>
  );
}

/** Deterministic pseudo-random sequence (stable art across renders). */
export function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
