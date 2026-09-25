/**
 * Realtime: calls (agent 4).
 *
 * - Ringing UI: `call:incoming` → `useCalls().incoming` (+ `call:ringing` ack unless silent,
 *   a system notification when the app is in the background); cleared on `call:ring-stop`,
 *   `call:ended` or when the call no longer rings me.
 * - Live calls per chat (`liveCalls`, group "Join" banners): `GET /api/calls/active` on every
 *   `ready`, `call:updated`/`call:ended`, and the chat's call message (`message:new` /
 *   `message:updated` with `type: 'call'`) for calls I'm not a participant of.
 * - Every call event is forwarded to the bus; the controller (features/calls/controller.ts)
 *   consumes them for the active call (WebRTC signaling, media flags, end).
 * - Several calls may ring me at once: all are tracked (`ringing`), `incoming` shows one and
 *   the next still-ringing call is shown once it is cleared. Each ring also stops locally
 *   after CALL_RING_TIMEOUT_MS (+ margin), in case the ring-stop was missed while offline.
 * - Reconnect: after `ready` the controller reconciles the active call (`call:rejoin`) or
 *   rejoins after a page reload. A failed `GET /api/calls/active` is retried with backoff.
 */
import {
  CALL_RING_TIMEOUT_MS,
  type Call,
  type ID,
  type IncomingCallPayload,
  type Message,
} from '@enbox/shared';
import { chatTitle, userDisplayName } from '@enbox/shared';
import { api, isSessionChangedError, type ApiResponse } from '@/lib/api';
import { bus } from '@/lib/bus';
import { showNotification } from '@/lib/notify';
import { registerSessionReset } from '@/lib/session';
import { sendEvent, useConnection, type AppSocket, type ReadyInfo } from '@/lib/socket';
import { getMe } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { useUi } from '@/stores/ui';

const calls = () => useCalls.getState();

function ringsMe(call: Call): boolean {
  const me = getMe()?.id;
  const mine = call.participants.find((p) => p.userId === me);
  return (
    (call.status === 'ringing' || call.status === 'ongoing') &&
    !!mine &&
    (mine.status === 'invited' || mine.status === 'ringing')
  );
}

function inActiveCall(): boolean {
  const a = calls().active;
  return !!a && a.phase !== 'ended';
}

async function closeCallNotification(callId: string): Promise<void> {
  try {
    const reg =
      'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : undefined;
    const list = (await reg?.getNotifications({ tag: `call:${callId}` })) ?? [];
    for (const n of list) n.close();
  } catch {
    /* unsupported */
  }
}

function notifyIncoming(p: IncomingCallPayload): void {
  const me = getMe();
  if (!me?.settings.callNotifications || !useUi.getState().prefs.desktopNotifications) return;
  const video = p.call.type === 'video';
  const caller = userDisplayName(p.caller);
  const title = p.chat.type === 'direct' ? caller : chatTitle(p.chat);
  const body =
    p.chat.type === 'direct'
      ? `Incoming ${video ? 'video' : 'voice'} call`
      : `${caller} is calling · group ${video ? 'video' : 'voice'} call`;
  void showNotification({ title, body, tag: `call:${p.call.id}`, url: '/calls' });
}

let logTimer: ReturnType<typeof setTimeout> | null = null;
function refreshLogSoon(): void {
  if (logTimer) clearTimeout(logTimer);
  logTimer = setTimeout(() => {
    logTimer = null;
    if (calls().log.loaded) void calls().loadLog({ refresh: true });
  }, 800);
}

let liveTimer: ReturnType<typeof setTimeout> | null = null;
/** Refetch live calls (debounced) — e.g. a group call started that I'm not rung into. */
function refreshLiveCallsSoon(): void {
  if (liveTimer) clearTimeout(liveTimer);
  liveTimer = setTimeout(() => {
    liveTimer = null;
    void api
      .get<ApiResponse<'GET /api/calls/active'>>('/api/calls/active')
      .then((list) => calls().setLiveCalls(list))
      .catch(() => undefined);
  }, 400);
}

