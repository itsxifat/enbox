/** App zoom levels and shortcuts (pure helpers; the wiring is in stores/ui.display.test.ts). */
import { describe, expect, it } from 'vitest';
import { clampZoom, nearestZoomIndex, stepZoom, zoomAfter, zoomLabel, zoomShortcut } from './zoom';

const keys = (key: string, mods: Partial<KeyboardEvent> = { ctrlKey: true }) => ({
  key,
  code: '',
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  ...mods,
});

describe('zoom levels', () => {
  it('clamps to 50%-200%, 100% for nonsense', () => {
    expect(clampZoom(0.1)).toBe(0.5);
    expect(clampZoom(3)).toBe(2);
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(1.104)).toBe(1.1);
  });

  it('steps through the browser levels, snapping odd values', () => {
    expect(stepZoom(1, 1)).toBe(1.1);
    expect(stepZoom(1, -1)).toBe(0.9);
    expect(stepZoom(0.67, -1)).toBe(0.5);
    expect(stepZoom(2, 1)).toBe(2);
    expect(stepZoom(0.5, -1)).toBe(0.5);
    expect(stepZoom(1.3, 1)).toBe(1.5);
    expect(stepZoom(1.3, -1)).toBe(1.25);
    expect(nearestZoomIndex(1)).toBe(5);
    expect(nearestZoomIndex(1.3)).toBe(7);
    expect(zoomLabel(0.67)).toBe('67%');
  });

  it('reads Ctrl / Cmd + = + - _ 0 and the numpad keys', () => {
    expect(zoomShortcut(keys('='))).toBe('in');
    expect(zoomShortcut(keys('+', { metaKey: true }))).toBe('in');
    expect(zoomShortcut(keys('', { ctrlKey: true, code: 'NumpadAdd' }))).toBe('in');
    expect(zoomShortcut(keys('-'))).toBe('out');
    expect(zoomShortcut(keys('_'))).toBe('out');
    expect(zoomShortcut(keys('0'))).toBe('reset');
    expect(zoomShortcut(keys('=', {}))).toBeNull();
    expect(zoomShortcut(keys('=', { ctrlKey: true, altKey: true }))).toBeNull();
    expect(zoomShortcut(keys('k'))).toBeNull();
    expect(zoomAfter('reset', 1.75)).toBe(1);
    expect(zoomAfter('in', 1.75)).toBe(2);
  });
});
