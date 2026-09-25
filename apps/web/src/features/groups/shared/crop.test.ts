import { describe, expect, it } from 'vitest';
import { AVATAR_MAX_DIMENSION } from '@enbox/shared';
import { MAX_ZOOM, clampOffset, clampZoom, coverScale, cropRect, zoomAt } from './crop';

const landscape = { width: 2000, height: 1000 };
const square = { width: 800, height: 800 };

describe('avatar crop math', () => {
  it('covers the viewport with the shorter side', () => {
    expect(coverScale(landscape, 250)).toBe(0.25);
    expect(coverScale(square, 400)).toBe(0.5);
    expect(coverScale({ width: 0, height: 10 }, 100)).toBe(1);
  });

  it('clamps zoom to [1, MAX_ZOOM]', () => {
    expect(clampZoom(0.2)).toBe(1);
    expect(clampZoom(99)).toBe(MAX_ZOOM);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(2)).toBe(2);
  });

  it('keeps the image covering the viewport', () => {
    // landscape at zoom 1: drawn 500×250 in a 250 view → x may move ±125, y not at all.
    expect(clampOffset({ x: 500, y: 40 }, landscape, 250, 1)).toEqual({ x: 125, y: 0 });
    expect(clampOffset({ x: -500, y: -40 }, landscape, 250, 1)).toEqual({ x: -125, y: 0 });
    // zoom 2: drawn 1000×500 → ±375 / ±125
    expect(clampOffset({ x: 1000, y: 1000 }, landscape, 250, 2)).toEqual({ x: 375, y: 125 });
  });

  it('crops the centered square by default', () => {
    const r = cropRect(landscape, 250, 1, { x: 0, y: 0 });
    expect(r.size).toBe(1000);
    expect(r.sx).toBe(500);
    expect(r.sy).toBe(0);
    expect(r.out).toBe(AVATAR_MAX_DIMENSION);
  });

  it('moves the crop opposite to the drag and shrinks it when zoomed', () => {
    const left = cropRect(landscape, 250, 1, { x: 125, y: 0 });
    expect(left.sx).toBe(0);
    const zoomed = cropRect(square, 400, 2, { x: 0, y: 0 });
    expect(zoomed.size).toBe(400);
    expect(zoomed.sx).toBe(200);
    expect(zoomed.sy).toBe(200);
    expect(zoomed.out).toBe(400);
  });

  it('zooms around an anchor point', () => {
    // Zooming at the center keeps the offset centered.
    expect(zoomAt({ x: 0, y: 0 }, square, 400, 1, 2)).toEqual({ x: 0, y: 0 });
    // Zooming at the right edge pulls the image left (point under the cursor stays fixed).
    const o = zoomAt({ x: 0, y: 0 }, square, 400, 1, 2, { x: 100, y: 0 });
    expect(o.x).toBe(-100);
    expect(o.y).toBe(0);
  });
});
