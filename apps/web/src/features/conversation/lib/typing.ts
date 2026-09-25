/**
 * Outgoing typing/recording indicator for one chat (docs/ARCHITECTURE.md "Typing"):
 * `typing`/`recording` is (re)sent at most every TYPING_REFRESH_MS while active, `idle` on
 * send/blur/stop, and typing lapses to idle by itself after a pause in keystrokes.
 */
import { TYPING_REFRESH_MS, type ID, type TypingState } from '@enbox/shared';
import { sendEvent } from '@/lib/socket';

/** Typing stops being reported this long after the last keystroke. */
export const TYPING_IDLE_AFTER_MS = 4_000;

export interface TypingEmitter {
  /** Call on every edit of the composer text. */
  keystroke(): void;
  /** Start/stop the "recording audio…" state (refreshed on an interval while on). */
  recording(on: boolean): void;
  /** Send `idle` if something was reported (send, blur, unmount). */
  stop(): void;
  dispose(): void;
}

type Send = (payload: { chatId: ID; state: TypingState }) => boolean;

export function createTypingEmitter(
  chatId: ID,
  send: Send = (p) => sendEvent('chat:typing', p),
): TypingEmitter {
  let state: TypingState = 'idle';
  let lastSent = 0;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let refreshTimer: ReturnType<typeof setInterval> | null = null;

  const emit = (next: TypingState) => {
    state = next;
    lastSent = Date.now();
    send({ chatId, state: next });
  };
  const clearTimers = () => {
    if (idleTimer) clearTimeout(idleTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    idleTimer = null;
    refreshTimer = null;
  };

  return {
    keystroke() {
      if (state === 'recording') return;
      if (state !== 'typing' || Date.now() - lastSent >= TYPING_REFRESH_MS) emit('typing');
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (state === 'typing') emit('idle');
      }, TYPING_IDLE_AFTER_MS);
    },
    recording(on) {
      clearTimers();
      if (on) {
        emit('recording');
        refreshTimer = setInterval(() => emit('recording'), TYPING_REFRESH_MS);
      } else if (state !== 'idle') emit('idle');
    },
    stop() {
      clearTimers();
      if (state !== 'idle') emit('idle');
    },
    dispose() {
      this.stop();
    },
  };
}
