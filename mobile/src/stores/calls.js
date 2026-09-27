/**
 * Calls store (agent 4) — serializable call state only. MediaStreams / RTCPeerConnections
 * live in the WebRTC engine (features/calls/engine) driven by features/calls/controller.ts;
 * the actions below delegate to that controller (lazy-loaded, so WebRTC code is split out).
 *
 * State
 * - `incoming`   the call ringing this device (`call:incoming`), cleared on ring-stop/ended
 * - `active`     the call I'm in (or starting): server `call`, my media flags, `phase`
 *                (starting → calling/ringing → connecting → connected, reconnecting, ended),
 *                per-peer connection states, speaking/active speaker, minimized…
 *                Remote media flags are `active.call.participants[].audioMuted/videoOff/screenSharing`.
 * - `liveCalls`  live (ringing/ongoing) calls per chatId (`GET /api/calls/active` + events) —
 *                drives the "Join" banner of group chats (`useActiveCallForChat`)
 * - `log`        the Calls tab log (`GET /api/calls`, newest first, paged by `before`)
 * - `picker`     participant picker dialog request (group calls > 8 members, add participant)
 *
 * Entry points for other features: `useCalls.getState().startCall(chatId, 'audio' | 'video')`
 * and `features/calls` exports (`OngoingCallBanner`, `useActiveCallForChat`, `useMissedCallsCount`).
 */
import { create } from 'zustand';

import { api } from '@/lib/api';
import { registerSessionReset, sessionEpoch } from '@/lib/session';
import { sendEvent } from '@/lib/socket';
import { useChats } from './chats';
import { toast } from './ui';

/** Per remote participant: RTCPeerConnectionState, or `waiting` before any connection exists. */

export const CALL_LOG_PAGE = 50;

const EMPTY_LOG = {
  entries: [],
  loaded: false,
  loading: false,
  loadingMore: false,
  hasMore: true,
  error: null,
};

const controller = () => import('@/features/calls/controller');

function run(fn) {
  void controller()
    .then((c) => fn(c))
    .catch((e) => toast.error(e));
}

export function isLiveCall(call) {
  return call.status === 'ringing' || call.status === 'ongoing';
}

/** Merge a page into the log (dedupe by call id, newest first). */
export function mergeLog(existing, page) {
  const byId = new Map(existing.map((e) => [e.call.id, e]));
  for (const e of page) byId.set(e.call.id, e);
  return [...byId.values()].sort((a, b) =>
    a.call.createdAt < b.call.createdAt ? 1 : a.call.createdAt > b.call.createdAt ? -1 : 0,
  );
}

let logRequest = 0;

