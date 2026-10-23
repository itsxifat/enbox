import { describe, expect, it } from 'vitest';
import { dominantColors, lighten } from './emojiColors';

/** RGBA pixels: `n` of each colour (`[r, g, b, a]`). */
function pixels(...runs: [number, [number, number, number, number]][]): Uint8ClampedArray {
  const out: number[] = [];
  for (const [n, rgba] of runs) for (let i = 0; i < n; i++) out.push(...rgba);
  return new Uint8ClampedArray(out);
}

describe('dominantColors (super reaction colours)', () => {
  it('takes the most common hue, then the most common other hue', () => {
    const fire = pixels([60, [255, 80, 0, 255]], [30, [255, 210, 0, 255]], [5, [0, 0, 255, 255]]);
    expect(dominantColors(fire)).toEqual(['#ff5000', '#ffd200']);
  });

  it('ignores transparent, grey, near-black and near-white pixels', () => {
    const heart = pixels(
      [200, [0, 0, 0, 0]],
      [80, [128, 128, 128, 255]],
      [40, [5, 5, 5, 255]],
      [40, [252, 252, 252, 255]],
      [10, [230, 30, 50, 255]],
    );
    // One hue only: the second colour is a lighter shade of it.
    expect(dominantColors(heart)).toEqual(['#e61e32', lighten('#e61e32')]);
    expect(dominantColors(pixels([50, [120, 120, 120, 255]], [50, [0, 0, 0, 0]]))).toBeNull();
    expect(dominantColors(new Uint8ClampedArray(0))).toBeNull();
  });

  it('a second hue needs a real share and some distance', () => {
    // Orange next to red-orange (too close) and a few blue pixels (too few).
    const close = pixels(
      [100, [255, 100, 0, 255]],
      [80, [255, 70, 0, 255]],
      [4, [0, 90, 255, 255]],
    );
    const [, second] = dominantColors(close)!;
    expect(second).toBe(lighten(dominantColors(close)![0]));
  });

  it('lightens towards white', () => {
    expect(lighten('#000000', 0.5)).toBe('#808080');
    expect(lighten('#6d5dfc', 0)).toBe('#6d5dfc');
    expect(lighten('#6d5dfc', 1)).toBe('#ffffff');
  });
});
