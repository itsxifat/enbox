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
 * Call `initTheme()` once at startup (main.tsx) to apply the theme, font size, the device
 * chat appearance (`data-bubble-style` / `data-msg-anim` / `data-wallpaper-preset` + the preset
 * variables, see features/appearance/presets.ts) and the `data-reduce-motion` attribute.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ReactNode } from 'react';
import type {
  BubbleStyle,
  ChatThemePreset,
  MessageAnimation,
  WallpaperPresetId,
} from '@enbox/shared';
import { devicePresetVars } from '@/features/appearance/presets';
import { errorMessage, isSessionChangedError } from '@/lib/api';
import { newClientId } from '@/lib/ids';
import { StorageKeys } from '@/lib/storage';

export type ThemePref = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';
export type FontSize = 'small' | 'medium' | 'large';
/** 'system' follows `prefers-reduced-motion`; 'on' forces it; 'off' ignores the OS setting. */
export type ReduceMotionPref = 'system' | 'on' | 'off';
/** Animated images (GIF / WebP / APNG avatars, chat GIFs): play always, on hover/tap, or never. */
export type AutoplayAnimatedMedia = 'always' | 'hover' | 'never';

export interface DevicePrefs {
  /** Enter sends (Shift+Enter = newline). Mobile keyboards always insert newlines. */
  enterToSend: boolean;
  /** Chat text size (sets `--chat-font-size`; use the `text-chat` utility). */
  fontSize: FontSize;
  /** Faint dot pattern over the wallpaper. */
  wallpaperPattern: boolean;
  /** In-app sounds (incoming message, sent). */
  sounds: boolean;
  /** System notifications on this device while Enbox is in the background. */
  desktopNotifications: boolean;
  /** Reduced motion: read through `useReducedMotion()`, mirrored on `html[data-reduce-motion]`. */
  reduceMotion: ReduceMotionPref;
  /** Animated avatars and GIF bubbles: 'hover' shows the poster until hovered or tapped. */
  autoplayAnimatedMedia: AutoplayAnimatedMedia;
  /**
   * Device defaults of the chat appearance (features/appearance): the layer under a chat's
   * shared theme and my private override. 'default' / 'classic' / 'fade' = the design tokens.
   */
  chatTheme: ChatThemePreset;
  bubbleStyle: BubbleStyle;
  messageAnimation: MessageAnimation;
  wallpaperPreset: WallpaperPresetId;
  /** Darkening overlay over the wallpaper, 0..WALLPAPER_DIM_MAX percent. */
  wallpaperDim: number;
  /** Backdrop blur of an uploaded wallpaper, 0..WALLPAPER_BLUR_MAX px. */
  wallpaperBlur: number;
}

export const DEFAULT_PREFS: DevicePrefs = {
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

export const FONT_SIZES: Record<FontSize, { label: string; px: number }> = {
  small: { label: 'Small', px: 14 },
  medium: { label: 'Medium', px: 15 },
  large: { label: 'Large', px: 17 },
};

/** Browser chrome color per theme (keep in sync with --surface and index.html). */
export const THEME_COLORS: Record<ResolvedTheme, string> = { light: '#ffffff', dark: '#111117' };

export type ToastKind = 'success' | 'error' | 'info';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  description?: string;
  action?: ToastAction;
  /** ms before auto-dismiss; 0 = sticky. */
  duration: number;
}

export interface ToastOptions {
  description?: string;
  action?: ToastAction;
  duration?: number;
  /** Replace an existing toast with this id instead of stacking. */
  id?: string;
}

export interface ChoiceOption<T extends string = string> {
  value: T;
  label: string;
  danger?: boolean;
}

export interface DialogRequest {
  id: string;
  title: ReactNode;
  message?: ReactNode;
  /** Two-button confirm when absent; a vertical list of choices when present. */
  options?: ChoiceOption[];
  confirmLabel: string;
  cancelLabel: string;
  danger: boolean;
  resolve: (value: string | null) => void;
}

export interface UiState {
  theme: ThemePref;
  resolvedTheme: ResolvedTheme;
  prefs: DevicePrefs;
  toasts: Toast[];
  dialogs: DialogRequest[];

  setTheme(theme: ThemePref): void;
  setPref<K extends keyof DevicePrefs>(key: K, value: DevicePrefs[K]): void;
  pushToast(kind: ToastKind, message: string, opts?: ToastOptions): string;
  dismissToast(id: string): void;
  openDialog(req: Omit<DialogRequest, 'id'>): string;
  closeDialog(id: string, value: string | null): void;
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

function resolveTheme(theme: ThemePref): ResolvedTheme {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark()) ? 'dark' : 'light';
}