// ---------------------------------------------------------------------------
// Calls ringing me (a second call is queued, not dropped)
// ---------------------------------------------------------------------------

/** A ring is dropped locally this long after it started (the server's timeout + margin). */
export const LOCAL_RING_TIMEOUT_MS = CALL_RING_TIMEOUT_MS + 5_000;

interface Ringing {
  payload: IncomingCallPayload;
  timer: ReturnType<typeof setTimeout>;
}

/** Every call ringing me, in arrival order; `incoming` shows one of them. */
const ringing = new Map<ID, Ringing>();

function forgetRinging(callId: ID): void {
  const r = ringing.get(callId);
  if (!r) return;
  clearTimeout(r.timer);
  ringing.delete(callId);
}

function trackRinging(payload: IncomingCallPayload): void {
  const id = payload.call.id;
  const cur = ringing.get(id);
  if (cur) {
    // A re-emit (after `ready`) or an update: keep the original deadline.
    cur.payload = payload;
    return;
  }
  const timer = setTimeout(() => {
    // The ring-stop never reached this device (offline): stop ringing anyway.
    ringing.delete(id);
    if (calls().incoming?.call.id === id) calls().setIncoming(null);
  }, LOCAL_RING_TIMEOUT_MS);
  ringing.set(id, { payload, timer });
}

function showIncoming(payload: IncomingCallPayload): void {
  calls().setIncoming(payload);
  if (!payload.silent) {
    sendEvent('call:ringing', { callId: payload.call.id });
    notifyIncoming(payload);
  }
}

/** `incoming` was cleared: show the next call that still rings me. */
function promoteNextRinging(): void {
  if (calls().incoming) return;
  for (const [id, r] of [...ringing]) {
    const alreadyIn = calls().active?.call.id === id && inActiveCall();
    if (alreadyIn || !ringsMe(r.payload.call)) {
      forgetRinging(id);
      continue;
    }
    showIncoming(r.payload);
    return;
  }
}

useCalls.subscribe((s, prev) => {
  const was = prev.incoming?.call.id;
  if (!was || was === s.incoming?.call.id) return;
  // Declined, accepted, stopped or timed out: that ring is over on this device.
  forgetRinging(was);
  if (!s.incoming) queueMicrotask(promoteNextRinging);
});

function onCallMessage(message: Message): void {
  const c = message.call;
  if (message.type !== 'call' || !c) return;
  if (c.status === 'ringing' || c.status === 'ongoing') refreshLiveCallsSoon();
  else {
    calls().removeLiveCall(message.chatId, c.callId);
    refreshLogSoon();
  }
}