export const useCalls = create((set, get) => ({
  incoming: null,
  active: null,
  liveCalls: {},
  log: EMPTY_LOG,
  picker: null,

  setIncoming(incoming) {
    set({ incoming });
  },
  setActive(active) {
    set({ active });
  },
  patchActive(partial) {
    const active = get().active;
    if (active) set({ active: { ...active, ...partial } });
  },

  async startCall(chatId, type, userIds) {
    const c = await controller();
    await c.startCall(chatId, type, userIds);
  },
  async acceptIncoming() {
    const c = await controller();
    await c.acceptIncoming();
  },
  declineIncoming() {
    const incoming = get().incoming;
    if (incoming) sendEvent('call:decline', { callId: incoming.call.id });
    set({ incoming: null });
  },
  async joinCall(callId) {
    const c = await controller();
    await c.joinCall(callId);
  },
  leaveCall() {
    run((c) => c.leaveCall());
  },
  async inviteToCall(userIds) {
    const c = await controller();
    await c.inviteToCall(userIds);
  },
  toggleMute() {
    run((c) => c.toggleMute());
  },
  toggleVideo() {
    run((c) => c.toggleVideo());
  },
  flipCamera() {
    run((c) => c.flipCamera());
  },
  toggleScreenShare() {
    run((c) => c.toggleScreenShare());
  },
  setMinimized(minimized) {
    get().patchActive({ minimized });
  },
  setOutputDevice(deviceId) {
    run((c) => c.setOutputDevice(deviceId));
  },
  resumeAudio() {
    run((c) => c.resumeAudio());
  },
  openPicker(picker) {
    set({ picker });
  },
  closePicker() {
    set({ picker: null });
  },

  setLiveCall(call) {
    // A chat I left / was removed from: no "Join" (the server would answer 403 not_member).
    const chat = useChats.getState().byId[call.chatId];
    if (!isLiveCall(call) || (chat && chat.membership !== 'active')) {
      get().removeLiveCall(call.chatId, call.id);
      return;
    }
    set((s) => ({ liveCalls: { ...s.liveCalls, [call.chatId]: call } }));
  },
  removeLiveCall(chatId, callId) {
    const cur = get().liveCalls[chatId];
    if (!cur || (callId && cur.id !== callId)) return;
    set((s) => {
      const next = { ...s.liveCalls };
      delete next[chatId];
      return { liveCalls: next };
    });
  },
  setLiveCalls(calls) {
    const liveCalls = {};
    for (const c of calls) if (isLiveCall(c)) liveCalls[c.chatId] = c;
    set({ liveCalls });
  },

  async loadLog(opts = {}) {
    const log = get().log;
    if (log.loading || (log.loaded && !opts.refresh)) return;
    const req = ++logRequest;
    set({ log: { ...log, loading: true, error: null } });
    try {
      const page = await api.get('/api/calls', {
        query: { limit: CALL_LOG_PAGE },
      });
      if (req !== logRequest) return;
      const cur = get().log;
      // A refresh keeps older pages already loaded (merge), a first load replaces.
      const entries = cur.loaded ? mergeLog(cur.entries, page) : page;
      set({
        log: {
          ...cur,
          entries,
          loaded: true,
          loading: false,
          hasMore: cur.loaded ? cur.hasMore : page.length >= CALL_LOG_PAGE,
          error: null,
        },
      });
    } catch (e) {
      if (req !== logRequest) return;
      set({
        log: { ...get().log, loading: false, error: e instanceof Error ? e.message : 'Error' },
      });
    }
  },

  async loadMoreLog() {
    const log = get().log;
    if (!log.loaded || log.loadingMore || !log.hasMore || !log.entries.length) return;
    const before = log.entries[log.entries.length - 1].call.createdAt;
    set({ log: { ...log, loadingMore: true } });
    const epoch = sessionEpoch();
    try {
      const page = await api.get('/api/calls', {
        query: { limit: CALL_LOG_PAGE, before },
      });
      if (epoch !== sessionEpoch()) return; // logged out meanwhile
      const cur = get().log;
      set({
        log: {
          ...cur,
          entries: mergeLog(cur.entries, page),
          loadingMore: false,
          hasMore: page.length >= CALL_LOG_PAGE,
        },
      });
    } catch (e) {
      if (epoch !== sessionEpoch()) return;
      set({ log: { ...get().log, loadingMore: false } });
      toast.error(e);
    }
  },

  async removeLogEntry(callId) {
    const prev = get().log;
    set({ log: { ...prev, entries: prev.entries.filter((e) => e.call.id !== callId) } });
    try {
      await api.delete(`/api/calls/${callId}`);
    } catch (e) {
      set({ log: { ...get().log, entries: mergeLog(get().log.entries, prev.entries) } });
      throw e;
    }
  },

  async clearLog() {
    const prev = get().log;
    const keep = prev.entries.filter((e) => isLiveCall(e.call));
    set({ log: { ...prev, entries: keep, hasMore: false } });
    try {
      await api.delete('/api/calls');
    } catch (e) {
      set({ log: prev });
      throw e;
    }
  },
}));

// The controller registers its own reset (engine teardown) when it is loaded.
registerSessionReset(() => {
  logRequest++;
  useCalls.setState({ incoming: null, active: null, liveCalls: {}, log: EMPTY_LOG, picker: null });
});
