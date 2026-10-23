/**
 * UI store — per-device preferences (persisted in localStorage `enbox.ui`), theme, toasts
 * and the confirm-dialog queue. Nothing here is account data, so it survives logout.
 *
 * State
 * - `theme`: 'light' | 'ash' | 'dark' | 'onyx' | 'system'; `resolvedTheme`: 'light' | 'dark'
 * - `prefs`: { enterToSend, linkPreviews, ttsPlayback, voiceIsolation, noiseCancellation,
 *   echoCancellation, autoGainControl, the voice channel keys (audioInputDevice, audioOutputDevice,
 *   videoInputDevice, outputVolume, voiceInputMode, pttShortcut, pttReleaseDelayMs,
 *   inputSensitivityAuto, inputSensitivityDb, userAudio), fontSize, wallpaperPattern, sounds,
 *   desktopNotifications, reduceMotion, autoplayAnimatedMedia, showNameStyles, chatTheme, bubbleStyle,
 *   messageAnimation, wallpaperPreset, wallpaperDim, wallpaperBlur, developerMode }
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
 * variables, see features/appearance/presets.ts) and the `data-reduce-motion` /
 * `data-autoplay-media` attributes (the CSS-only cosmetics animations read them).
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

/** Discord's themes: Light, Ash (classic grey), Dark (default), Onyx (near-black), or follow the OS. */
export type ThemePref = 'light' | 'ash' | 'dark' | 'onyx' | 'system';
export type ResolvedTheme = 'light' | 'dark';
/** The palette in use (`data-theme` on <html>); Ash / Onyx are dark variants. */
export type ThemeVariant = Exclude<ThemePref, 'system'>;
export type FontSize = 'small' | 'medium' | 'large';
/** 'system' follows `prefers-reduced-motion`; 'on' forces it; 'off' ignores the OS setting. */
export type ReduceMotionPref = 'system' | 'on' | 'off';
/** Animated images (GIF / WebP / APNG avatars, chat GIFs): play always, on hover/tap, or never. */
export type AutoplayAnimatedMedia = 'always' | 'hover' | 'never';
/** Voice channels: the mic sends whenever I speak, or only while a shortcut is held. */
export type VoiceInputMode = 'voiceActivity' | 'pushToTalk';

