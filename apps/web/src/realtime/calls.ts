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
 * - Reconnect: after `ready` the controller reconciles the active call (`call:rejoin`) or
 *   rejoins after a page reload.
 */
import type { Call, IncomingCallPayload, Message } from '@enbox/shared';
import { chatTitle, userDisplayName } from '@enbox/shared';
import { api, type ApiResponse } from '@/lib/api';
import { bus } from '@/lib/bus';
import { showNotification } from '@/lib/notify';
import { sendEvent, type AppSocket, type ReadyInfo } from '@/lib/socket';
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
    if (!alreadyIn && ringsMe(payload.call) && (!current || current.call.id === payload.call.id)) {
      calls().setIncoming(payload);
      if (!payload.silent) {
        sendEvent('call:ringing', { callId: payload.call.id });
        notifyIncoming(payload);
      }
    }
    bus.emit('call:incoming', payload);
  });

  // Stop ringing on this device, whatever the reason (answered/declined elsewhere, timeout,
  // cancelled, ended).
  socket.on('call:ring-stop', (payload) => {
    if (calls().incoming?.call.id === payload.callId) calls().setIncoming(null);
    void closeCallNotification(payload.callId);
    refreshLogSoon();
    bus.emit('call:ring-stop', payload);
  });

  socket.on('call:ended', (payload) => {
    if (calls().incoming?.call.id === payload.callId) calls().setIncoming(null);
    calls().removeLiveCall(payload.call.chatId, payload.callId);
    void closeCallNotification(payload.callId);
    refreshLogSoon();
    bus.emit('call:ended', payload);
  });

  socket.on('call:updated', (payload) => {
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

export async function resyncCalls(info: ReadyInfo): Promise<void> {
  const list = await api.get<ApiResponse<'GET /api/calls/active'>>('/api/calls/active');
  calls().setLiveCalls(list);
  const incoming = calls().incoming;
  if (incoming && !list.some((c) => c.id === incoming.call.id && ringsMe(c))) {
    calls().setIncoming(null);
  }
  let remembered: string | null = null;
  try {
    remembered = sessionStorage.getItem('enbox.calls.current');
  } catch {
    /* storage disabled */
  }
  if (inActiveCall() || remembered) {
    const c = await import('@/features/calls/controller');
    await c.reconcile(list, info);
  }
  // First page of the log (Calls tab badge); refresh after reconnects.
  void calls()
    .loadLog({ refresh: info.reconnect })
    .catch(() => undefined);
}
