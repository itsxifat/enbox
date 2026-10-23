/**
 * Streamer Mode (Settings ▸ App Settings ▸ Streamer Mode, Discord's), per device: while it is
 * on, the protections chosen on that page apply —
 * - `personal`       Hide Personal Information: my phone number, username and other private
 *                    fields in My Account, and my notes on profiles
 * - `invites`        Hide Invite Links: INVITE_HIDDEN_TEXT instead of invite links and codes
 *                    (copy and share keep working)
 * - `sounds`         Disable Sounds: notification and UI sounds (lib/notify.ts)
 * - `notifications`  Disable Notifications: desktop notifications (lib/notify.ts)
 * The app shows a banner with Disable while it is on (features/chrome). With
 * `autoOnScreenShare` it turns on while I share my screen and off again when I stop
 * (`auto`; an automatic switch-on does not survive a reload).
 *
 * Kept in localStorage `enbox.streamer`; every storage access is guarded (private mode,
 * disabled storage, quota), so it falls back to the defaults in memory.
 *
 *   const hidden = useStreamerHides('invites');   // components
 *   if (streamerHides('sounds')) return;           // anywhere
 */
import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

export type StreamerProtection = 'personal' | 'invites' | 'sounds' | 'notifications';

export interface StreamerSettings {
  enabled: boolean;
  hidePersonal: boolean;
  hideInvites: boolean;
  disableSounds: boolean;
  disableNotifications: boolean;
  /** Turn Streamer Mode on while I share my screen (voice channel or call). */
  autoOnScreenShare: boolean;
}

export type StreamerOption = Exclude<keyof StreamerSettings, 'enabled'>;

export interface StreamerState extends StreamerSettings {
  /** On because a screen share started (`autoOnScreenShare`): it goes off when the share ends. */
  auto: boolean;
  /** Turn it on or off; `auto` marks an automatic switch-on (a manual change clears it). */
  setEnabled(on: boolean, opts?: { auto?: boolean }): void;
  setOption(key: StreamerOption, value: boolean): void;
}

/** Discord's defaults: every protection on, the mode itself off. */
export const DEFAULT_STREAMER: StreamerSettings = {
  enabled: false,
  hidePersonal: true,
  hideInvites: true,
  disableSounds: true,
  disableNotifications: true,
  autoOnScreenShare: false,
};

/** Shown instead of an invite link or code. */
export const INVITE_HIDDEN_TEXT = 'Invite link hidden while Streamer Mode is on';
/** Shown instead of a personal field (username, phone number). */
export const PERSONAL_HIDDEN_TEXT = 'Hidden while Streamer Mode is on';

const OPTION_OF: Record<StreamerProtection, StreamerOption> = {
  personal: 'hidePersonal',
  invites: 'hideInvites',
  sounds: 'disableSounds',
  notifications: 'disableNotifications',
};

const KEYS = Object.keys(DEFAULT_STREAMER) as (keyof StreamerSettings)[];

/** localStorage with every access in try/catch (zustand's JSON wrapper parses on top). */
const safeLocalStorage: StateStorage = {
  getItem(name) {
    try {
      return localStorage.getItem(name);
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try {
      localStorage.setItem(name, value);
    } catch {
      /* quota / disabled */
    }
  },
  removeItem(name) {
    try {
      localStorage.removeItem(name);
    } catch {
      /* disabled */
    }
  },
};

export const useStreamer = create<StreamerState>()(
  persist(
    (set) => ({
      ...DEFAULT_STREAMER,
      auto: false,
      setEnabled(on, opts = {}) {
        set({ enabled: on, auto: on && !!opts.auto });
      },
      setOption(key, value) {
        set({ [key]: value } as Pick<StreamerSettings, StreamerOption>);
      },
    }),
    {
      name: 'enbox.streamer',
      version: 1,
      storage: createJSONStorage(() => safeLocalStorage),
      // A switch-on made by a screen share ends with the page (the share does too).
      partialize: (s): StreamerSettings => ({
        enabled: s.enabled && !s.auto,
        hidePersonal: s.hidePersonal,
        hideInvites: s.hideInvites,
        disableSounds: s.disableSounds,
        disableNotifications: s.disableNotifications,
        autoOnScreenShare: s.autoOnScreenShare,
      }),
      // Only known boolean settings come back; anything else keeps its default.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<Record<keyof StreamerSettings, unknown>>;
        const out = { ...current };
        for (const k of KEYS) {
          const v = p[k];
          if (typeof v === 'boolean') out[k] = v;
        }
        return out;
      },
    },
  ),
);

/** Whether a protection is in effect under these settings (the mode on and the option on). */
export function hidesUnder(s: StreamerSettings, what: StreamerProtection): boolean {
  return s.enabled && s[OPTION_OF[what]];
}

/** Imperative check (sounds, notifications, menus built on open). */
export function streamerHides(what: StreamerProtection): boolean {
  return hidesUnder(useStreamer.getState(), what);
}

/** Reactive check for components. */
export function useStreamerHides(what: StreamerProtection): boolean {
  return useStreamer((s) => hidesUnder(s, what));
}
