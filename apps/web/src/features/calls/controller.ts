/**
 * Call controller: the glue between the `useCalls` store (serializable state), the WebRTC
 * engine (media + peer connections) and the socket (call:* events, forwarded on the bus by
 * realtime/calls.ts). Loaded lazily by the store's actions.
 *
 * Flows (docs/ARCHITECTURE.md "Calls", events.ts "Call negotiation"):
 * - start: media → `call:start` (ack) → calling/ringing; `conflict` → accept/join the chat's
 *   live call (1:1 cross-calls), or "already in another call".
 * - accept / join / rejoin: media → ack → offer to every OTHER `joined` participant.
 * - peers: `call:participant-joined` → drop any old connection and wait for their offer;
 *   `call:participant-left` → close; `call:signal` → engine; `call:media` → flags.
 * - socket drop → reconnecting; next `ready` → `GET /api/calls/active` → `call:rejoin`.
 * - page reload while in a call → auto-rejoin (this tab only, via sessionStorage).
 */
import {
  MAX_CALL_PARTICIPANTS,
  type Call,
  type CallParticipant,
  type CallType,
  type ID,
} from '@enbox/shared';
import { api, isApiError, type ApiResponse } from '@/lib/api';
import { bus } from '@/lib/bus';
import { playSound } from '@/lib/notify';
import { registerSessionReset } from '@/lib/session';
import { emitWithAck, sendEvent, useConnection, type ReadyInfo } from '@/lib/socket';
import { getMyId } from '@/stores/auth';
import { type ActiveCall, useCalls } from '@/stores/calls';
import { getChat } from '@/stores/chats';
import { toast } from '@/stores/ui';
import { CallEngine } from './engine/CallEngine';
import { getIceServers } from './engine/iceServers';
import {
  MediaAccessError,
  callsSupported,
  getCameraTrack,
  getMicrophoneStream,
  getScreenTrack,
  listDevices,
} from './engine/media';
import {
  derivePhase,
  endReasonText,
  isPendingStatus,
  isTerminal,
  joinedOthers,
  participantOf,
} from './logic';

// ---------------------------------------------------------------------------
// Session state (module scope: one call at a time)
// ---------------------------------------------------------------------------

let engine: CallEngine | null = null;
/** Incremented for every new call attempt; async steps of an older attempt abort. */
let attempt = 0;
/** Waiting for the start/accept/join ack. */
let starting = false;
/** Socket down or rejoin in flight. */
let reconnecting = false;
/** Hang up pressed before the start ack arrived. */
let cancelRequested = false;
let offs: (() => void)[] = [];
let endTimer: ReturnType<typeof setTimeout> | null = null;
let logRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const CURRENT_CALL_KEY = 'enbox.calls.current';

const store = () => useCalls.getState();
const active = () => store().active;

function selfId(): ID {
  const id = getMyId();
  if (!id) throw new Error('Not signed in');
  return id;
}

function rememberCall(callId: ID | null): void {
  try {
    if (callId) sessionStorage.setItem(CURRENT_CALL_KEY, callId);
    else sessionStorage.removeItem(CURRENT_CALL_KEY);
  } catch {
    /* storage disabled */
  }
}

function rememberedCall(): ID | null {
  try {
    return sessionStorage.getItem(CURRENT_CALL_KEY);
  } catch {
    return null;
  }
}

function patch(partial: Partial<ActiveCall>): void {
  store().patchActive(partial);
}

/** Recompute the phase from the call + connection states (and stamp connectedAt). */
function recompute(): void {
  const a = active();
  if (!a || a.phase === 'ended') return;
  const phase = derivePhase({
    call: a.call,
    selfId: selfId(),
    connections: a.connections,
    starting,
    reconnecting,
  });
  const next: Partial<ActiveCall> = {};
  if (phase !== a.phase) next.phase = phase;
  if (phase === 'connected' && !a.connectedAt) next.connectedAt = Date.now();
  if (Object.keys(next).length) patch(next);
}

