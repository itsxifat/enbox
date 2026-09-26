import { describe, expect, it } from 'vitest';
import { BANNER_ASPECT } from '@enbox/shared';
import {
  BANNER_MAX_DIMENSION,
  MAX_ZOOM,
  bannerViewport,
  clampCrop,
  coverScale,
  cropRect,
  initialCrop,
  outputSize,
  zoomCrop,
} from './banner';

const V = bannerViewport(500); // 500 × 200
const wide = { width: 3000, height: 600 }; // 5:1 — wider than the viewport
const tall = { width: 800, height: 1200 };
const exact = { width: 1000, height: 400 }; // 5:2

describe('banner crop geometry', () => {
  it('derives the viewport from BANNER_ASPECT', () => {
    expect(BANNER_ASPECT).toEqual([5, 2]);
    expect(V).toEqual({ width: 500, height: 200 });
    expect(bannerViewport(333)).toEqual({ width: 333, height: 133 });
  });

  it('covers the viewport with the tighter side', () => {
    expect(coverScale(wide, V)).toBeCloseTo(200 / 600); // height limits
    expect(coverScale(tall, V)).toBeCloseTo(500 / 800); // width limits
    expect(coverScale(exact, V)).toBeCloseTo(0.5);
  });

  it('starts centered at zoom 1 and crops the middle band', () => {
    const c = initialCrop(wide, V);
    expect(c.zoom).toBe(1);
    expect(c.y).toBe(0);
    expect(c.x).toBeCloseTo((500 - 3000 * (200 / 600)) / 2);
    const r = cropRect(c, wide, V);
    expect(r.height).toBeCloseTo(600);
    expect(r.width).toBeCloseTo(1500);
    expect(r.sx).toBeCloseTo(750);
    expect(r.sy).toBeCloseTo(0);
    // A tall image is centered vertically instead.
    const t = initialCrop(tall, V);
    expect(t.x).toBe(0);
    expect(cropRect(t, tall, V)).toMatchObject({ sx: 0, width: 800, height: 320 });
    expect(cropRect(t, tall, V).sy).toBeCloseTo((1200 - 320) / 2);
  });

  it('keeps the viewport aspect ratio in the source rect at any zoom', () => {
    const c = zoomCrop(initialCrop(tall, V), 2.5, tall, V, { x: 40, y: 10 });
    const r = cropRect(c, tall, V);
    expect(r.width / r.height).toBeCloseTo(V.width / V.height);
    expect(r.sx).toBeGreaterThanOrEqual(0);
    expect(r.sy).toBeGreaterThanOrEqual(0);
    expect(r.sx + r.width).toBeLessThanOrEqual(tall.width + 1e-9);
    expect(r.sy + r.height).toBeLessThanOrEqual(tall.height + 1e-9);
  });

  it('never lets the image leave the viewport', () => {
    const c = clampCrop({ zoom: 1, x: 50, y: -5000 }, tall, V);
    expect(c.x).toBe(0);
    expect(c.y).toBeCloseTo(200 - 1200 * (500 / 800));
    const z = clampCrop({ zoom: 99, x: 0, y: 0 }, tall, V);
    expect(z.zoom).toBe(MAX_ZOOM);
    const exactFit = clampCrop({ zoom: 1, x: -30, y: 30 }, exact, V);
    expect(exactFit).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('zooming keeps the anchor point fixed', () => {
    const c = initialCrop(wide, V);
    const before = cropRect(c, wide, V);
    const z = zoomCrop(c, 2, wide, V); // around the center
    const after = cropRect(z, wide, V);
    expect(after.width).toBeCloseTo(before.width / 2);
    expect(after.height).toBeCloseTo(before.height / 2);
    expect(after.sx + after.width / 2).toBeCloseTo(before.sx + before.width / 2);
    expect(after.sy + after.height / 2).toBeCloseTo(before.sy + before.height / 2);
  });

  it('caps the output at BANNER_MAX_DIMENSION keeping the aspect', () => {
    expect(outputSize({ width: 4000, height: 1600 })).toEqual({
      width: BANNER_MAX_DIMENSION,
      height: 640,
    });
    expect(outputSize({ width: 1000.4, height: 400.2 })).toEqual({ width: 1000, height: 400 });
    expect(outputSize({ width: 0.2, height: 0.1 })).toEqual({ width: 1, height: 1 });
    expect(outputSize({ width: 2400, height: 960 }, 960)).toEqual({ width: 960, height: 384 });
  });
});