export const useUi = create<UiState>()(
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
        const t: Toast = {
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
      version: 2,
      partialize: (s) => ({ theme: s.theme, prefs: s.prefs }),
      // Partial states are fine here: `merge` below fills the defaults in.
      migrate: (persisted, version) => {
        type Persisted = Pick<UiState, 'theme' | 'prefs'>;
        const p = (persisted ?? {}) as { prefs?: Record<string, unknown> };
        // v1 kept the flat wallpaper colour as `prefs.wallpaper`; v2 calls it `wallpaperPreset`.
        if (version < 2 && p.prefs && typeof p.prefs.wallpaper === 'string') {
          const { wallpaper, ...rest } = p.prefs;
          return { ...p, prefs: { ...rest, wallpaperPreset: wallpaper } } as unknown as Persisted;
        }
        return p as unknown as Persisted;
      },
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Pick<UiState, 'theme' | 'prefs'>>;
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
  success: (message: string, opts?: ToastOptions) =>
    useUi.getState().pushToast('success', message, opts),
  info: (message: string, opts?: ToastOptions) => useUi.getState().pushToast('info', message, opts),
  /**
   * Accepts a message or any thrown value (ApiError → its message). Failures of requests that
   * belonged to a previous session (logout meanwhile) are not shown.
   */
  error: (error: unknown, opts?: ToastOptions) =>
    isSessionChangedError(error)
      ? ''
      : useUi
          .getState()
          .pushToast('error', typeof error === 'string' ? error : errorMessage(error), opts),
  dismiss: (id: string) => useUi.getState().dismissToast(id),
};

export interface ConfirmOptions {
  title: ReactNode;
  message?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

/** Promise-based confirm dialog. Resolves true on confirm, false on cancel/dismiss. */
export function confirm(opts: ConfirmOptions): Promise<boolean> {
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

export interface ChooseOptions<T extends string> {
  title: ReactNode;
  message?: ReactNode;
  options: ChoiceOption<T>[];
  cancelLabel?: string;
}

/** Promise-based multiple-choice dialog. Resolves the chosen value or null when cancelled. */
export function choose<T extends string>(opts: ChooseOptions<T>): Promise<T | null> {
  return new Promise((resolve) => {
    useUi.getState().openDialog({
      title: opts.title,
      message: opts.message,
      options: opts.options,
      confirmLabel: '',
      cancelLabel: opts.cancelLabel ?? 'Cancel',
      danger: false,
      resolve: (v) => resolve(v as T | null),
    });
  });
}

// ---------------------------------------------------------------------------
// Theme application
// ---------------------------------------------------------------------------

/** Every variable a preset may set (cleared when the device goes back to the tokens). */
const DEVICE_PRESET_VAR_NAMES = [
  '--bubble-out',
  '--bubble-out-meta',
  '--bubble-in',
  '--bubble-in-meta',
  '--wallpaper',
  '--wallpaper-ink',
  '--brand-soft',
  '--tick-read',
] as const;

function applyAppearance(s: Pick<UiState, 'resolvedTheme' | 'prefs'>): void {
  const root = document.documentElement;
  const dark = s.resolvedTheme === 'dark';
  root.classList.toggle('dark', dark);
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.getElementById('theme-color')?.setAttribute('content', THEME_COLORS[s.resolvedTheme]);
  root.style.setProperty('--chat-font-size', `${FONT_SIZES[s.prefs.fontSize]?.px ?? 15}px`);
  // Device-level chat appearance: the preset variables on <html> (a conversation root
  // overrides them with its own resolved theme) and the data attributes the CSS keys on.
  const vars = devicePresetVars(s.prefs, s.resolvedTheme);
  for (const name of DEVICE_PRESET_VAR_NAMES) {
    const value = vars[name];
    if (value) root.style.setProperty(name, value);
    else root.style.removeProperty(name);
  }
  root.dataset.bubbleStyle = s.prefs.bubbleStyle;
  root.dataset.msgAnim = s.prefs.messageAnimation;
  root.dataset.wallpaperPreset = s.prefs.wallpaperPreset;
  root.dataset.wallpaperPattern = s.prefs.wallpaperPattern ? 'on' : 'off';
  // `html[data-reduce-motion='on'] *` (index.css) clamps animations like the OS media query.
  root.dataset.reduceMotion = s.prefs.reduceMotion;
}

let themeInitialized = false;

/** Apply theme/prefs now and keep them applied (store changes + OS theme changes). */
export function initTheme(): void {
  if (themeInitialized || typeof window === 'undefined') return;
  themeInitialized = true;
  applyAppearance(useUi.getState());
  useUi.subscribe((s, prev) => {
    if (s.resolvedTheme !== prev.resolvedTheme || s.prefs !== prev.prefs) applyAppearance(s);
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useUi.getState();
    if (theme === 'system') useUi.setState({ resolvedTheme: resolveTheme('system') });
  });
}