function newActive(call: Call, opts: { outgoing: boolean; videoOff: boolean }): ActiveCall {
  return {
    call,
    audioMuted: false,
    videoOff: opts.videoOff,
    screenSharing: false,
    minimized: false,
    phase: 'starting',
    outgoing: opts.outgoing,
    connections: {},
    speaking: [],
    activeSpeakerId: null,
    connectedAt: null,
    endReason: null,
    facingMode: 'user',
    canFlip: false,
    audioBlocked: false,
    outputDeviceId: null,
    mediaError: null,
  };
}

function clearEndTimer(): void {
  if (endTimer) clearTimeout(endTimer);
  endTimer = null;
}

// ---------------------------------------------------------------------------
// Engine & media
// ---------------------------------------------------------------------------

function createEngine(iceServers: RTCIceServer[]): CallEngine {
  engine?.close();
  const e = new CallEngine({
    selfId: selfId(),
    iceServers,
    sendSignal: (toUserId, signal) => {
      const callId = active()?.call.id;
      if (callId && engine === e) sendEvent('call:signal', { callId, toUserId, signal });
    },
    events: {
      onPeerState: (userId, state) => {
        const a = active();
        if (!a || engine !== e) return;
        patch({ connections: { ...a.connections, [userId]: state } });
        recompute();
      },
      onSpeaking: ({ speaking, activeSpeakerId }) => {
        if (engine === e) patch({ speaking, activeSpeakerId });
      },
      onAudioBlocked: (audioBlocked) => {
        if (engine === e) patch({ audioBlocked });
      },
      onScreenShareEnded: () => {
        if (engine !== e) return;
        patch({ screenSharing: false });
        broadcastMedia();
      },
    },
  });
  engine = e;
  return e;
}

interface LocalMedia {
  mic: MediaStreamTrack;
  camera: MediaStreamTrack | null;
  cameraError: string | null;
}

/** Microphone (required) + camera (optional: failures fall back to audio only). */
async function acquireMedia(video: boolean, compact: boolean): Promise<LocalMedia> {
  const micStream = await getMicrophoneStream();
  const mic = micStream.getAudioTracks()[0]!;
  let camera: MediaStreamTrack | null = null;
  let cameraError: string | null = null;
  if (video) {
    try {
      camera = await getCameraTrack({ facingMode: 'user', compact });
    } catch (e) {
      cameraError = e instanceof Error ? e.message : 'Camera unavailable';
    }
  }
  return { mic, camera, cameraError };
}

function releaseMedia(m: LocalMedia | null): void {
  m?.mic.stop();
  m?.camera?.stop();
}

async function hasMultipleCameras(): Promise<boolean> {
  return (await listDevices('videoinput')).length > 1;
}

function broadcastMedia(): void {
  const a = active();
  if (!a?.call.id || a.phase === 'ended') return;
  sendEvent('call:media', {
    callId: a.call.id,
    audioMuted: a.audioMuted,
    // Peers render our video while the camera OR a screen share is on.
    videoOff: a.videoOff && !a.screenSharing,
    screenSharing: a.screenSharing,
  });
}

// ---------------------------------------------------------------------------
// Listeners (installed while a call is active)
// ---------------------------------------------------------------------------

function isMine(callId: ID): boolean {
  const a = active();
  return !!a && a.phase !== 'ended' && a.call.id === callId;
}

function onBeforeUnload(e: BeforeUnloadEvent): void {
  const a = active();
  if (!a || a.phase === 'ended') return;
  e.preventDefault();
  // Legacy browsers need returnValue set.
  e.returnValue = '';
}

function onPageHide(e: PageTransitionEvent): void {
  const a = active();
  if (e.persisted || !a?.call.id || a.phase === 'ended') return;
  sendEvent('call:leave', { callId: a.call.id });
  rememberCall(null);
}

