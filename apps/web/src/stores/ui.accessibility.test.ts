/** Settings ▸ Accessibility on <html>: what applyAppearance sets, and contrast following the OS. */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, initTheme, resolveContrast, useUi } from './ui';

const MORE = '(prefers-contrast: more)';
const FORCED = '(forced-colors: active)';

type Listener = () => void;
const media = new Map<string, { matches: boolean; listeners: Set<Listener> }>();

function entry(query: string) {
  let m = media.get(query);
  if (!m) {
    m = { matches: false, listeners: new Set() };
    media.set(query, m);
  }
  return m;
}

/** The OS changes a media feature: listeners hear it like a real MediaQueryList's. */
function setMedia(query: string, matches: boolean) {
  const m = entry(query);
  m.matches = matches;
  for (const l of m.listeners) l();
}

const realMatchMedia = window.matchMedia;
beforeAll(() => {
  window.matchMedia = (query: string) => {
    const m = entry(query);
    return {
      get matches() {
        return m.matches;
      },
      media: query,
      onchange: null,
      addEventListener: (_: string, l: Listener) => m.listeners.add(l),
      removeEventListener: (_: string, l: Listener) => m.listeners.delete(l),
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    } as unknown as MediaQueryList;
  };
  initTheme();
});
afterAll(() => {
  window.matchMedia = realMatchMedia;
});

beforeEach(() => {
  setMedia(MORE, false);
  setMedia(FORCED, false);
  useUi.setState({ prefs: { ...DEFAULT_PREFS } });
});

const root = () => document.documentElement;
const set = useUi.getState().setPref;

describe('applyAppearance: Accessibility', () => {
  it('mirrors the prefs on <html> as attributes and variables', () => {
    expect(root().style.getPropertyValue('--saturation')).toBe('1');
    expect(root().style.getPropertyValue('--msg-group-gap')).toBe('16px');
    expect(root().dataset).toMatchObject({
      contrast: 'off',
      underlineLinks: 'false',
      roleColors: 'names',
      saturateRoles: 'false',
      stickerAnimation: 'always',
      animateEmoji: 'true',
    });

    set('saturation', 0.35);
    set('saturateRoleColors', true);
    set('underlineLinks', true);
    set('roleColors', 'dot');
    set('stickerAnimation', 'interaction');
    set('animateEmoji', false);
    set('messageGroupSpacing', 4);
    expect(root().style.getPropertyValue('--saturation')).toBe('0.35');
    expect(root().style.getPropertyValue('--msg-group-gap')).toBe('4px');
    expect(root().dataset).toMatchObject({
      underlineLinks: 'true',
      roleColors: 'dot',
      saturateRoles: 'true',
      stickerAnimation: 'interaction',
      animateEmoji: 'false',
    });
  });

  it('contrast: on and off as set; "Sync with computer" follows the OS while the app runs', () => {
    expect(useUi.getState().prefs.contrast).toBe('system');
    expect(root().dataset.contrast).toBe('off');
    setMedia(MORE, true);
    expect(root().dataset.contrast).toBe('on');
    setMedia(MORE, false);
    expect(root().dataset.contrast).toBe('off');
    // A forced-colours (Windows contrast) theme counts as asking for more contrast.
    setMedia(FORCED, true);
    expect(root().dataset.contrast).toBe('on');
    expect(resolveContrast('system')).toBe('on');

    set('contrast', 'off');
    expect(root().dataset.contrast).toBe('off');
    setMedia(MORE, true);
    expect(root().dataset.contrast).toBe('off');
    set('contrast', 'on');
    setMedia(MORE, false);
    setMedia(FORCED, false);
    expect(root().dataset.contrast).toBe('on');
  });

  it('keeps unusable stored values in range: saturation 0..1, spacing one of the steps', () => {
    set('saturation', 1.7);
    expect(root().style.getPropertyValue('--saturation')).toBe('1');
    set('saturation', -0.5);
    expect(root().style.getPropertyValue('--saturation')).toBe('0');
    set('saturation', Number.NaN);
    expect(root().style.getPropertyValue('--saturation')).toBe('1');
    set('messageGroupSpacing', 13 as never);
    expect(root().style.getPropertyValue('--msg-group-gap')).toBe('16px');
  });

  it('older stored prefs get the Accessibility defaults', () => {
    const merged = useUi.persist.getOptions().merge!(
      { prefs: { sounds: false } },
      useUi.getState(),
    );
    expect(merged.prefs).toMatchObject({
      sounds: false,
      saturation: 1,
      contrast: 'system',
      roleColors: 'names',
      stickerAnimation: 'always',
      messageGroupSpacing: 16,
    });
  });
});
