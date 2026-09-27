/**
 * UI store — per-device preferences (persisted in localStorage `enbox.ui`), theme, toasts
 * and the confirm-dialog queue. Nothing here is account data, so it survives logout.
 *
 * State
 * - `theme`: 'light' | 'dark' | 'system'; `resolvedTheme`: 'light' | 'dark'
 * - `prefs`: { enterToSend, fontSize, wallpaperPattern, sounds, desktopNotifications,
 *   reduceMotion, autoplayAnimatedMedia, chatTheme, bubbleStyle, messageAnimation,
 *   wallpaperPreset, wallpaperDim, wallpaperBlur }
 * - `toasts`: Toast[]; `dialogs`: DialogRequest[] (rendered by <Toaster/> / <DialogHost/>)
 *
 * Actions: `setTheme(t)`, `setPref(key, value)`, `pushToast`, `dismissToast`
 *
 * Imperative helpers (use anywhere, no hooks needed):
 *   toast.success('Saved'); toast.error(err); toast.info('Copied', { action: { label: 'Undo', onClick } });
 *   if (await confirm({ title: 'Delete chat?', confirmLabel: 'Delete', danger: true })) …
 *   const choice = await choose({ title: 'Delete message?', options: [
 *     { value: 'everyone', label: 'Delete for everyone', danger: true },
 *     { value: 'me', label: 'Delete for me', danger: true } ] });  // → 'everyone' | 'me' | null
 *
 * Call `initTheme()` once at startup (after `hydrateStorage()`): it loads the persisted prefs
 * and follows the OS light/dark setting while the theme is 'system'. Components read colours
 * through `useTheme()` (src/theme), which re-renders on `resolvedTheme` / `prefs.fontSize`.
 */
import { Appearance } from 'react-native';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { errorMessage, isSessionChangedError } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { StorageKeys, zustandStorage } from '@/lib/storage';

export const DEFAULT_PREFS = {
  enterToSend: true,
  fontSize: 'medium',
  wallpaperPattern: true,
  sounds: true,
  desktopNotifications: true,
  reduceMotion: 'system',
  autoplayAnimatedMedia: 'hover',
  chatTheme: 'default',
  bubbleStyle: 'classic',
  messageAnimation: 'fade',
  wallpaperPreset: 'default',
  wallpaperDim: 0,
  wallpaperBlur: 0,
};

export const FONT_SIZES = {
  small: { label: 'Small', px: 14 },
  medium: { label: 'Medium', px: 15 },
  large: { label: 'Large', px: 17 },
};

/** Browser chrome color per theme (keep in sync with --surface and index.html). */
export const THEME_COLORS = { light: '#ffffff', dark: '#111117' };

function systemPrefersDark() {
  return Appearance.getColorScheme() === 'dark';
}

function resolveTheme(theme) {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark()) ? 'dark' : 'light';
}

export const useUi = create()(
  persist(
    (set, get) => ({
      theme: 'system',
      resolvedTheme: resolveTheme('system'),
      prefs: DEFAULT_PREFS,
      toasts: [],
      dialogs: [],

      setTheme(theme) {
        set({ theme, resolvedTheme: resolveTheme(theme) });
      },

      setPref(key, value) {
        set((s) => ({ prefs: { ...s.prefs, [key]: value } }));
      },

      pushToast(kind, message, opts = {}) {
        const id = opts.id ?? newClientId();
        const t = {
          id,
          kind,
          message,
          description: opts.description,
          action: opts.action,
          duration: opts.duration ?? (kind === 'error' ? 6000 : 3500),
        };
        set((s) => ({ toasts: [...s.toasts.filter((x) => x.id !== id), t].slice(-4) }));
        return id;
      },

      dismissToast(id) {
        if (get().toasts.some((t) => t.id === id))
          set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
      },

      openDialog(req) {
        const id = newClientId();
        set((s) => ({ dialogs: [...s.dialogs, { ...req, id }] }));
        return id;
      },

      closeDialog(id, value) {
        const d = get().dialogs.find((x) => x.id === id);
        if (!d) return;
        set((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== id) }));
        d.resolve(value);
      },
    }),
    {
      name: StorageKeys.ui,
      storage: createJSONStorage(() => zustandStorage),
      // Rehydrated by initTheme() once the storage copy is loaded.
      skipHydration: true,
      version: 2,
      partialize: (s) => ({ theme: s.theme, prefs: s.prefs }),
      // Partial states are fine here: `merge` below fills the defaults in.
      migrate: (persisted, version) => {
        const p = persisted ?? {};
        // v1 kept the flat wallpaper colour as `prefs.wallpaper`; v2 calls it `wallpaperPreset`.
        if (version < 2 && p.prefs && typeof p.prefs.wallpaper === 'string') {
          const { wallpaper, ...rest } = p.prefs;
          return { ...p, prefs: { ...rest, wallpaperPreset: wallpaper } };
        }
        return p;
      },
      merge: (persisted, current) => {
        const p = persisted ?? {};
        const theme = p.theme ?? current.theme;
        return {
          ...current,
          theme,
          resolvedTheme: resolveTheme(theme),
          prefs: { ...DEFAULT_PREFS, ...p.prefs },
        };
      },
    },
  ),
);

// ---------------------------------------------------------------------------
// Imperative helpers
// ---------------------------------------------------------------------------

export const toast = {
  success: (message, opts) => useUi.getState().pushToast('success', message, opts),
  info: (message, opts) => useUi.getState().pushToast('info', message, opts),
  /**
   * Accepts a message or any thrown value (ApiError → its message). Failures of requests that
   * belonged to a previous session (logout meanwhile) are not shown.
   */
  error: (error, opts) =>
    isSessionChangedError(error)
      ? ''
      : useUi
          .getState()
          .pushToast('error', typeof error === 'string' ? error : errorMessage(error), opts),
  dismiss: (id) => useUi.getState().dismissToast(id),
};

/** Promise-based confirm dialog. Resolves true on confirm, false on cancel/dismiss. */
export function confirm(opts) {
  return new Promise((resolve) => {
    useUi.getState().openDialog({
      title: opts.title,
      message: opts.message,
      confirmLabel: opts.confirmLabel ?? 'OK',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: opts.danger ?? false,
      resolve: (v) => resolve(v === 'confirm'),
    });
  });
}

/** Promise-based multiple-choice dialog. Resolves the chosen value or null when cancelled. */
export function choose(opts) {
  return new Promise((resolve) => {
    useUi.getState().openDialog({
      title: opts.title,
      message: opts.message,
      options: opts.options,
      confirmLabel: '',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: false,
      resolve: (v) => resolve(v),
    });
  });
}

// ---------------------------------------------------------------------------
// Theme application
// ---------------------------------------------------------------------------

let themeInitialized = false;

/** Load the persisted prefs and keep `resolvedTheme` in sync with the OS setting. */
export function initTheme() {
  if (themeInitialized) return;
  themeInitialized = true;
  void useUi.persist.rehydrate();
  Appearance.addChangeListener(() => {
    const { theme } = useUi.getState();
    if (theme === 'system') useUi.setState({ resolvedTheme: resolveTheme('system') });
  });
}