/** A recorded key combination (push to talk). `code` is `KeyboardEvent.code`. */
export interface KeyCombo {
  code: string;
  /** What to show for the key (`KeyboardEvent.key` when it was recorded: "V", "`", "F8"). */
  key: string;
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

/** Someone's voice on this device: volume 0-2 (200%; 1 when absent) and a mute only I hear. */
export interface UserAudioPref {
  volume?: number;
  muted?: boolean;
}

export interface DevicePrefs {
  /** Enter sends (Shift+Enter = newline). Mobile keyboards always insert newlines. */
  enterToSend: boolean;
  /** Preview cards (title, description, image) under messages with a link. */
  linkPreviews: boolean;
  /** Read aloud /tts messages that arrive in the chat I'm viewing (features/tts). */
  ttsPlayback: boolean;
  /**
   * Calls (features/calls/voice.ts) and voice channels (features/voice): an AI filter on the
   * microphone that keeps speech and removes background sounds.
   */
  voiceIsolation: boolean;
  /** Calls and voice channels: the browser's noise suppression, echo cancellation and gain. */
  noiseCancellation: boolean;
  echoCancellation: boolean;
  autoGainControl: boolean;
  /** Voice channels: microphone, speaker and camera (`deviceId`; '' = the system default). */
  audioInputDevice: string;
  audioOutputDevice: string;
  videoInputDevice: string;
  /** Voice channels: how loud everyone plays, 0-2 (200%). */
  outputVolume: number;
  voiceInputMode: VoiceInputMode;
  /** Push to talk: the shortcut (null = none yet) and how long the mic stays on after it (ms). */
  pttShortcut: KeyCombo | null;
  pttReleaseDelayMs: number;
  /** Voice activity: open the mic whenever I speak, or above `inputSensitivityDb` (-100..0 dB). */
  inputSensitivityAuto: boolean;
  inputSensitivityDb: number;
  /** Per person (user id), on this device. */
  userAudio: Record<string, UserAudioPref>;
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
  /** Display name fonts and effects (components/cosmetics/StyledName); off = plain names. */
  showNameStyles: boolean;
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
  /** Developer Mode: "Copy … ID" items in the message, user, channel and Space menus. */
  developerMode: boolean;
  // Accessibility (features/settings/accessibility; applied on <html> by applyAppearance).
  /** UI colour saturation, 0..1 (1 = full colour; pictures and video are never changed). */
  saturation: number;
  /** Saturation also applies to role and name colours. */
  saturateRoleColors: boolean;
  /** Higher contrast: 'system' follows `prefers-contrast: more` (and forced colours). */
  contrast: ContrastPref;
  /** Always underline links in messages. */
  underlineLinks: boolean;
  /** Role colours: in names, as a dot next to names, or not at all. */
  roleColors: RoleColorDisplay;
  /** Stickers: animate always, on hover/focus, or never. */
  stickerAnimation: StickerAnimation;
  /** Animated custom emoji play (off: their still frame). */
  animateEmoji: boolean;
  /** Super reactions play their burst animation. */
  superReactionAnimations: boolean;
  /** A send button beside the message box (also on desktop). */
  showSendButton: boolean;
  /** Space between message groups in px (Discord: 0, 4, 8, 16, 24). */
  messageGroupSpacing: MessageGroupSpacing;
}

export type ContrastPref = 'system' | 'on' | 'off';
export type RoleColorDisplay = 'names' | 'dot' | 'hidden';
export type StickerAnimation = 'always' | 'interaction' | 'never';
export const MESSAGE_GROUP_SPACINGS = [0, 4, 8, 16, 24] as const;
export type MessageGroupSpacing = (typeof MESSAGE_GROUP_SPACINGS)[number];

export const DEFAULT_PREFS: DevicePrefs = {
  enterToSend: true,
  linkPreviews: true,
  ttsPlayback: true,
  voiceIsolation: false,
  noiseCancellation: true,
  echoCancellation: true,
  autoGainControl: true,
  audioInputDevice: '',
  audioOutputDevice: '',
  videoInputDevice: '',
  outputVolume: 1,
  voiceInputMode: 'voiceActivity',
  pttShortcut: null,
  pttReleaseDelayMs: 20,
  inputSensitivityAuto: true,
  inputSensitivityDb: -60,
  userAudio: {},
  fontSize: 'medium',
  wallpaperPattern: true,
  sounds: true,
  desktopNotifications: true,
  reduceMotion: 'system',
  autoplayAnimatedMedia: 'hover',
  showNameStyles: true,
  chatTheme: 'default',
  bubbleStyle: 'cozy',
  messageAnimation: 'fade',
  wallpaperPreset: 'default',
  wallpaperDim: 0,
  wallpaperBlur: 0,
  developerMode: false,
  saturation: 1,
  saturateRoleColors: false,
  contrast: 'system',
  underlineLinks: false,
  roleColors: 'names',
  stickerAnimation: 'always',
  animateEmoji: true,
  superReactionAnimations: true,
  showSendButton: false,
  messageGroupSpacing: 16,
};

export const FONT_SIZES: Record<FontSize, { label: string; px: number }> = {
  small: { label: 'Small', px: 14 },
  medium: { label: 'Medium', px: 15 },
  large: { label: 'Large', px: 17 },
};

/** Browser chrome color per palette (keep in sync with --surface and index.html). */
export const THEME_COLORS: Record<ThemeVariant, string> = {
  light: '#ffffff',
  ash: '#313338',
  dark: '#1a1a1e',
  onyx: '#0b0b0d',
};

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

export function themeVariant(theme: ThemePref): ThemeVariant {
  if (theme === 'system') return systemPrefersDark() ? 'dark' : 'light';
  return theme;
}

function resolveTheme(theme: ThemePref): ResolvedTheme {
  return themeVariant(theme) === 'light' ? 'light' : 'dark';
}

export const useUi = create<UiState>()(
  persist(
    (set, get) => ({
      theme: 'dark',
      resolvedTheme: resolveTheme('dark'),
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

function applyAppearance(s: Pick<UiState, 'theme' | 'resolvedTheme' | 'prefs'>): void {
  const root = document.documentElement;
  const dark = s.resolvedTheme === 'dark';
  const variant = themeVariant(s.theme);
  root.classList.toggle('dark', dark);
  root.dataset.theme = variant;
  root.style.colorScheme = dark ? 'dark' : 'light';
  document.getElementById('theme-color')?.setAttribute('content', THEME_COLORS[variant]);
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
  // Cosmetics (components/cosmetics/cosmetics.css): decorations play always / on hover / never.
  root.dataset.autoplayMedia = s.prefs.autoplayAnimatedMedia;
}

let themeInitialized = false;

/** Apply theme/prefs now and keep them applied (store changes + OS theme changes). */
export function initTheme(): void {
  if (themeInitialized || typeof window === 'undefined') return;
  themeInitialized = true;
  applyAppearance(useUi.getState());
  useUi.subscribe((s, prev) => {
    if (s.theme !== prev.theme || s.resolvedTheme !== prev.resolvedTheme || s.prefs !== prev.prefs) applyAppearance(s);
  });
  window.matchMedia?.('(prefers-color-scheme: dark)').addEventListener('change', () => {
    const { theme } = useUi.getState();
    if (theme === 'system') useUi.setState({ resolvedTheme: resolveTheme('system') });
  });
}
