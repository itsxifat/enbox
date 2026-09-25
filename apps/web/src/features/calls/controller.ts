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
 * - my own participant leaving `joined` (forced leave, grace expired) ends the call here.
 * - socket drop → reconnecting; next `ready` → `GET /api/calls/active` → `call:rejoin`,
 *   retried while the server still sees the old call socket (`conflict`) or the ack is lost.
 * - an accept/join/start ack lost to a socket drop is resolved on the next `ready` (rejoin
 *   if the server joined me, redo the accept/join otherwise).
 * - page reload while in a call → auto-rejoin (this tab only, via sessionStorage). The tab
 *   does not leave on `pagehide` (a reload fires it too): a closed tab is released by the
 *   server after CALL_RECONNECT_GRACE_MS.
 */
import {
  CALL_RECONNECT_GRACE_MS,
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
import {
  emitWithAck,
  isSocketConnected,
  sendEvent,
  useConnection,
  type ReadyInfo,
} from '@/lib/socket';
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

type EnterMode = 'accept' | 'join' | 'rejoin';

let engine: CallEngine | null = null;
/** Incremented for every new call attempt; async steps of an older attempt abort. */
let attempt = 0;
/** Waiting for the start/accept/join ack. */
let starting = false;
/** Socket down or rejoin in flight. */
let reconnecting = false;
/** Hang up pressed before the start ack arrived. */
let cancelRequested = false;
/**
 * The start/accept/join ack was lost because the socket dropped (unknown outcome): the next
 * `ready` decides (rejoin if the server joined me, else redo it).
 */
let lostEnter: 'start' | 'accept' | 'join' | null = null;
/** The attempt a rejoin loop is running for (one loop at a time). */
let rejoiningAttempt: number | null = null;
/** Give up rejoining after this (epoch ms). */
let rejoinDeadline = 0;
/** Newest camera action (toggle / flip): an older one finishing late is discarded. */
let videoOp = 0;
let offs: (() => void)[] = [];
let endTimer: ReturnType<typeof setTimeout> | null = null;
let logRefreshTimer: ReturnType<typeof setTimeout> | null = null;

const CURRENT_CALL_KEY = 'enbox.calls.current';

/**
 * How long a reconnecting/reloaded client keeps retrying `call:rejoin`. Longer than the
 * server's grace: the grace only starts once the server has seen the old socket close, which
 * can take a ping timeout after a network drop. The server's answer (my participant no longer
 * `joined`) ends the retries earlier.
 */
export const REJOIN_WINDOW_MS = CALL_RECONNECT_GRACE_MS * 3;
/** A page reload auto-rejoins only if the page went away less than this ago. */
const RELOAD_REJOIN_MS = CALL_RECONNECT_GRACE_MS * 2;

const store = () => useCalls.getState();
const active = () => store().active;

function selfId(): ID {
  const id = getMyId();
  if (!id) throw new Error('Not signed in');
  return id;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface RememberedCall {
  callId: ID;
  /** Epoch ms of the last write (the `pagehide` of a reload writes it last). */
  at: number;
}

function rememberCall(callId: ID | null): void {
  try {
    if (callId)
      sessionStorage.setItem(CURRENT_CALL_KEY, JSON.stringify({ callId, at: Date.now() }));
    else sessionStorage.removeItem(CURRENT_CALL_KEY);
  } catch {
    /* storage disabled */
  }
}

function rememberedCall(): RememberedCall | null {
  try {
    const raw = sessionStorage.getItem(CURRENT_CALL_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<RememberedCall> | null;
    if (v && typeof v.callId === 'string' && typeof v.at === 'number')
      return { callId: v.callId, at: v.at };
  } catch {
    /* storage disabled / legacy value */
  }
  return null;
}

/** This document was loaded by a reload (F5 / location.reload()), not a new navigation. */
function isReloadNavigation(): boolean {
  try {
    const nav = performance.getEntriesByType?.('navigation')[0] as
      PerformanceNavigationTiming | undefined;
    return nav?.type === 'reload';
  } catch {
    return false;
  }
}

/** Patch the active call. An ended call only takes the patch that ends it. */
function patch(partial: Partial<ActiveCall>): void {
  const a = active();
  if (!a || (a.phase === 'ended' && partial.phase === undefined)) return;
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

/** Reset the per-attempt flags (a new attempt starts, or the call is over). */
function resetFlags(): void {
  attempt++;
  starting = false;
  reconnecting = false;
  cancelRequested = false;
  lostEnter = null;
  rejoinDeadline = 0;
}

// ---------------------------------------------------------------------------
// Engine & media
// ---------------------------------------------------------------------------

function createEngine(iceServers: RTCIceServer[]): CallEngine {
  engine?.close();
  const e = new CallEngine({
    selfId: selfId(),
    iceServers,
    refreshIceServers: () => getIceServers(),
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

/** The media flags as the server should see them. */
function mediaFlags(a: ActiveCall): { audioMuted: boolean; videoOff: boolean } {
  // Peers render our video while the camera OR a screen share is on.
  return { audioMuted: a.audioMuted, videoOff: a.videoOff && !a.screenSharing };
}

function broadcastMedia(): void {
  const a = active();
  if (!a?.call.id || a.phase === 'ended') return;
  sendEvent('call:media', { callId: a.call.id, ...mediaFlags(a), screenSharing: a.screenSharing });
}

/**
 * After a start/accept/join/rejoin ack: toggles made while it was pending went nowhere (no
 * call id yet, or not the call socket yet), so send the current flags if they differ.
 */
function syncMediaAfterAck(sent: { audioMuted: boolean; videoOff: boolean }): void {
  const a = active();
  if (!a || a.phase === 'ended') return;
  const now = mediaFlags(a);
  if (a.screenSharing || now.audioMuted !== sent.audioMuted || now.videoOff !== sent.videoOff)
    broadcastMedia();
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

/**
 * Reload or close: `pagehide` can't tell them apart, so never leave here. Stamp the
 * remembered call instead: a reload rejoins it (rejoinAfterReload), a closed tab is released
 * by the server once CALL_RECONNECT_GRACE_MS passed without a rejoin.
 */
function onPageHide(e: PageTransitionEvent): void {
  const a = active();
  if (e.persisted || !a?.call.id || a.phase === 'ended') return;
  rememberCall(a.call.id);
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
  if (!reconnecting || !rejoinDeadline) rejoinDeadline = Date.now() + REJOIN_WINDOW_MS;
  reconnecting = true;
  recompute();
}

/** Merge a newer server copy of my call. */
function applyCall(call: Call): void {
  const a = active();
  if (!a || (a.call.id && a.call.id !== call.id)) return;
  store().setLiveCall(call);
  if (a.phase === 'ended') return;
  if (isTerminal(call)) {
    finish(call);
    return;
  }
  const me = selfId();
  // The call goes on without me (removed from the group, left on the server after the
  // reconnect grace…): the server won't tell me more (it released my call socket first).
  // While an accept/join ack is pending my status is legitimately not `joined` yet.
  if (!starting && !lostEnter && participantOf(call, me)?.status !== 'joined') {
    finish(call, { reason: 'Call ended' });
    return;
  }
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
    p.userId === me ? { ...p, ...mediaFlags(a), screenSharing: a.screenSharing } : p,
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
  resetFlags();
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
  // Compare state, not identity: late patches (acks, device probes) replace the object.
  endTimer = setTimeout(
    () => {
      endTimer = null;
      const cur = store().active;
      if (cur?.phase === 'ended' && cur.call.id === final.id) store().setActive(null);
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
  resetFlags();
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

/** Ack of accept/join/rejoin, then offer to every other joined participant. */
async function enterCall(callId: ID, mode: EnterMode, my: number): Promise<void> {
  const a = active();
  if (!a) return;
  const event = mode === 'accept' ? 'call:accept' : mode === 'join' ? 'call:join' : 'call:rejoin';
  const sent = mediaFlags(a);
  const res = await emitWithAck(event, { callId, ...sent });
  if (my !== attempt) {
    // Hung up meanwhile.
    sendEvent('call:leave', { callId });
    return;
  }
  starting = false;
  reconnecting = false;
  lostEnter = null;
  rejoinDeadline = 0;
  rememberCall(callId);
  const me = selfId();
  const connections: ActiveCall['connections'] = {};
  for (const p of joinedOthers(res.call, me)) {
    engine?.connectTo(p.userId);
    connections[p.userId] = 'new';
  }
  patch({ call: { ...res.call, id: callId }, connections });
  applyCall(res.call);
  syncMediaAfterAck(sent);
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
    // Mute pressed while the media was being acquired: apply it before any link exists.
    e.setMuted(active()?.audioMuted ?? false);
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

/**
 * The accept/join ack failed. A `timeout` is an unknown outcome (the server may have joined
 * me): on a live socket, undo it (a leave counts once a late accept binds this socket; a
 * decline covers an accept that never ran); after a socket drop, let the next `ready`
 * decide (reconcile). Anything else: nothing happened server-side.
 */
function onEnterFailed(e: unknown, callId: ID, mode: 'accept' | 'join', my: number): void {
  if (my !== attempt) return;
  if (isApiError(e) && e.code === 'timeout') {
    if (!isSocketConnected()) {
      starting = false;
      reconnecting = true;
      lostEnter = mode;
      if (!rejoinDeadline) rejoinDeadline = Date.now() + REJOIN_WINDOW_MS;
      rememberCall(callId);
      recompute();
      return;
    }
    sendEvent('call:leave', { callId });
    if (mode === 'accept') sendEvent('call:decline', { callId });
    teardown();
    toast.error(enterErrorMessage(e));
    return;
  }
  teardown();
  if (e instanceof MediaAccessError) {
    if (mode === 'accept') sendEvent('call:decline', { callId });
    toast.error(e.message);
  } else {
    toast.error(enterErrorMessage(e));
  }
}

/** My live call in `chatId` that I started and am joined to (a start whose ack was lost). */
function myStartedCall(calls: Call[], chatId: ID, me: ID): Call | undefined {
  return calls.find(
    (c) =>
      c.chatId === chatId &&
      c.initiatorId === me &&
      !isTerminal(c) &&
      participantOf(c, me)?.status === 'joined',
  );
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

  resetFlags();
  const my = attempt;
  starting = true;
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
    const sent = mediaFlags(a);
    const res = await emitWithAck('call:start', {
      chatId,
      type,
      ...(userIds?.length ? { userIds } : {}),
      ...sent,
    });
    if (my !== attempt || cancelRequested) {
      sendEvent('call:leave', { callId: res.call.id });
      return;
    }
    starting = false;
    rememberCall(res.call.id);
    patch({ call: res.call });
    applyCall(res.call);
    syncMediaAfterAck(sent);
  } catch (e) {
    if (my !== attempt) return;
    if (isApiError(e) && e.code === 'conflict') {
      await resolveStartConflict(chatId, my);
      return;
    }
    if (isApiError(e) && e.code === 'timeout') {
      // Unknown outcome: the server may have created the call (lost ack).
      if (!isSocketConnected()) {
        // Adopt (and rejoin) or drop it on the next `ready` (reconcile).
        starting = false;
        reconnecting = true;
        lostEnter = 'start';
        rejoinDeadline = Date.now() + REJOIN_WINDOW_MS;
        recompute();
        return;
      }
      teardown();
      toast.error(enterErrorMessage(e));
      void leaveOrphanedStart(chatId, me);
      return;
    }
    teardown();
    if (e instanceof MediaAccessError) toast.error(e.message);
    else toast.error(isApiError(e) && e.code === 'forbidden' ? e.message : enterErrorMessage(e));
  }
}

/** A `call:start` that timed out on a live socket may still commit: leave that call. */
async function leaveOrphanedStart(chatId: ID, me: ID): Promise<void> {
  for (const wait of [0, 5_000]) {
    if (wait) await sleep(wait);
    if (active()) return; // a new call started meanwhile
    const calls = await liveCallsNow().catch(() => null);
    const orphan = calls && myStartedCall(calls, chatId, me);
    if (orphan && !active()) {
      sendEvent('call:leave', { callId: orphan.id });
      return;
    }
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
  let mode: 'accept' | 'join' | null = null;
  let callId: ID | null = null;
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
      mode = 'accept';
      callId = live.id;
      await enterCall(live.id, 'accept', my);
      return;
    }
    if (live && live.isGroup && mine?.status !== 'joined') {
      patch({ call: live, outgoing: false });
      mode = 'join';
      callId = live.id;
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
    if (mode && callId) {
      onEnterFailed(e, callId, mode, my);
      return;
    }
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
  resetFlags();
  const my = attempt;
  starting = true;
  store().setActive(newActive(inc.call, { outgoing: false, videoOff: inc.call.type === 'audio' }));
  installListeners();
  try {
    const media = await prepareMedia(my, inc.call.type, inc.call.isGroup);
    if (!media) return;
    await enterCall(inc.call.id, 'accept', my);
  } catch (e) {
    onEnterFailed(e, inc.call.id, 'accept', my);
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
  const mode = mine && isPendingStatus(mine.status) ? 'accept' : 'join';
  if (s.incoming?.call.id === callId) s.setIncoming(null);
  resetFlags();
  const my = attempt;
  starting = true;
  store().setActive(newActive(call, { outgoing: false, videoOff: call.type === 'audio' }));
  installListeners();
  try {
    const media = await prepareMedia(my, call.type, call.isGroup);
    if (!media) return;
    await enterCall(call.id, mode, my);
  } catch (e) {
    onEnterFailed(e, call.id, mode, my);
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
  const me = getMyId() ?? '';
  if (a.call.id) {
    sendEvent('call:leave', { callId: a.call.id });
    // Hanging up an accept still acquiring media / waiting for its ack: the server ignores the
    // leave while I'm only ringing, so decline too (a no-op once the accept joined me, where
    // the leave counts instead). Stops the caller's and my other devices' ringing.
    const mine = participantOf(a.call, me);
    if (
      (starting || lostEnter === 'accept') &&
      !a.outgoing &&
      mine &&
      isPendingStatus(mine.status)
    ) {
      sendEvent('call:decline', { callId: a.call.id });
    }
  } else cancelRequested = true;
  const unanswered = a.outgoing && !a.connectedAt && !joinedOthers(a.call, me).length;
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
  // No engine yet (media still being acquired): prepareMedia applies the flag.
  engine?.setMuted(audioMuted);
  patch({ audioMuted });
  broadcastMedia();
}

export async function toggleVideo(): Promise<void> {
  const a = active();
  if (!a || a.phase === 'ended' || !engine) return;
  const e = engine;
  const op = ++videoOp;
  if (!a.videoOff) {
    e.setCamera(null);
    patch({ videoOff: true });
    broadcastMedia();
    return;
  }
  try {
    const track = await getCameraTrack({ facingMode: a.facingMode, compact: a.call.isGroup });
    if (op !== videoOp || engine !== e || active()?.phase === 'ended') {
      track.stop();
      return;
    }
    e.setCamera(track);
    patch({ videoOff: false, mediaError: null });
    broadcastMedia();
    void hasMultipleCameras().then((canFlip) => {
      if (engine === e) patch({ canFlip });
    });
  } catch (err) {
    if (op === videoOp && engine === e) toast.error(err);
  }
}

export async function flipCamera(): Promise<void> {
  const a = active();
  if (!a || a.videoOff || !engine) return;
  const e = engine;
  const op = ++videoOp;
  const facingMode = a.facingMode === 'user' ? 'environment' : 'user';
  // Superseded by a newer camera action, or the camera was turned off meanwhile.
  const stale = () =>
    op !== videoOp || engine !== e || active()?.phase === 'ended' || !!active()?.videoOff;
  try {
    // Desktop: cycle through cameras by id; phones: toggle front/back.
    const cams = await listDevices('videoinput');
    if (stale()) return;
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
    if (stale()) {
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
    if (op !== videoOp || engine !== e) return;
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
  const e = engine;
  if (!e) return;
  await e.setOutputDevice(deviceId);
  if (engine === e) patch({ outputDeviceId: deviceId });
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
  if (a && a.phase !== 'ended') {
    if (!a.call.id) {
      // A `call:start` whose ack was lost to a socket drop: adopt the call if it exists.
      if (lostEnter !== 'start' || !reconnecting) return;
      const started = myStartedCall(calls, a.call.chatId, me);
      if (!started) {
        finish(null, { local: true, reason: "Can't connect the call" });
        return;
      }
      lostEnter = null;
      rememberCall(started.id);
      patch({ call: started });
      await rejoin(started);
      return;
    }
    const live = calls.find((c) => c.id === a.call.id);
    if (!live) {
      finish(null, { reason: 'Call ended' });
      return;
    }
    // Only a client that lost its call socket rejoins: a second rejoin from the bound socket
    // is a no-op on the server but would rebuild every peer connection here.
    if (!reconnecting) {
      applyCall(live);
      return;
    }
    if (rejoiningAttempt === attempt) return; // the running rejoin loop carries on
    const mine = participantOf(live, me);
    if (mine?.status === 'joined') {
      lostEnter = null;
      await rejoin(live);
      return;
    }
    const redo =
      lostEnter === 'accept' && mine && isPendingStatus(mine.status)
        ? 'accept'
        : lostEnter === 'join' && live.isGroup
          ? 'join'
          : null;
    if (!redo) {
      finish(live, { reason: 'Call ended' });
      return;
    }
    // The accept/join never reached the server: do it now.
    const my = attempt;
    lostEnter = null;
    reconnecting = false;
    starting = true;
    recompute();
    try {
      await enterCall(live.id, redo, my);
    } catch (e) {
      onEnterFailed(e, live.id, redo, my);
    }
    return;
  }
  if (!a && !info.reconnect) {
    // Page reload: this tab was in a call it hasn't left (sessionStorage) → rejoin.
    const remembered = rememberedCall();
    if (!remembered) {
      rememberCall(null); // legacy / unreadable value
      return;
    }
    const live = calls.find((c) => c.id === remembered.callId);
    const fresh = isReloadNavigation() && Date.now() - remembered.at < RELOAD_REJOIN_MS;
    if (live && fresh && participantOf(live, me)?.status === 'joined')
      await rejoinAfterReload(live);
    else rememberCall(null);
  }
}

/**
 * `GET /api/calls/active` failed after a reconnect: rejoin the active call anyway and let the
 * ack decide (realtime/calls.ts retries the full resync meanwhile).
 */
export function reconcileWithoutList(): void {
  const a = active();
  if (!a || a.phase === 'ended' || !a.call.id || !reconnecting || lostEnter) return;
  if (rejoiningAttempt === attempt) return;
  void rejoin(a.call);
}

/** Socket came back: close peer connections and act as a newcomer (`call:rejoin`). */
async function rejoin(call: Call): Promise<void> {
  const my = attempt;
  if (rejoiningAttempt === my) return;
  rejoiningAttempt = my;
  try {
    reconnecting = true;
    if (!rejoinDeadline) rejoinDeadline = Date.now() + REJOIN_WINDOW_MS;
    engine?.closePeers();
    patch({ connections: {} });
    recompute();
    // New links (and TURN allocations) after a long call need current credentials.
    await engine?.refreshIceServers();
    if (my !== attempt) return;
    await rejoinLoop(call.id, my);
  } finally {
    if (rejoiningAttempt === my) rejoiningAttempt = null;
  }
}

/**
 * `call:rejoin` until it sticks. `conflict` while the server still sees my old call socket
 * (the grace starts once it has seen it close) → retry with backoff, as long as the server
 * still lists me as joined; a lost ack → retry on this socket, or on the next `ready` if the
 * socket dropped again. Ends the call on definitive errors or after REJOIN_WINDOW_MS.
 */
async function rejoinLoop(callId: ID, my: number): Promise<void> {
  let delay = 500;
  for (;;) {
    try {
      await enterCall(callId, 'rejoin', my);
      return;
    } catch (e) {
      if (my !== attempt) return;
      const code = isApiError(e) ? e.code : null;
      const retryable = code === 'conflict' || code === 'timeout' || code === 'network_error';
      if (!retryable || Date.now() > rejoinDeadline) {
        finish(null, {
          reason:
            code === 'expired' || code === 'conflict' || code === 'not_found'
              ? 'Call ended'
              : code === 'limit_reached'
                ? enterErrorMessage(e)
                : 'Connection lost',
        });
        return;
      }
      // Offline again: the next `ready` reconciles (resyncCalls → reconcile).
      if (!isSocketConnected()) return;
      await sleep(delay);
      delay = Math.min(delay * 2, 3_000);
      if (my !== attempt || !isSocketConnected()) return;
      if (code === 'conflict') {
        // "You are no longer in this call" is a conflict too: check before retrying.
        const calls = await liveCallsNow().catch(() => null);
        if (my !== attempt) return;
        if (calls) {
          const live = calls.find((c) => c.id === callId);
          if (!live || participantOf(live, selfId())?.status !== 'joined') {
            finish(live ?? null, { reason: 'Call ended' });
            return;
          }
        }
      }
    }
  }
}

async function rejoinAfterReload(call: Call): Promise<void> {
  const me = selfId();
  const mine = participantOf(call, me);
  resetFlags();
  const my = attempt;
  reconnecting = true;
  rejoinDeadline = Date.now() + REJOIN_WINDOW_MS;
  const a = newActive(call, {
    outgoing: call.initiatorId === me,
    videoOff: mine?.videoOff ?? true,
  });
  a.audioMuted = mine?.audioMuted ?? false;
  a.phase = 'reconnecting';
  store().setActive(a);
  installListeners();
  try {
    // prepareMedia applies the current mute flag (the user may toggle it meanwhile).
    const media = await prepareMedia(my, a.videoOff ? 'audio' : 'video', call.isGroup);
    if (!media) return;
  } catch (e) {
    if (my !== attempt) return;
    teardown();
    toast.error(e instanceof MediaAccessError ? e.message : enterErrorMessage(e));
    return;
  }
  await rejoin(call);
}

/** Logout / account switch: drop everything without events. */
export function resetCallSession(): void {
  const a = active();
  if (a?.call.id && a.phase !== 'ended') sendEvent('call:leave', { callId: a.call.id });
  teardown();
  videoOp++;
  if (logRefreshTimer) clearTimeout(logRefreshTimer);
}

registerSessionReset(resetCallSession);

/** Test seam: whether an engine is running. */
export function _hasEngine(): boolean {
  return !!engine;
}
