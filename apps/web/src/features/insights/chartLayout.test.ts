/** Insights chart layout: clean scales, point and band positions, paths, the day under the pointer. */
import { describe, expect, it } from 'vitest';
import {
  areaPath,
  bandCenter,
  bandLayout,
  barPath,
  divergingBars,
  divergingScale,
  divergingY,
  linePath,
  linePoints,
  nearestIndex,
  niceScale,
  niceStep,
  plotArea,
  pointX,
  tickAnchor,
  xLabelIndices,
} from './chartLayout';

const plot = plotArea(640, 180, { top: 10, right: 12, bottom: 26, left: 28 }); // 600 × 144 at (28, 10)

describe('scales', () => {
  it('steps are clean numbers and never below 1 (counts)', () => {
    expect([0, 0.3, 1, 1.5, 3, 7, 24, 26, 60, 3225].map(niceStep)).toEqual([
      1, 1, 1, 2, 5, 10, 25, 50, 100, 5000,
    ]);
  });

  it('a scale from 0 covers the max with a few clean ticks; all zeros get 0–1', () => {
    expect(niceScale(0)).toEqual({ max: 1, ticks: [0, 1] });
    expect(niceScale(3)).toEqual({ max: 3, ticks: [0, 1, 2, 3] });
    expect(niceScale(5)).toEqual({ max: 6, ticks: [0, 2, 4, 6] });
    expect(niceScale(97)).toEqual({ max: 100, ticks: [0, 25, 50, 75, 100] });
    expect(niceScale(12_900)).toEqual({ max: 15_000, ticks: [0, 5000, 10_000, 15_000] });
  });

  it('a diverging scale shares one step on both sides of the baseline', () => {
    expect(divergingScale(5, 1)).toEqual({ up: 6, down: 2, ticks: [-2, 0, 2, 4, 6] });
    expect(divergingScale(3, 0)).toEqual({ up: 3, down: 0, ticks: [0, 1, 2, 3] });
    expect(divergingScale(0, 0)).toEqual({ up: 1, down: 0, ticks: [0, 1] });
    const s = divergingScale(6, 2);
    // The baseline sits 6/8 of the way down; the ends are the plot's edges.
    expect(divergingY(0, plot, s)).toBe(10 + 144 * 0.75);
    expect(divergingY(6, plot, s)).toBe(10);
    expect(divergingY(-2, plot, s)).toBe(154);
  });
});

describe('lines', () => {
  it('spreads the points edge to edge, the max at the top and zero on the baseline', () => {
    const pts = linePoints([0, 5, 10], plot, 10);
    expect(pts).toEqual([
      { x: 28, y: 154 },
      { x: 328, y: 82 },
      { x: 628, y: 10 },
    ]);
    expect(linePath(pts)).toBe('M28,154L328,82L628,10');
    expect(areaPath(pts, 154)).toBe('M28,154L328,82L628,10L628,154L28,154Z');
    expect(areaPath([], 154)).toBe('');
    // One point sits in the middle.
    expect(pointX(0, 1, plot)).toBe(328);
  });

  it('finds the nearest day under the pointer, clamped to the range', () => {
    expect(nearestIndex(28, 7, plot, 'point')).toBe(0);
    expect(nearestIndex(28 + 100 - 1, 7, plot, 'point')).toBe(1);
    expect(nearestIndex(628, 7, plot, 'point')).toBe(6);
    expect(nearestIndex(-50, 7, plot, 'point')).toBe(0);
    expect(nearestIndex(900, 7, plot, 'point')).toBe(6);
    expect(nearestIndex(28 + 85, 7, plot, 'band')).toBe(0);
    expect(nearestIndex(28 + 86, 7, plot, 'band')).toBe(1);
    expect(nearestIndex(123, 1, plot, 'band')).toBe(0);
  });

  it('labels about one day per 64 px, always today', () => {
    expect(xLabelIndices(7, 600)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    const month = xLabelIndices(30, 600);
    expect(month.at(-1)).toBe(29);
    expect(month.length).toBeLessThanOrEqual(9);
    const quarter = xLabelIndices(90, 300);
    expect(quarter.at(-1)).toBe(89);
    expect(quarter.length).toBeLessThanOrEqual(4);
    expect(xLabelIndices(0, 600)).toEqual([]);
  });

  it('anchors edge labels inward', () => {
    expect(tickAnchor(30, plot)).toBe('start');
    expect(tickAnchor(328, plot)).toBe('middle');
    expect(tickAnchor(620, plot)).toBe('end');
  });
});

describe('bars', () => {
  it('caps bars at 24 px and keeps a 2 px gap between neighbours', () => {
    expect(bandLayout(7, plot)).toMatchObject({ barWidth: 24 });
    const { band, barWidth } = bandLayout(90, plot);
    expect(band).toBeCloseTo(600 / 90);
    expect(barWidth).toBeCloseTo(600 / 90 - 2, 1);
    expect(bandCenter(0, 6, plot)).toBe(78);
  });

  it('rounds the data end (≤ 4 px), square at the baseline; zero bars draw nothing', () => {
    expect(barPath(10, 20, 100, 50)).toBe('M10,100V54A4,4 0 0 1 14,50H26A4,4 0 0 1 30,54V100Z');
    expect(barPath(10, 20, 100, -30)).toBe('M10,100V126A4,4 0 0 0 14,130H26A4,4 0 0 0 30,126V100Z');
    // Thin or short bars get a smaller radius.
    expect(barPath(0, 4, 100, 1)).toBe('M0,100V100A1,1 0 0 1 1,99H3A1,1 0 0 1 4,100V100Z');
    expect(barPath(0, 20, 100, 0)).toBe('');
  });

  it('lays out one pair per day: joins up, leaves down, nothing for zeros', () => {
    const s = divergingScale(4, 2);
    const bars = divergingBars([4, 0, 1], [0, 2, 1], plot, s);
    expect(bars).toHaveLength(3);
    expect(bars.map((b) => [!!b.upPath, !!b.downPath])).toEqual([
      [true, false],
      [false, true],
      [true, true],
    ]);
    // The biggest join reaches the top of the plot, the biggest leave its bottom.
    expect(bars[0]!.upPath).toContain(',10H');
    expect(bars[1]!.downPath).toContain(',154H');
    expect(bars.every((b) => b.width === 24)).toBe(true);
  });
});