function installListeners(): void {
  if (offs.length) return;
  offs = [
    bus.on('call:updated', ({ call }) => {
      if (isMine(call.id)) applyCall(call);
    }),
    bus.on('call:ended', ({ call }) => {
      if (isMine(call.id)) finish(call);
    }),
    bus.on('call:participant-joined', ({ callId, userId }) => {
      if (!isMine(callId) || userId === getMyId()) return;
      // A (re)joining participant: drop any old connection and wait for their offer.
      engine?.removePeer(userId);
      const a = active()!;
      patch({ connections: { ...a.connections, [userId]: 'waiting' } });
      recompute();
    }),
    bus.on('call:participant-left', ({ callId, userId }) => {
      if (!isMine(callId)) return;
      dropPeer(userId);
    }),
    bus.on('call:signal', ({ callId, fromUserId, signal }) => {
      if (!isMine(callId) || !engine) return;
      engine.handleSignal(fromUserId, signal);
    }),
    bus.on('call:media', ({ callId, userId, audioMuted, videoOff, screenSharing }) => {
      if (!isMine(callId)) return;
      const a = active()!;
      patch({
        call: {
          ...a.call,
          participants: a.call.participants.map((p) =>
            p.userId === userId ? { ...p, audioMuted, videoOff, screenSharing } : p,
          ),
        },
      });
    }),
    useConnection.subscribe((s, prev) => {
      if (prev.ready && !s.ready) onSocketDown();
    }),
  ];
  window.addEventListener('beforeunload', onBeforeUnload);
  window.addEventListener('pagehide', onPageHide);
  offs.push(() => {
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('pagehide', onPageHide);
  });
}

function removeListeners(): void {
  for (const off of offs) off();
  offs = [];
}

function dropPeer(userId: ID): void {
  engine?.removePeer(userId);
  const a = active();
  if (!a || !(userId in a.connections)) return;
  const connections = { ...a.connections };
  delete connections[userId];
  patch({ connections });
  recompute();
}

function onSocketDown(): void {
  const a = active();
  if (!a || a.phase === 'ended' || !a.call.id) return;
  reconnecting = true;
  recompute();
}

/** Merge a newer server copy of my call. */
function applyCall(call: Call): void {
  const a = active();
  if (!a || (a.call.id && a.call.id !== call.id)) return;
  store().setLiveCall(call);
  if (isTerminal(call)) {
    finish(call);
    return;
  }
  const me = selfId();
  let connections = a.connections;
  for (const id of Object.keys(connections)) {
    if (participantOf(call, id)?.status !== 'joined') {
      engine?.removePeer(id);
      connections = { ...connections };
      delete connections[id];
    }
  }
  // Keep my own flags authoritative locally (the server copy may lag behind a toggle).
  const participants = call.participants.map((p) =>
    p.userId === me
      ? {
          ...p,
          audioMuted: a.audioMuted,
          videoOff: a.videoOff && !a.screenSharing,
          screenSharing: a.screenSharing,
        }
      : p,
  );
  patch({ call: { ...call, participants }, connections });
  recompute();
}

/** End locally: tear down media, show the ended state briefly, then clear. */
function finish(call: Call | null, opts: { reason?: string; local?: boolean } = {}): void {
  const a = active();
  if (!a || a.phase === 'ended') {
    if (call) store().setLiveCall(call);
    return;
  }
  attempt++;
  starting = false;
  reconnecting = false;
  cancelRequested = false;
  engine?.close();
  engine = null;
  removeListeners();
  rememberCall(null);
  const me = getMyId() ?? '';
  const final = call ?? a.call;
  if (call) store().setLiveCall(call);
  const reason = opts.reason ?? (call ? endReasonText(call, me) : 'Call ended');
  patch({
    call: final,
    phase: 'ended',
    endReason: reason,
    speaking: [],
    activeSpeakerId: null,
    minimized: false,
  });
  playSound('end');
  scheduleLogRefresh();
  // Unanswered outgoing 1:1 calls keep the screen up for "Call again".
  const retryable =
    !opts.local &&
    a.outgoing &&
    !final.isGroup &&
    (final.status === 'missed' || final.status === 'declined');
  clearEndTimer();
  const ended = active();
  endTimer = setTimeout(
    () => {
      if (store().active === ended) store().setActive(null);
    },
    opts.local ? 900 : retryable ? 8_000 : 2_200,
  );
}

function scheduleLogRefresh(): void {
  if (logRefreshTimer) clearTimeout(logRefreshTimer);
  logRefreshTimer = setTimeout(() => {
    if (store().log.loaded) void store().loadLog({ refresh: true });
  }, 600);
}

function teardown(): void {
  attempt++;
  starting = false;
  reconnecting = false;
  cancelRequested = false;
  engine?.close();
  engine = null;
  removeListeners();
  rememberCall(null);
  clearEndTimer();
  store().setActive(null);
}

