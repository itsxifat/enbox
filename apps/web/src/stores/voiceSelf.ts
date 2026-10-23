/**
 * My mute / deafen switches from the user panel (Discord), kept per device. Outside a call
 * they are what the next voice connection starts with; inside a call the panel drives the
 * call's own mic flag.
 *
 * `pttActive`: push to talk is sending right now (the shortcut is held, or its release delay
 * runs) — the voice engine sets it, the voice panel shows it. Not kept.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface VoiceSelfState {
  muted: boolean;
  deafened: boolean;
  pttActive: boolean;
  toggleMute(): void;
  toggleDeafen(): void;
}

export const useVoiceSelf = create<VoiceSelfState>()(
  persist(
    (set) => ({
      muted: false,
      deafened: false,
      pttActive: false,
      toggleMute() {
        // Unmuting while deafened undeafens too (Discord).
        set((s) => (s.deafened ? { muted: false, deafened: false } : { muted: !s.muted }));
      },
      toggleDeafen() {
        set((s) => ({ deafened: !s.deafened }));
      },
    }),
    { name: 'enbox.voice', partialize: (s) => ({ muted: s.muted, deafened: s.deafened }) },
  ),
);
