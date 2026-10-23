/**
 * Settings ▸ Chats display prefs on <html>: UI density, zoom (and its keyboard shortcuts), the
 * chat font size (old `fontSize` steps still work) and the gradient app themes.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { hexToOklch, oklchToHex } from '@/features/appearance/appThemes';
import { DEFAULT_PREFS, chatFontPx, initTheme, nearestFontSize, useUi } from './ui';

const root = () => document.documentElement;
const prefs = () => useUi.getState().prefs;
const set = useUi.getState().setPref;

beforeAll(() => {
  const meta = document.createElement('meta');
  meta.id = 'theme-color';
  document.head.appendChild(meta);
  initTheme();
});
beforeEach(() =>
  useUi.setState({ theme: 'dark', resolvedTheme: 'dark', prefs: { ...DEFAULT_PREFS } }),
);
afterEach(() => useUi.setState({ prefs: { ...DEFAULT_PREFS } }));

function key(k: string, init: KeyboardEventInit = { ctrlKey: true }) {
  const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init });
  document.body.dispatchEvent(e);
  return e;
}

describe('UI density', () => {
  it('mirrors the density on <html>, default when unknown', () => {
    expect(root().dataset.density).toBe('default');
    set('uiDensity', 'compact');
    expect(root().dataset.density).toBe('compact');
    set('uiDensity', 'spacious');
    expect(root().dataset.density).toBe('spacious');
    set('uiDensity', 'huge' as never);
    expect(root().dataset.density).toBe('default');
  });
});

describe('zoom', () => {
  it('sets --app-zoom and data-zoomed away from 100%, nothing at 100%', () => {
    expect(root().dataset.zoomed).toBeUndefined();
    expect(root().style.getPropertyValue('--app-zoom')).toBe('');
    set('zoom', 1.25);
    expect(root().dataset.zoomed).toBe('');
    expect(root().style.getPropertyValue('--app-zoom')).toBe('1.25');
    set('zoom', 7);
    expect(root().style.getPropertyValue('--app-zoom')).toBe('2');
    set('zoom', 1);
    expect(root().dataset.zoomed).toBeUndefined();
    expect(root().style.getPropertyValue('--app-zoom')).toBe('');
  });

  it('Ctrl / Cmd + = - 0 step through the levels instead of the browser zoom', () => {
    const e = key('=');
    expect(e.defaultPrevented).toBe(true);
    expect(prefs().zoom).toBe(1.1);
    key('+', { metaKey: true, shiftKey: true });
    expect(prefs().zoom).toBe(1.25);
    key('-');
    key('-');
    key('-');
    expect(prefs().zoom).toBe(0.9);
    key('0');
    expect(prefs().zoom).toBe(1);
    // A toast says where it is, with a way back.
    key('-');
    const t = useUi.getState().toasts.find((x) => x.id === 'app-zoom');
    expect(t?.message).toBe('Zoom 90%');
    t?.action?.onClick();
    expect(prefs().zoom).toBe(1);
  });

  it('stays at the ends and ignores keys without Ctrl / Cmd or with Alt', () => {
    set('zoom', 2);
    expect(key('=').defaultPrevented).toBe(true);
    expect(prefs().zoom).toBe(2);
    set('zoom', 0.5);
    key('-');
    expect(prefs().zoom).toBe(0.5);
    set('zoom', 1);
    expect(key('=', {}).defaultPrevented).toBe(false);
    expect(key('=', { ctrlKey: true, altKey: true }).defaultPrevented).toBe(false);
    expect(prefs().zoom).toBe(1);
  });
});

describe('chat font size', () => {
  it('uses chatFontPx (12-24) when set, the old fontSize step otherwise', () => {
    expect(root().style.getPropertyValue('--chat-font-size')).toBe('15px');
    set('fontSize', 'large');
    expect(root().style.getPropertyValue('--chat-font-size')).toBe('17px');
    set('chatFontPx', 20);
    expect(root().style.getPropertyValue('--chat-font-size')).toBe('20px');
    set('chatFontPx', 40);
    expect(root().style.getPropertyValue('--chat-font-size')).toBe('24px');
    expect(chatFontPx({ chatFontPx: 3, fontSize: 'medium' })).toBe(12);
    expect(chatFontPx({ chatFontPx: null, fontSize: 'small' })).toBe(14);
    expect(nearestFontSize(13)).toBe('small');
    expect(nearestFontSize(18)).toBe('large');
  });
});

describe('gradient app themes', () => {
  it('names the theme on <html>; Default removes it', () => {
    expect(root().dataset.appTheme).toBeUndefined();
    set('appTheme', 'aurora');
    expect(root().dataset.appTheme).toBe('aurora');
    set('appTheme', 'not-a-theme' as never);
    expect(root().dataset.appTheme).toBeUndefined();
    set('appTheme', 'default');
    expect(root().dataset.appTheme).toBeUndefined();
  });

  it('Custom sets its colours inline (per mode) and removes them after', () => {
    set('customThemeColors', ['#ff0080', '#00c2ff']);
    set('appTheme', 'custom');
    expect(root().dataset.appTheme).toBe('custom');
    const darkA = root().style.getPropertyValue('--theme-a');
    expect(darkA).toMatch(/^oklch\(0\.\d+ calc\(0\.\d+ \* var\(--saturation, 1\)\) [\d.]+\)$/);
    expect(Number(root().style.getPropertyValue('--theme-hue'))).toBeCloseTo(
      hexToOklch('#ff0080')!.h,
      1,
    );
    expect(root().style.getPropertyValue('--theme-tint')).toBe('1.00');

    useUi.getState().setTheme('light');
    const lightA = root().style.getPropertyValue('--theme-a');
    expect(lightA).not.toBe(darkA);
    // Light mode keeps the stops pale.
    expect(Number(/oklch\(([\d.]+)/.exec(lightA)![1])).toBeGreaterThanOrEqual(0.8);

    // Two greys: no tint.
    set('customThemeColors', ['#808080', '#202020']);
    expect(root().style.getPropertyValue('--theme-tint')).toBe('0.00');

    set('appTheme', 'midnight');
    for (const name of ['--theme-a', '--theme-b', '--theme-hue', '--theme-tint'])
      expect(root().style.getPropertyValue(name)).toBe('');
  });

  it('converts colours like the tokens in index.css', () => {
    // index.css: --brand oklch(0.5863 0.2269 281.34) /* #6d5dfc */
    const brand = hexToOklch('#6d5dfc')!;
    expect(brand.l).toBeCloseTo(0.5863, 3);
    expect(brand.c).toBeCloseTo(0.2269, 3);
    expect(brand.h).toBeCloseTo(281.34, 1);
    expect(oklchToHex(brand)).toBe('#6d5dfc');
    expect(oklchToHex({ l: 0.2195, c: 0.0077, h: 285.74 })).toBe('#1a1a1e');
    expect(hexToOklch('nope')).toBeNull();
  });

  it('tints the browser chrome colour to the theme', () => {
    const meta = document.getElementById('theme-color')!;
    expect(meta.getAttribute('content')).toBe('#1a1a1e');
    set('appTheme', 'ember');
    const ember = meta.getAttribute('content');
    expect(ember).toMatch(/^#[0-9a-f]{6}$/);
    expect(ember).not.toBe('#1a1a1e');
    set('appTheme', 'default');
    expect(meta.getAttribute('content')).toBe('#1a1a1e');
  });
});