// ---------------------------------------------------------------------------
// Entering a call
// ---------------------------------------------------------------------------

type EnterMode = 'accept' | 'join' | 'rejoin';

/** Ack of accept/join/rejoin, then offer to every other joined participant. */
async function enterCall(callId: ID, mode: EnterMode, my: number): Promise<void> {
  const a = active();
  if (!a) return;
  const event = mode === 'accept' ? 'call:accept' : mode === 'join' ? 'call:join' : 'call:rejoin';
  const res = await emitWithAck(event, {
    callId,
    audioMuted: a.audioMuted,
    videoOff: a.videoOff && !a.screenSharing,
  });
  if (my !== attempt) {
    // Hung up meanwhile.
    sendEvent('call:leave', { callId });
    return;
  }
  starting = false;
  reconnecting = false;
  rememberCall(callId);
  const me = selfId();
  const connections: ActiveCall['connections'] = {};
  for (const p of joinedOthers(res.call, me)) {
    engine?.connectTo(p.userId);
    connections[p.userId] = 'new';
  }
  patch({ call: { ...res.call, id: callId }, connections });
  applyCall(res.call);
  if (a.screenSharing) broadcastMedia();
}

function enterErrorMessage(e: unknown): string {
  if (isApiError(e)) {
    if (e.code === 'expired') return 'This call has already ended';
    if (e.code === 'limit_reached')
      return `This call is full (${MAX_CALL_PARTICIPANTS} people max)`;
    if (e.code === 'conflict') return e.message || "You're already in another call";
    if (e.code === 'network_error' || e.code === 'timeout')
      return "Can't connect the call. Check your connection.";
    return e.message;
  }
  return e instanceof Error ? e.message : 'Could not join the call';
}

async function prepareMedia(
  my: number,
  type: CallType,
  isGroup: boolean,
): Promise<LocalMedia | null> {
  let media: LocalMedia | null = null;
  try {
    const [m, ice] = await Promise.all([acquireMedia(type === 'video', isGroup), getIceServers()]);
    media = m;
    if (my !== attempt) {
      releaseMedia(media);
      return null;
    }
    const e = createEngine(ice);
    e.setMicrophone(media.mic);
    e.setCamera(media.camera);
    patch({
      videoOff: !media.camera,
      mediaError: media.cameraError ? `${media.cameraError} — continuing with audio` : null,
    });
    void hasMultipleCameras().then((canFlip) => {
      if (my === attempt) patch({ canFlip });
    });
    return media;
  } catch (e) {
    releaseMedia(media);
    throw e;
  }
}

async function liveCallsNow(): Promise<Call[]> {
  const calls = await api.get<ApiResponse<'GET /api/calls/active'>>('/api/calls/active');
  store().setLiveCalls(calls);
  return calls;
}

// ---------------------------------------------------------------------------
// Public actions (called through useCalls)
// ---------------------------------------------------------------------------

function busyWithAnotherCall(chatId: ID): boolean {
  const a = active();
  if (!a || a.phase === 'ended') {
    if (a) {
      clearEndTimer();
      store().setActive(null);
    }
    return false;
  }
  if (a.call.chatId === chatId) {
    patch({ minimized: false });
    return true;
  }
  toast.info("You're already in a call");
  return true;
}

