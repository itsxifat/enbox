/**
 * Outgoing typing/recording indicator for one chat (docs/ARCHITECTURE.md "Typing"):
 * `typing`/`recording` is (re)sent at most every TYPING_REFRESH_MS while active, `idle` on
 * send/blur/stop, and typing lapses to idle by itself after a pause in keystrokes.
 */
import { TYPING_REFRESH_MS } from '@enbox/shared';
import { sendEvent } from '@/lib/socket';

/** Typing stops being reported this long after the last keystroke. */
export const TYPING_IDLE_AFTER_MS = 4_000;

export function createTypingEmitter(chatId, send = (p) => sendEvent('chat:typing', p)) {
  let state = 'idle';
  let lastSent = 0;
  let idleTimer = null;
  let refreshTimer = null;

  const emit = (next) => {
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
