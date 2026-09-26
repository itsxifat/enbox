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

  it('mirrors reduceMotion on <html data-reduce-motion>', () => {
    initTheme();
    const root = document.documentElement;
    expect(root.dataset.reduceMotion).toBe('system');
    useUi.getState().setPref('reduceMotion', 'on');
    expect(root.dataset.reduceMotion).toBe('on');
    useUi.getState().setPref('reduceMotion', 'off');
    expect(root.dataset.reduceMotion).toBe('off');
  });

  it('keeps the other prefs when one changes', () => {
    useUi.getState().setPref('autoplayAnimatedMedia', 'never');
    expect(useUi.getState().prefs).toEqual({ ...DEFAULT_PREFS, autoplayAnimatedMedia: 'never' });
  });
});