export async function startCall(chatId: ID, type: CallType, userIds?: ID[]): Promise<void> {
  if (busyWithAnotherCall(chatId)) return;
  if (!callsSupported()) {
    toast.error('Calls are not supported in this browser');
    return;
  }
  const me = selfId();
  const chat = getChat(chatId);
  if (chat && !chat.permissions.canCall) {
    toast.error(
      chat.type === 'channel' ? "Calls aren't available in channels" : "You can't call this chat",
    );
    return;
  }
  const s = store();
  // They are calling me from this chat right now: answer instead.
  if (s.incoming?.call.chatId === chatId) {
    await acceptIncoming();
    return;
  }
  // A live group call in this chat: join it instead of starting another one.
  const live = s.liveCalls[chatId];
  if (live && live.isGroup && !isTerminal(live)) {
    await joinCall(live.id);
    return;
  }
  if (chat?.type === 'group' && !userIds && chat.memberCount - 1 > MAX_CALL_PARTICIPANTS - 1) {
    s.openPicker({ chatId, type, mode: 'start' });
    return;
  }

  const my = ++attempt;
  starting = true;
  reconnecting = false;
  cancelRequested = false;
  clearEndTimer();
  const now = new Date().toISOString();
  const isGroup = chat?.type === 'group';
  const invitees: ID[] = chat?.type === 'direct' && chat.peer ? [chat.peer.id] : (userIds ?? []);
  const provisional: Call = {
    id: '',
    chatId,
    type,
    isGroup,
    initiatorId: me,
    status: 'ringing',
    createdAt: now,
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    participants: [
      participantStub(me, 'joined', type),
      ...invitees.filter((id) => id !== me).map((id) => participantStub(id, 'invited', type)),
    ],
  };
  store().setActive(newActive(provisional, { outgoing: true, videoOff: type === 'audio' }));
  installListeners();

  try {
    const media = await prepareMedia(my, type, isGroup);
    if (!media) return;
    const a = active()!;
    const res = await emitWithAck('call:start', {
      chatId,
      type,
      ...(userIds?.length ? { userIds } : {}),
      audioMuted: a.audioMuted,
      videoOff: a.videoOff,
    });
    if (my !== attempt || cancelRequested) {
      sendEvent('call:leave', { callId: res.call.id });
      return;
    }
    starting = false;
    rememberCall(res.call.id);
    patch({ call: res.call });
    applyCall(res.call);
  } catch (e) {
    if (my !== attempt) return;
    if (isApiError(e) && e.code === 'conflict') {
      await resolveStartConflict(chatId, my);
      return;
    }
    teardown();
    if (e instanceof MediaAccessError) toast.error(e.message);
    else toast.error(isApiError(e) && e.code === 'forbidden' ? e.message : enterErrorMessage(e));
  }
}

function participantStub(
  userId: ID,
  status: CallParticipant['status'],
  type: CallType,
): CallParticipant {
  return {
    userId,
    status,
    joinedAt: null,
    leftAt: null,
    audioMuted: false,
    videoOff: type === 'audio',
    screenSharing: false,
  };
}

/** `call:start` → conflict: the chat already has a live call (accept/join it) or I'm busy. */
async function resolveStartConflict(chatId: ID, my: number): Promise<void> {
  try {
    const calls = await liveCallsNow();
    if (my !== attempt) return;
    const me = selfId();
    const live = calls.find((c) => c.chatId === chatId);
    const mine = live ? participantOf(live, me) : undefined;
    if (live && mine && isPendingStatus(mine.status)) {
      // 1:1 cross-call: they called me at the same time — answer theirs.
      store().setIncoming(null);
      patch({ call: live, outgoing: false });
      await enterCall(live.id, 'accept', my);
      return;
    }
    if (live && live.isGroup && mine?.status !== 'joined') {
      patch({ call: live, outgoing: false });
      await enterCall(live.id, 'join', my);
      return;
    }
    teardown();
    toast.info(
      mine?.status === 'joined'
        ? "You're already in this call on another device"
        : "You're already in another call",
    );
  } catch (e) {
    if (my !== attempt) return;
    teardown();
    toast.error(enterErrorMessage(e));
  }
}

export async function acceptIncoming(): Promise<void> {
  const inc = store().incoming;
  if (!inc) return;
  const cur = active();
  if (cur && cur.phase !== 'ended') {
    // "End & accept": leave the current call first.
    leaveCall();
  }
  clearEndTimer();
  store().setIncoming(null);
  const my = ++attempt;
  starting = true;
  reconnecting = false;
  store().setActive(newActive(inc.call, { outgoing: false, videoOff: inc.call.type === 'audio' }));
  installListeners();
  try {
    const media = await prepareMedia(my, inc.call.type, inc.call.isGroup);
    if (!media) return;
    await enterCall(inc.call.id, 'accept', my);
  } catch (e) {
    if (my !== attempt) return;
    teardown();
    if (e instanceof MediaAccessError) {
      sendEvent('call:decline', { callId: inc.call.id });
      toast.error(e.message);
    } else {
      toast.error(enterErrorMessage(e));
    }
  }
}

