import { beforeEach, describe, expect, it } from 'vitest';
import { StorageKeys } from '@/lib/storage';
import { DEFAULT_PREFS, initTheme, useUi } from './ui';

beforeEach(() => {
  useUi.setState({ prefs: DEFAULT_PREFS, theme: 'system', resolvedTheme: 'light' });
});

describe('device prefs', () => {
  it('fills the motion prefs in when an older persisted state lacks them', async () => {
    localStorage.setItem(
      StorageKeys.ui,
      JSON.stringify({
        state: { theme: 'dark', prefs: { enterToSend: false, fontSize: 'large' } },
        version: 1,
      }),
    );
    await useUi.persist.rehydrate();
    const { prefs, theme } = useUi.getState();
    expect(theme).toBe('dark');
    expect(prefs).toEqual({ ...DEFAULT_PREFS, enterToSend: false, fontSize: 'large' });
    expect(prefs.reduceMotion).toBe('system');
    expect(prefs.autoplayAnimatedMedia).toBe('hover');
  });

  it('migrates the v1 wallpaper pref to wallpaperPreset', async () => {
    localStorage.setItem(
      StorageKeys.ui,
      JSON.stringify({
        state: { theme: 'light', prefs: { wallpaper: 'mint', sounds: false } },
        version: 1,
      }),
    );
    await useUi.persist.rehydrate();
    const { prefs } = useUi.getState();
    expect(prefs).toEqual({ ...DEFAULT_PREFS, wallpaperPreset: 'mint', sounds: false });
    expect('wallpaper' in prefs).toBe(false);
  });

  it('mirrors reduceMotion on <html data-reduce-motion>', () => {
    initTheme();
    const root = document.documentElement;
    expect(root.dataset.reduceMotion).toBe('system');
    useUi.getState().setPref('reduceMotion', 'on');
    expect(root.dataset.reduceMotion).toBe('on');
    useUi.getState().setPref('reduceMotion', 'off');
    expect(root.dataset.reduceMotion).toBe('off');
  });

  it('mirrors the chat appearance prefs on <html> as attributes and preset variables', () => {
    initTheme();
    const root = document.documentElement;
    expect(root.dataset.bubbleStyle).toBe('classic');
    expect(root.dataset.msgAnim).toBe('fade');
    expect(root.dataset.wallpaperPreset).toBe('default');
    expect(root.style.getPropertyValue('--bubble-out')).toBe('');

    useUi.getState().setPref('bubbleStyle', 'cozy');
    useUi.getState().setPref('messageAnimation', 'pop');
    useUi.getState().setPref('wallpaperPreset', 'sky');
    useUi.getState().setPref('chatTheme', 'ocean');
    expect(root.dataset.bubbleStyle).toBe('cozy');
    expect(root.dataset.msgAnim).toBe('pop');
    expect(root.dataset.wallpaperPreset).toBe('sky');
    expect(root.style.getPropertyValue('--wallpaper')).toBe('#d9eaf7');
    expect(root.style.getPropertyValue('--bubble-out')).toBe('#d3ecf6');

    useUi.getState().setPref('chatTheme', 'default');
    useUi.getState().setPref('wallpaperPreset', 'default');
    expect(root.style.getPropertyValue('--bubble-out')).toBe('');
    expect(root.style.getPropertyValue('--wallpaper')).toBe('');
  });

  it('keeps the other prefs when one changes', () => {
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    expect(useUi.getState().prefs).toEqual({ ...DEFAULT_PREFS, autoplayAnimatedMedia: 'never' });
  });
});
