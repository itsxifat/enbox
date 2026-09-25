import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_DIMENSION } from '@enbox/shared';
import {
  MAX_ZOOM,
  clampCrop,
  coverScale,
  cropRect,
  initialCrop,
  outputSize,
  zoomCrop,
} from './avatar';

const V = 280;
const landscape = { width: 1200, height: 800 };
const portrait = { width: 600, height: 900 };

describe('avatar crop geometry', () => {
  it('covers the viewport with the short side', () => {
    expect(coverScale(landscape, V)).toBeCloseTo(V / 800);
    expect(coverScale(portrait, V)).toBeCloseTo(V / 600);
  });

  it('starts centered at zoom 1 and crops the middle square', () => {
    const c = initialCrop(landscape, V);
    expect(c.zoom).toBe(1);
    expect(c.y).toBe(0);
    expect(c.x).toBeCloseTo((V - 1200 * (V / 800)) / 2);
    const r = cropRect(c, landscape, V);
    expect(r.size).toBeCloseTo(800);
    expect(r.sx).toBeCloseTo(200);
    expect(r.sy).toBeCloseTo(0);
  });

  it('never lets the image leave the viewport', () => {
    const c = clampCrop({ zoom: 1, x: 50, y: -5000 }, portrait, V);
    expect(c.x).toBe(0);
    expect(c.y).toBeCloseTo(V - 900 * (V / 600));
    const z = clampCrop({ zoom: 99, x: 0, y: 0 }, portrait, V);
    expect(z.zoom).toBe(MAX_ZOOM);
  });

  it('zooming keeps the anchor point fixed', () => {
    const c = initialCrop(landscape, V);
    const before = cropRect(c, landscape, V);
    const z = zoomCrop(c, 2, landscape, V); // around the center
    const after = cropRect(z, landscape, V);
    expect(after.size).toBeCloseTo(before.size / 2);
    // Same center in image coordinates.
    expect(after.sx + after.size / 2).toBeCloseTo(before.sx + before.size / 2);
    expect(after.sy + after.size / 2).toBeCloseTo(before.sy + before.size / 2);
  });

  it('caps the output at AVATAR_MAX_DIMENSION', () => {
    expect(outputSize(2000)).toBe(AVATAR_MAX_DIMENSION);
    expect(outputSize(320.4)).toBe(320);
    expect(outputSize(0)).toBe(1);
  });
});