export async function joinCall(callId: ID): Promise<void> {
  const s = store();
  const cur = active();
  if (cur && cur.phase !== 'ended') {
    if (cur.call.id === callId) {
      patch({ minimized: false });
      return;
    }
    toast.info("You're already in a call");
    return;
  }
  if (!callsSupported()) {
    toast.error('Calls are not supported in this browser');
    return;
  }
  clearEndTimer();
  let call = Object.values(s.liveCalls).find((c) => c.id === callId);
  if (!call) {
    try {
      call = (await liveCallsNow()).find((c) => c.id === callId);
    } catch (e) {
      toast.error(e);
      return;
    }
  }
  if (!call) {
    toast.info('This call has already ended');
    return;
  }
  const me = selfId();
  const mine = participantOf(call, me);
  const mode: EnterMode = mine && isPendingStatus(mine.status) ? 'accept' : 'join';
  if (s.incoming?.call.id === callId) s.setIncoming(null);
  const my = ++attempt;
  starting = true;
  reconnecting = false;
  store().setActive(newActive(call, { outgoing: false, videoOff: call.type === 'audio' }));
  installListeners();
  try {
    const media = await prepareMedia(my, call.type, call.isGroup);
    if (!media) return;
    await enterCall(call.id, mode, my);
  } catch (e) {
    if (my !== attempt) return;
    teardown();
    toast.error(e instanceof MediaAccessError ? e.message : enterErrorMessage(e));
  }
}

export function leaveCall(): void {
  const a = active();
  if (!a) return;
  if (a.phase === 'ended') {
    clearEndTimer();
    store().setActive(null);
    return;
  }
  if (a.call.id) sendEvent('call:leave', { callId: a.call.id });
  else cancelRequested = true;
  const unanswered = a.outgoing && !a.connectedAt && !joinedOthers(a.call, getMyId() ?? '').length;
  finish(null, { local: true, reason: unanswered ? 'Call cancelled' : 'Call ended' });
}

export async function inviteToCall(userIds: ID[]): Promise<void> {
  const a = active();
  if (!a?.call.id || !userIds.length) return;
  try {
    const res = await emitWithAck('call:invite', { callId: a.call.id, userIds });
    applyCall(res.call);
    toast.success(userIds.length === 1 ? 'Ringing…' : `Ringing ${userIds.length} people…`);
  } catch (e) {
    toast.error(enterErrorMessage(e));
  }
}

export function toggleMute(): void {
  const a = active();
  if (!a || a.phase === 'ended') return;
  const audioMuted = !a.audioMuted;
  engine?.setMuted(audioMuted);
  patch({ audioMuted });
  broadcastMedia();
}

export async function toggleVideo(): Promise<void> {
  const a = active();
  if (!a || a.phase === 'ended' || !engine) return;
  const e = engine;
  if (!a.videoOff) {
    e.setCamera(null);
    patch({ videoOff: true });
    broadcastMedia();
    return;
  }
  try {
    const track = await getCameraTrack({ facingMode: a.facingMode, compact: a.call.isGroup });
    if (engine !== e || active()?.phase === 'ended') {
      track.stop();
      return;
    }
    e.setCamera(track);
    patch({ videoOff: false, mediaError: null });
    broadcastMedia();
    void hasMultipleCameras().then((canFlip) => patch({ canFlip }));
  } catch (err) {
    toast.error(err);
  }
}

export async function flipCamera(): Promise<void> {
  const a = active();
  if (!a || a.videoOff || !engine) return;
  const e = engine;
  const facingMode = a.facingMode === 'user' ? 'environment' : 'user';
  try {
    // Desktop: cycle through cameras by id; phones: toggle front/back.
    const cams = await listDevices('videoinput');
    let deviceId: string | undefined;
    if (cams.length > 1 && cams.every((c) => c.deviceId)) {
      const current = e.currentCameraDeviceId();
      const i = cams.findIndex((c) => c.deviceId === current);
      deviceId = cams[(i + 1) % cams.length]!.deviceId;
    }
    // Stop the old camera first: many phones can't open two cameras at once.
    e.setCamera(null);
    const track = await getCameraTrack(
      deviceId ? { deviceId, compact: a.call.isGroup } : { facingMode, compact: a.call.isGroup },
    );
    if (engine !== e) {
      track.stop();
      return;
    }
    e.setCamera(track);
    patch({
      facingMode:
        track.getSettings().facingMode === 'environment'
          ? 'environment'
          : deviceId
            ? 'user'
            : facingMode,
    });
  } catch (err) {
    toast.error(err);
    patch({ videoOff: true });
    broadcastMedia();
  }
}

