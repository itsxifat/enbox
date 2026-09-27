import { describe, expect, it } from 'vitest';
import type { ChatTheme, SharedChatTheme } from '@enbox/shared';
import { DEFAULT_PREFS } from '@/stores/ui';
import {
  CHAT_THEME_PRESET_DEFS,
  EMPTY_THEME,
  contrastOk,
  normalizeHex,
  resolveAppearance,
} from './presets';

const device = { ...DEFAULT_PREFS, chatTheme: 'forest' as const, wallpaperPreset: 'sand' as const };

describe('resolveAppearance', () => {
  it('resolves field by field: override > shared > device, null falls through', () => {
    const shared: SharedChatTheme = {
      ...EMPTY_THEME,
      preset: 'ocean',
      bubbleStyle: 'rounded',
      wallpaper: { kind: 'preset', id: 'sky' },
      dim: 30,
    };
    const override: ChatTheme = { ...EMPTY_THEME, messageAnimation: 'pop', accent: '#cfe8ff' };
    const a = resolveAppearance({ override, shared, device, resolvedTheme: 'light' });
    expect(a.preset).toBe('ocean');
    expect(a.bubbleStyle).toBe('rounded');
    expect(a.messageAnimation).toBe('pop');
    expect(a.accent).toBe('#cfe8ff');
    // dim/blur come from the layer that supplies the wallpaper (the shared one here).
    expect(a.wallpaper).toEqual({ kind: 'preset', id: 'sky' });
    expect(a.dim).toBe(30);
    expect(a.data).toEqual({
      'data-bubble-style': 'rounded',
      'data-msg-anim': 'pop',
      'data-wallpaper-preset': 'sky',
    });
    const style = a.style as Record<string, string>;
    expect(style['--bubble-in']).toBe(CHAT_THEME_PRESET_DEFS.ocean.light!['--bubble-in']);
    expect(style['--bubble-out']).toBe('#cfe8ff');
    expect(style['--wallpaper']).toBe('#d9eaf7');
  });

  it('falls back to the device prefs, then the tokens', () => {
    const a = resolveAppearance({ override: null, shared: null, device, resolvedTheme: 'dark' });
    expect(a.preset).toBe('forest');
    expect(a.wallpaper).toEqual({ kind: 'preset', id: 'sand' });
    expect((a.style as Record<string, string>)['--wallpaper']).toBe('#211b11');
    const tokens = resolveAppearance({
      override: null,
      shared: null,
      device: DEFAULT_PREFS,
      resolvedTheme: 'light',
    });
    expect(tokens.preset).toBe('default');
    expect((tokens.style as Record<string, string>)['--bubble-out']).toBeUndefined();
  });

  it('drops a low-contrast accent and keeps my media wallpaper private', () => {
    const a = resolveAppearance({
      override: { ...EMPTY_THEME, accent: '#101010', wallpaper: { kind: 'media' }, blur: 8 },
      shared: null,
      device,
      resolvedTheme: 'light',
      media: null,
    });
    expect(a.accent).toBeNull();
    expect(a.wallpaper).toEqual({ kind: 'media' });
    expect(a.media).toBeNull();
    expect(a.blur).toBe(8);
    expect(a.data['data-wallpaper-preset']).toBe('media');
  });
});

describe('contrastOk / normalizeHex', () => {
  it('accepts readable accents per mode and rejects the rest', () => {
    expect(contrastOk('#e7e2ff', 'light')).toBe(true);
    expect(contrastOk('#e7e2ff', 'dark')).toBe(false);
    expect(contrastOk('#3b3192', 'dark')).toBe(true);
    expect(contrastOk('#3b3192', 'light')).toBe(false);
    expect(contrastOk('red', 'light')).toBe(false);
    expect(contrastOk('#ABCDEF', 'light')).toBe(false);
  });

  it('normalises loose input to lowercase #rrggbb', () => {
    expect(normalizeHex('#ABCDEF')).toBe('#abcdef');
    expect(normalizeHex('abc')).toBe('#aabbcc');
    expect(normalizeHex('#12345')).toBeNull();
    expect(normalizeHex('blue')).toBeNull();
  });
});
