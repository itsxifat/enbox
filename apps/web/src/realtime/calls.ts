/**
 * Realtime: calls — OWNED BY FEATURE AGENT 4 (calls UI / WebRTC).
 *
 * Foundation behaviour: maintains `useCalls().incoming` (ring UI) and forwards every call
 * event to the bus (`bus.on('call:signal', …)`) so the WebRTC engine can live in
 * features/calls without touching the socket. Agent 4 may rewrite this file freely.
 *
 * TODO(agent 4): ringtone/ringback, active-call updates, resync of `GET /api/calls/active`
 * on reconnect (`call:rejoin` for a call I'm still joined to — see CALL_RECONNECT_GRACE_MS).
 * Devices that connect late get `call:incoming` re-emitted by the server after `ready`.
 */
import { bus } from '@/lib/bus';
import { sendEvent, type AppSocket, type ReadyInfo } from '@/lib/socket';
import { useCalls } from '@/stores/calls';

export function registerCallHandlers(socket: AppSocket): void {
  const calls = () => useCalls.getState();

  socket.on('call:incoming', (payload) => {
    if (!payload.silent && !calls().active) {
      calls().setIncoming(payload);
      sendEvent('call:ringing', { callId: payload.call.id });
    }
    bus.emit('call:incoming', payload);
  });

  // Stop ringing on this device, whatever the reason (answered/declined elsewhere, timeout,
  // cancelled, ended). Rule: ring iff my participant status ∈ {invited, ringing} and the
  // call is ringing/ongoing — `call:updated`/`call:ended` keep that true as well.
  socket.on('call:ring-stop', (payload) => {
    if (calls().incoming?.call.id === payload.callId) calls().setIncoming(null);
    bus.emit('call:ring-stop', payload);
  });

  socket.on('call:ended', (payload) => {
    if (calls().incoming?.call.id === payload.callId) calls().setIncoming(null);
    if (calls().active?.call.id === payload.callId) calls().setActive(null);
    bus.emit('call:ended', payload);
  });

  socket.on('call:updated', (payload) => {
    const { incoming, active } = calls();
    if (incoming?.call.id === payload.call.id)
      calls().setIncoming({ ...incoming, call: payload.call });
    if (active?.call.id === payload.call.id) calls().patchActive({ call: payload.call });
    bus.emit('call:updated', payload);
  });

  socket.on('call:participant-joined', (p) => bus.emit('call:participant-joined', p));
  socket.on('call:participant-left', (p) => bus.emit('call:participant-left', p));
  socket.on('call:signal', (p) => bus.emit('call:signal', p));
  socket.on('call:media', (p) => bus.emit('call:media', p));
}

export async function resyncCalls(_info: ReadyInfo): Promise<void> {
  // TODO(agent 4): GET /api/calls/active and reconcile `active` / joinable group calls.
}
