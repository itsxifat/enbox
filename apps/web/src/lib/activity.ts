/**
 * Idle detection for presence. This device is *active* while the page is visible and the
 * user produced input (pointer, keyboard, wheel, touch) within PRESENCE_IDLE_AFTER_MS, and
 * *idle* otherwise — a hidden page is idle right away. Transitions send
 * `presence:activity { idle }`; `reportActivity()` re-sends the current state after every
 * `ready` (the flag lives per socket, see realtime/users.ts). The server shows me as idle
 * only when every one of my devices is idle.
 *
 * Started by `registerUserHandlers` (once per session) and stopped by the session reset.
 */
import { PRESENCE_IDLE_AFTER_MS } from '@enbox/shared';
import { registerSessionReset } from './session';
import { sendEvent } from './socket';

const INPUT_EVENTS = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart'] as const;
/** Input closer together than this doesn't re-arm the timer (mousemove fires constantly). */
const THROTTLE_MS = 1_000;

let tracking = false;
let idle = false;
let timer: ReturnType<typeof setTimeout> | null = null;
let lastInput = 0;

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.visibilityState === 'hidden';
}

function setIdle(next: boolean): void {
  if (idle === next) return;
  idle = next;
  sendEvent('presence:activity', { idle });
}

function armTimer(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    setIdle(true);
  }, PRESENCE_IDLE_AFTER_MS);
}

function onInput(): void {
  if (pageHidden()) return;
  const now = Date.now();
  if (!idle && now - lastInput < THROTTLE_MS) return;
  lastInput = now;
  setIdle(false);
  armTimer();
}

function onVisibility(): void {
  if (pageHidden()) {
    if (timer) clearTimeout(timer);
    timer = null;
    setIdle(true);
    return;
  }
  // Coming back counts as input: the user is looking at Enbox again.
  lastInput = 0;
  onInput();
}

/** This device's current idle state. */
export function isIdle(): boolean {
  return idle;
}

/** Re-send the current state (every `ready`: a new socket starts without it). */
export function reportActivity(): void {
  sendEvent('presence:activity', { idle });
}

/** Start listening for input and visibility (idempotent). */
export function startActivityTracking(): void {
  if (tracking || typeof window === 'undefined') return;
  tracking = true;
  for (const ev of INPUT_EVENTS)
    window.addEventListener(ev, onInput, { passive: true, capture: true });
  document.addEventListener('visibilitychange', onVisibility);
  idle = pageHidden();
  lastInput = 0;
  if (!idle) armTimer();
}

/** Stop listening and forget the state (logout). */
export function stopActivityTracking(): void {
  if (!tracking) return;
  tracking = false;
  for (const ev of INPUT_EVENTS) window.removeEventListener(ev, onInput, { capture: true });
  document.removeEventListener('visibilitychange', onVisibility);
  if (timer) clearTimeout(timer);
  timer = null;
  idle = false;
  lastInput = 0;
}

registerSessionReset(stopActivityTracking);