export async function toggleScreenShare(): Promise<void> {
  const a = active();
  if (!a || a.phase === 'ended' || !engine) return;
  const e = engine;
  if (a.screenSharing) {
    e.setScreen(null);
    patch({ screenSharing: false });
    broadcastMedia();
    return;
  }
  try {
    const track = await getScreenTrack();
    if (engine !== e) {
      track.stop();
      return;
    }
    e.setScreen(track);
    patch({ screenSharing: true });
    broadcastMedia();
  } catch (err) {
    if (err instanceof MediaAccessError && err.kind === 'cancelled') return;
    toast.error(err);
  }
}

export async function setOutputDevice(deviceId: string): Promise<void> {
  await engine?.setOutputDevice(deviceId);
  patch({ outputDeviceId: deviceId });
}

export function resumeAudio(): void {
  engine?.resumeAudio();
}

// ---------------------------------------------------------------------------
// Reconnect / reload (called by realtime/calls.ts after every `ready`)
// ---------------------------------------------------------------------------

/** Reconcile with `GET /api/calls/active` after a (re)connect. */
export async function reconcile(calls: Call[], info: Pick<ReadyInfo, 'reconnect'>): Promise<void> {
  const a = active();
  const me = getMyId();
  if (!me) return;
  if (a && a.phase !== 'ended' && a.call.id) {
    const live = calls.find((c) => c.id === a.call.id);
    if (!live) {
      finish(null, { reason: 'Call ended' });
      return;
    }
    if (!reconnecting && !info.reconnect) {
      applyCall(live);
      return;
    }
    if (participantOf(live, me)?.status !== 'joined') {
      finish(null, { reason: 'Call ended' });
      return;
    }
    await rejoin(live);
    return;
  }
  if (!a && !info.reconnect) {
    // Page reload: this tab was in a call it hasn't left (sessionStorage) → rejoin.
    const remembered = rememberedCall();
    const live = remembered ? calls.find((c) => c.id === remembered) : undefined;
    if (live && participantOf(live, me)?.status === 'joined') await rejoinAfterReload(live);
    else if (remembered) rememberCall(null);
  }
}

/** Socket came back: close peer connections and act as a newcomer (`call:rejoin`). */
async function rejoin(call: Call): Promise<void> {
  const my = attempt;
  reconnecting = true;
  engine?.closePeers();
  patch({ connections: {} });
  recompute();
  try {
    await enterCall(call.id, 'rejoin', my);
  } catch (e) {
    if (my !== attempt) return;
    finish(null, {
      reason: isApiError(e) && e.code === 'expired' ? 'Call ended' : 'Connection lost',
    });
  }
}

async function rejoinAfterReload(call: Call): Promise<void> {
  const me = selfId();
  const mine = participantOf(call, me);
  const my = ++attempt;
  reconnecting = true;
  const a = newActive(call, {
    outgoing: call.initiatorId === me,
    videoOff: mine?.videoOff ?? true,
  });
  a.audioMuted = mine?.audioMuted ?? false;
  a.phase = 'reconnecting';
  store().setActive(a);
  installListeners();
  try {
    const media = await prepareMedia(my, a.videoOff ? 'audio' : 'video', call.isGroup);
    if (!media) return;
    engine?.setMuted(a.audioMuted);
    await enterCall(call.id, 'rejoin', my);
  } catch (e) {
    if (my !== attempt) return;
    teardown();
    if (!(isApiError(e) && e.code === 'conflict')) toast.error(enterErrorMessage(e));
  }
}

/** Logout / account switch: drop everything without events. */
export function resetCallSession(): void {
  const a = active();
  if (a?.call.id && a.phase !== 'ended') sendEvent('call:leave', { callId: a.call.id });
  teardown();
  if (logRefreshTimer) clearTimeout(logRefreshTimer);
}

registerSessionReset(resetCallSession);

/** Test seam: whether an engine is running. */
export function _hasEngine(): boolean {
  return !!engine;
}
