/**
 * Idle detection for presence. This device is *active* while the page is visible and the
 * user produced input (pointer, keyboard, wheel, touch) within PRESENCE_IDLE_AFTER_MS, and
 * *idle* otherwise — a page hidden for PRESENCE_HIDDEN_IDLE_MS too (a quick tab switch is
 * not absence). Transitions send `presence:activity { idle }`, coalesced: transitions
 * closer together than SEND_MIN_INTERVAL_MS become one trailing send of the latest state,
 * so a burst can neither reach the server's per-socket limit nor leave it with a stale
 * flag. `reportActivity()` re-sends the current state after every `ready` (the flag lives
 * per socket, see realtime/users.ts). The server shows me as idle only when every one of my
 * devices is idle.
 *
 * Started by `registerUserHandlers` (once per session) and stopped by the session reset.
 */
import { AppState } from 'react-native';
import { PRESENCE_HIDDEN_IDLE_MS, PRESENCE_IDLE_AFTER_MS } from '@enbox/shared';
import { registerSessionReset } from './session';
import { sendEvent } from './socket';

/** Input closer together than this doesn't re-arm the timer (mousemove fires constantly). */
const THROTTLE_MS = 1_000;
/** Transitions closer together than this are coalesced into one send of the latest state. */
export const SEND_MIN_INTERVAL_MS = 2_000;

let tracking = false;
let idle = false;
let timer = null;
let lastInput = 0;
/** The state last sent on this socket (null: nothing yet) and when; `sendTimer` = a trailing send is due. */
let sentIdle = null;
let lastSentAt = 0;
let sendTimer = null;

function pageHidden() {
  return AppState.currentState !== 'active';
}

let appStateSub = null;

/** Send the current state unless it is what the server already has. */
function flush() {
  sendTimer = null;
  if (sentIdle === idle) return;
  sentIdle = idle;
  lastSentAt = Date.now();
  sendEvent('presence:activity', { idle });
}

function setIdle(next) {
  if (idle === next) return;
  idle = next;
  if (sendTimer) return; // the trailing send picks up whatever the state is by then
  const wait = SEND_MIN_INTERVAL_MS - (Date.now() - lastSentAt);
  if (wait <= 0) flush();
  else sendTimer = setTimeout(flush, wait);
}

function armTimer(after = PRESENCE_IDLE_AFTER_MS) {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    setIdle(true);
  }, after);
}

/** Touches anywhere in the app (the root view reports them, see app/_layout.js). */
export function reportUserInput() {
  if (tracking) onInput();
}

function onInput() {
  if (pageHidden()) return;
  const now = Date.now();
  if (!idle && now - lastInput < THROTTLE_MS) return;
  lastInput = now;
  setIdle(false);
  armTimer();
}

function onVisibility() {
  if (pageHidden()) {
    // Hidden: idle after a grace period, so a quick switch away and back sends nothing.
    armTimer(PRESENCE_HIDDEN_IDLE_MS);
    return;
  }
  // Coming back counts as input: the user is looking at Enbox again.
  lastInput = 0;
  onInput();
}

/** This device's current idle state. */
export function isIdle() {
  return idle;
}

/** Send the current state now (every `ready`: a new socket starts without it). */
export function reportActivity() {
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = null;
  sentIdle = idle;
  lastSentAt = Date.now();
  sendEvent('presence:activity', { idle });
}

/** Start listening for input and visibility (idempotent). */
export function startActivityTracking() {
  if (tracking) return;
  tracking = true;
  appStateSub = AppState.addEventListener('change', onVisibility);
  idle = pageHidden();
  lastInput = 0;
  if (!idle) armTimer();
}

/** Stop listening and forget the state (logout). */
export function stopActivityTracking() {
  if (!tracking) return;
  tracking = false;
  appStateSub?.remove();
  appStateSub = null;
  if (timer) clearTimeout(timer);
  timer = null;
  if (sendTimer) clearTimeout(sendTimer);
  sendTimer = null;
  idle = false;
  lastInput = 0;
  sentIdle = null;
  lastSentAt = 0;
}

registerSessionReset(stopActivityTracking);
