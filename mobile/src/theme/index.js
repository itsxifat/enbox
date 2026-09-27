/**
 * Theme access for components.
 *
 *   const { tw, c, dark, shadow } = useTheme();
 *   <View style={[tw`flex-1 bg-surface`, shadow.card]}><Icon color={c.muted} /></View>
 *
 * `tw` is a twrnc instance built from the active colour set, so the web client's Tailwind
 * classes (`bg-surface-2 rounded-xl px-3`) work as-is. `ColorScope` overrides colours for a
 * subtree (a conversation's chat theme: bubbles, wallpaper, brand-soft, tick colour).
 */
import { createContext, useContext, useMemo } from 'react';
import { create } from 'twrnc';
import { useUi, FONT_SIZES } from '@/stores/ui';
import { DARK, LIGHT, VIOLET, shadowsFor } from './tokens';

export { alpha, mix } from './tokens';

const cache = new Map();

function build(colors, key) {
  let v = cache.get(key);
  if (v) return v;
  const tw = create({
    theme: {
      extend: {
        colors: { ...colors, violet: VIOLET },
      },
    },
  });
  v = { tw, c: colors };
  cache.set(key, v);
  return v;
}

const ThemeContext = createContext(null);

function useBase() {
  const dark = useUi((s) => s.resolvedTheme === 'dark');
  const fontSize = useUi((s) => s.prefs.fontSize);
  return useMemo(() => {
    const { tw, c } = build(dark ? DARK : LIGHT, dark ? 'dark' : 'light');
    return {
      tw,
      c,
      dark,
      scheme: dark ? 'dark' : 'light',
      shadow: shadowsFor(dark ? 'dark' : 'light'),
      /** Message text size (Settings → Chats → Font size), the web's `text-chat`. */
      chatFontSize: FONT_SIZES[fontSize]?.px ?? 15,
    };
  }, [dark, fontSize]);
}

export function ThemeProvider({ children }) {
  const value = useBase();
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme() outside <ThemeProvider>');
  return ctx;
}

/** Override some colours for a subtree (chat themes). `overrides` keys are token names. */
export function ColorScope({ overrides, children }) {
  const parent = useTheme();
  const key = overrides && Object.keys(overrides).length ? JSON.stringify(overrides) : null;
  const value = useMemo(() => {
    if (!key) return parent;
    const colors = { ...parent.c, ...overrides };
    const { tw, c } = build(colors, `${parent.scheme}|${key}`);
    return { ...parent, tw, c };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parent, key]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
