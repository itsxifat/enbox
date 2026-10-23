/**
 * Pure layout of the Insights charts (no DOM): scales with clean ticks, point and band
 * positions, SVG paths, bars rounded at their data end and the day under the pointer.
 * The components (charts.tsx) only draw what these return.
 */

/** The plot inside the SVG (axes and labels sit in the margins). */
export interface Plot {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface Margin {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Scale {
  /** Top of the axis (≥ the data's max). */
  max: number;
  ticks: number[];
}

/** Coordinates rounded to 0.01 px: short paths, stable snapshots (and no -0). */
const r2 = (n: number) => Math.round(n * 100) / 100 || 0;

export function plotArea(width: number, height: number, m: Margin): Plot {
  return {
    left: m.left,
    top: m.top,
    width: Math.max(1, width - m.left - m.right),
    height: Math.max(1, height - m.top - m.bottom),
  };
}

/** A clean step ≥ `rough`: 1, 2, 5 × 10ⁿ (and 2.5 × 10ⁿ from 25 up); counts never step below 1. */
export function niceStep(rough: number): number {
  if (!(rough > 1)) return 1;
  const exp = Math.floor(Math.log10(rough));
  const base = 10 ** exp;
  const f = rough / base;
  const steps = exp >= 1 ? [1, 2, 2.5, 5, 10] : [1, 2, 5, 10];
  return steps.find((s) => f <= s + 1e-9)! * base;
}

/** A scale from 0 with about `count` clean ticks covering `max` (an all-zero series gets 0–1). */
export function niceScale(max: number, count = 4): Scale {
  const step = niceStep(Math.max(0, max) / count);
  const top = Math.max(step, Math.ceil(max / step - 1e-9) * step);
  const ticks: number[] = [];
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(r2(v));
  return { max: top, ticks };
}

/** Line charts: n points spread edge to edge (one point sits in the middle). */
export function pointX(i: number, n: number, plot: Plot): number {
  return r2(n <= 1 ? plot.left + plot.width / 2 : plot.left + (i * plot.width) / (n - 1));
}

export function linePoints(values: readonly number[], plot: Plot, max: number): Point[] {
  const bottom = plot.top + plot.height;
  return values.map((v, i) => ({
    x: pointX(i, values.length, plot),
    y: r2(bottom - (Math.max(0, v) / (max || 1)) * plot.height),
  }));
}

export function linePath(points: readonly Point[]): string {
  return points.map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join('');
}

/** The line closed down to the baseline (the soft area under it). */
export function areaPath(points: readonly Point[], baseline: number): string {
  if (points.length === 0) return '';
  const first = points[0]!;
  const last = points[points.length - 1]!;
  return `${linePath(points)}L${last.x},${r2(baseline)}L${first.x},${r2(baseline)}Z`;
}

/** Bar charts: one band per day; bars ≤ 24 px with a 2 px gap between neighbours. */
export function bandLayout(n: number, plot: Plot): { band: number; barWidth: number } {
  const band = plot.width / Math.max(1, n);
  return { band, barWidth: r2(Math.max(1, Math.min(24, band - 2))) };
}

export function bandCenter(i: number, n: number, plot: Plot): number {
  return r2(plot.left + (plot.width / Math.max(1, n)) * (i + 0.5));
}

/** The day under the pointer at `x` (plot coordinates included), clamped to the range. */
export function nearestIndex(x: number, n: number, plot: Plot, kind: 'point' | 'band'): number {
  if (n <= 1) return 0;
  const rel = x - plot.left;
  const i =
    kind === 'point'
      ? Math.round((rel * (n - 1)) / plot.width)
      : Math.floor((rel * n) / plot.width);
  return Math.min(n - 1, Math.max(0, i));
}

/**
 * The days that get an x-axis label: about one per `minGap` px, counted back from the last
 * day (today always has one).
 */
export function xLabelIndices(n: number, plotWidth: number, minGap = 64): number[] {
  if (n <= 0) return [];
  const fit = Math.max(1, Math.floor(plotWidth / minGap));
  const step = Math.max(1, Math.ceil(n / fit));
  const out: number[] = [];
  for (let i = n - 1; i >= 0; i -= step) out.push(i);
  return out.reverse();
}

/**
 * A diverging scale (joins up, leaves down) with one step for both sides: the baseline sits
 * where `up / (up + down)` of the height is above it, so both directions share the scale.
 */
export function divergingScale(
  maxUp: number,
  maxDown: number,
  count = 4,
): { up: number; down: number; ticks: number[] } {
  const step = niceStep((Math.max(0, maxUp) + Math.max(0, maxDown)) / count);
  const steps = (v: number) => Math.max(0, Math.ceil(v / step - 1e-9)) * step;
  let up = steps(maxUp);
  const down = steps(maxDown);
  if (up + down === 0) up = step;
  const ticks: number[] = [];
  for (let v = -down; v <= up + 1e-9; v += step) ticks.push(r2(v));
  return { up, down, ticks };
}

/** y of a value on a diverging scale. */
export function divergingY(v: number, plot: Plot, s: { up: number; down: number }): number {
  return r2(plot.top + ((s.up - v) / (s.up + s.down)) * plot.height);
}

/**
 * A bar from the baseline `y0`, square there and rounded (≤ 4 px) at its data end: `h` > 0
 * grows up, `h` < 0 down. Empty for a zero bar.
 */
export function barPath(x: number, w: number, y0: number, h: number, radius = 4): string {
  if (h === 0 || w <= 0) return '';
  const len = Math.abs(h);
  const r = r2(Math.min(radius, w / 2, len));
  const [x0, x1] = [r2(x), r2(x + w)];
  const base = r2(y0);
  if (h > 0) {
    const end = r2(y0 - len);
    return `M${x0},${base}V${r2(end + r)}A${r},${r} 0 0 1 ${r2(x0 + r)},${end}H${r2(x1 - r)}A${r},${r} 0 0 1 ${x1},${r2(end + r)}V${base}Z`;
  }
  const end = r2(y0 + len);
  return `M${x0},${base}V${r2(end - r)}A${r},${r} 0 0 0 ${r2(x0 + r)},${end}H${r2(x1 - r)}A${r},${r} 0 0 0 ${x1},${r2(end - r)}V${base}Z`;
}

export interface DivergingBar {
  index: number;
  x: number;
  width: number;
  /** Empty when the value is 0. */
  upPath: string;
  downPath: string;
}

/** One bar pair per day: `up[i]` above the baseline, `down[i]` below (both ≥ 0). */
export function divergingBars(
  up: readonly number[],
  down: readonly number[],
  plot: Plot,
  s: { up: number; down: number },
): DivergingBar[] {
  const n = up.length;
  const { barWidth } = bandLayout(n, plot);
  const base = divergingY(0, plot, s);
  const unit = plot.height / (s.up + s.down);
  return up.map((u, i) => {
    const x = bandCenter(i, n, plot) - barWidth / 2;
    return {
      index: i,
      x: r2(x),
      width: barWidth,
      upPath: barPath(x, barWidth, base, Math.max(0, u) * unit),
      downPath: barPath(x, barWidth, base, -Math.max(0, down[i] ?? 0) * unit),
    };
  });
}

/** Where the label of an x tick anchors so it stays inside the SVG. */
export function tickAnchor(x: number, plot: Plot, room = 24): 'start' | 'middle' | 'end' {
  if (x - plot.left < room) return 'start';
  if (plot.left + plot.width - x < room) return 'end';
  return 'middle';
}