export function registerCallHandlers(socket: AppSocket): void {
  socket.on('call:incoming', (payload) => {
    calls().setLiveCall(payload.call);
    const current = calls().incoming;
    const alreadyIn = calls().active?.call.id === payload.call.id && inActiveCall();
    if (!alreadyIn && ringsMe(payload.call)) {
      trackRinging(payload);
      // Another call is showing: this one waits in `ringing` until that one is cleared.
      if (!current || current.call.id === payload.call.id) showIncoming(payload);
    }
    bus.emit('call:incoming', payload);
  });

  // Stop ringing on this device, whatever the reason (answered/declined elsewhere, timeout,
  // cancelled, ended).
  socket.on('call:ring-stop', (payload) => {
    forgetRinging(payload.callId);
    if (calls().incoming?.call.id === payload.callId) calls().setIncoming(null);
    void closeCallNotification(payload.callId);
    refreshLogSoon();
    bus.emit('call:ring-stop', payload);
  });

  socket.on('call:ended', (payload) => {
    forgetRinging(payload.callId);
    if (calls().incoming?.call.id === payload.callId) calls().setIncoming(null);
    calls().removeLiveCall(payload.call.chatId, payload.callId);
    void closeCallNotification(payload.callId);
    refreshLogSoon();
    bus.emit('call:ended', payload);
  });

  socket.on('call:updated', (payload) => {
    const queued = ringing.get(payload.call.id);
    if (queued) {
      if (ringsMe(payload.call)) queued.payload = { ...queued.payload, call: payload.call };
      else forgetRinging(payload.call.id);
    }
    const incoming = calls().incoming;
    if (incoming?.call.id === payload.call.id) {
      if (ringsMe(payload.call)) calls().setIncoming({ ...incoming, call: payload.call });
      else calls().setIncoming(null);
    }
    calls().setLiveCall(payload.call);
    bus.emit('call:updated', payload);
  });

  socket.on('call:participant-joined', (p) => bus.emit('call:participant-joined', p));
  socket.on('call:participant-left', (p) => bus.emit('call:participant-left', p));
  socket.on('call:signal', (p) => bus.emit('call:signal', p));
  socket.on('call:media', (p) => bus.emit('call:media', p));

  // Call messages reach every chat member, participants or not (join banners, call log).
  socket.on('message:new', ({ message }) => onCallMessage(message));
  socket.on('message:updated', ({ message }) => onCallMessage(message));
}

// ---------------------------------------------------------------------------
// Resync after `ready`
// ---------------------------------------------------------------------------

let resyncTimer: ReturnType<typeof setTimeout> | null = null;
let resyncFailures = 0;

function clearResyncRetry(): void {
  if (resyncTimer) clearTimeout(resyncTimer);
  resyncTimer = null;
}

function hasRememberedCall(): boolean {
  try {
    return !!sessionStorage.getItem('enbox.calls.current');
  } catch {
    return false;
  }
}

/** Retry a failed resync (1 s, 2 s, 4 s… ≤ 15 s) while it matters and the socket is ready. */
function scheduleResyncRetry(info: ReadyInfo): void {
  clearResyncRetry();
  const delay = Math.min(15_000, 1_000 * 2 ** resyncFailures++);
  resyncTimer = setTimeout(() => {
    resyncTimer = null;
    if (!useConnection.getState().ready) return; // the next `ready` resyncs anyway
    if (!inActiveCall() && !hasRememberedCall() && !calls().incoming && !ringing.size) return;
    void resyncCalls(info).catch(() => undefined);
  }, delay);
}

export async function resyncCalls(info: ReadyInfo): Promise<void> {
  clearResyncRetry();
  let list: Call[];
  try {
    list = await api.get<ApiResponse<'GET /api/calls/active'>>('/api/calls/active');
  } catch (e) {
    if (isSessionChangedError(e)) throw e; // logged out meanwhile
    // Don't sit in "Reconnecting…" until the next socket drop: retry, and rejoin the active
    // call meanwhile (its ack decides).
    scheduleResyncRetry(info);
    if (inActiveCall()) {
      const c = await import('@/features/calls/controller');
      c.reconcileWithoutList();
    }
    throw e;
  }
  resyncFailures = 0;
  calls().setLiveCalls(list);
  for (const id of [...ringing.keys()]) {
    const live = list.find((c) => c.id === id);
    if (!live || !ringsMe(live)) forgetRinging(id);
  }
  const incoming = calls().incoming;
  if (incoming && !list.some((c) => c.id === incoming.call.id && ringsMe(c))) {
    calls().setIncoming(null);
  }
  if (inActiveCall() || hasRememberedCall()) {
    const c = await import('@/features/calls/controller');
    await c.reconcile(list, info);
  }
  // First page of the log (Calls tab badge); refresh after reconnects.
  void calls()
    .loadLog({ refresh: info.reconnect })
    .catch(() => undefined);
}

registerSessionReset(() => {
  clearResyncRetry();
  resyncFailures = 0;
  for (const id of [...ringing.keys()]) forgetRinging(id);
});
