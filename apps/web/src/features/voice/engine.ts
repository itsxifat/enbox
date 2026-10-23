/**
 * The voice connection (one at a time): `voice:join` on the socket for a LiveKit token, then a
 * LiveKit `Room` for the media. Remote audio plays through hidden <audio> elements. Mute/deafen
 * come from the user panel (`useVoiceSelf`), camera and screen from the voice view. The server
 * learns my flags through `voice:update`.
 *
 * Media goes through TURN only while the server says `relayOnly` (the media server's ports
 * are not reachable from the internet yet).
 *
 * A moderator can move me (`voice:moved`): the server already moved my voice state and sends
 * a token for the new room, so the engine swaps rooms without asking again. When the media
 * server drops me from a room, the socket says why (moved, disconnected by a moderator…); only
 * without word from it is that a plain disconnect.
 *
 * Stage channels: in the audience (`VoiceState.suppressed`, my own state in the voice store)
 * nothing is published — the mic stays off whatever the user panel says, camera and screen
 * stop. Invited up, the mic goes on without a reconnect (unless I muted myself) once the media
 * server grants it (`ParticipantPermissionsChanged`); when that grant does not come (the
 * server could not reach the media server), one fresh token (`voice:join` again: my role is
 * kept) and a quick reconnect bring it.
 *
 * Go Live (stream/): the room connects without auto-subscribe. Microphones and cameras are
 * subscribed as they are published; a stream (screen and tab audio) only while I watch it
 * (`useStreams().watching`, stream/subscriptions.ts). Viewers tell the room what they watch
 * over data messages (stream/viewers.ts) for the "N watching" counts. My own stream starts at
 * the Screen share quality of Settings (stream/quality.ts).
 *
 * Settings → Voice & Video apply live:
 * - Devices: `switchActiveDevice` for the mic, speaker and camera; tracks made later in the
 *   room use them too (its capture defaults follow the settings).
 * - The browser's noise / echo / gain processing: the mic track restarts with the new
 *   constraints (the published track stays; its source is swapped).
 * - Voice isolation, push to talk and a manual input sensitivity run the mic through the input
 *   processor (processor.ts). It goes on before the mic is first published — push to talk
 *   never leaks a word — and comes off when none of them is on. Push to talk (input/ptt.ts)
 *   opens its gate while the shortcut is held, plus the release delay; a manual sensitivity
 *   opens it while my level stays above the threshold (input/gate.ts, fed by its meter). My
 *   own mute stays LiveKit's. Should the processor not start, a gated mic mutes instead.
 * - Remote audio: each person at their volume × my output volume (userAudio.ts), nothing while
 *   deafened. It plays through Web Audio where that keeps the speaker choice (volumes past
 *   100%), else through the media elements (up to 100%).
 */
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type AudioCaptureOptions,
  type LocalAudioTrack,
  type LocalTrackPublication,
  type Participant,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
  type VideoCaptureOptions,
} from 'livekit-client';
import {
  PERM,
  hasPerm,
  type ChatSummary,
  type IceServerConfig,
  type ID,
  type VoiceDisconnectReason,
  type VoiceJoinResult,
  type VoiceState,
} from '@enbox/shared';
import { outputSelectionSupported } from '@/features/calls/engine/media';
import { voiceIsolationAvailable } from '@/features/calls/voice';
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { API_ORIGIN } from '@/lib/env';
import { playSound } from '@/lib/notify';
import { serverConfig } from '@/lib/serverConfig';
import { emitWithAck, sendEvent } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUi, type DevicePrefs } from '@/stores/ui';
import { useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { toast } from '@/components/ui';
import { GATE_CLOSED, stepGate, type GateState } from './input/gate';
import { useVoiceInputLevel } from './input/level';
import { createPushToTalk, type PushToTalk } from './input/ptt';
import { VoiceInputProcessor } from './processor';
import { screenShareOptions, useStreamQuality } from './stream/quality';
import { useStreams } from './stream/store';
import { isStreaming, syncParticipant, syncPublication } from './stream/subscriptions';
import { STREAM_TOPIC, decodeStreamMessage, encodeStreamMessage } from './stream/viewers';
import { VOLUME_MAX, applyVoiceGains } from './userAudio';

let room: Room | null = null;
/** Set while we end the room ourselves (no "disconnected" toast, no extra leave). */
let leaving = false;
let audioHost: HTMLDivElement | null = null;
/** After the media server removed me: how long to wait for the socket to say why. */
const REMOVED_GRACE_MS = 4_000;
/** Invited up on a Stage: how long the media server's grant may take before a fresh token. */
export const STAGE_GRANT_WAIT_MS = 4_000;
/** LiveKit's protocol `TrackSource.MICROPHONE` (`canPublishSources` holds protocol values). */
const PROTO_MICROPHONE = 2;

/** The grant wait in progress (one per room), resolved by `ParticipantPermissionsChanged`. */
let grantWait: { room: Room; resolve: (granted: boolean) => void; done: Promise<boolean> } | null = null;
/** A fresh token was already tried in this speaker turn (no reconnect loop without a grant). */
let refreshedTurn = false;

/** The input processor on my mic in `room` (none: plain mic, or not published yet). */
let processor: VoiceInputProcessor | null = null;
/** Push to talk, while I am connected with that input mode. */
let ptt: PushToTalk | null = null;
/** The manual-sensitivity gate. */
let vad: GateState = GATE_CLOSED;
/** Remote audio of `room` plays through Web Audio (volumes past 100%). */
let webAudioOut = false;
/**
 * My speaker reached Web Audio's context in `room`: the room picks it for its media elements
 * when created, but its context only exists once connected.
 */
let speakerSet = false;

export function getVoiceRoom(): Room | null {
  return room;
}

export function voiceAvailable(): boolean {
  return !!serverConfig()?.voice;
}

/** Channels people connect to: voice channels and Stages. */
export function isVoiceChat(chat: Pick<ChatSummary, 'type'> | undefined): boolean {
  return chat?.type === 'space_voice' || chat?.type === 'space_stage';
}

function host(): HTMLDivElement {
  if (!audioHost) {
    audioHost = document.createElement('div');
    audioHost.hidden = true;
    audioHost.dataset.voiceAudio = '';
    document.body.appendChild(audioHost);
  }
  return audioHost;
}

function resolveUrl(url: string): string {
  if (/^wss?:\/\//i.test(url)) return url;
  const origin = API_ORIGIN || window.location.origin;
  return origin.replace(/^http/i, 'ws') + url;
}

async function iceServers(): Promise<RTCIceServer[]> {
  const res = await api.get<{ iceServers: IceServerConfig[] }>('/api/calls/ice-servers');
  return res.iceServers as RTCIceServer[];
}

// ---------------------------------------------------------------------------
// Stage role
// ---------------------------------------------------------------------------

/** My voice state in the channel I am connected to (the voice store). */
export function myVoiceState(): VoiceState | undefined {
  const s = useVoice.getState();
  const me = useAuth.getState().user?.id;
  const state = me ? s.byUser[me] : undefined;
  return state && state.channelId === s.connection?.channelId ? state : undefined;
}

/** In a Stage audience: listening only. */
export function inAudience(): boolean {
  return !!myVoiceState()?.suppressed;
}

function connectedChat(): ChatSummary | undefined {
  const c = useVoice.getState().connection;
  return c ? useChats.getState().byId[c.channelId] : undefined;
}

/** The media server lets me publish the microphone. */
function micGranted(r: Room): boolean {
  const p = r.localParticipant.permissions;
  return !!p && p.canPublish && (p.canPublishSources.length === 0 || p.canPublishSources.includes(PROTO_MICROPHONE));
}

/** On a Stage the mic can only be granted with SPEAK there and no moderator mute. */
function stageMicPossible(): boolean {
  const state = myVoiceState();
  return hasPerm(connectedChat()?.spacePermissions, PERM.SPEAK) && !state?.serverMute;
}

/** Wait for the media server to grant the mic (true) or STAGE_GRANT_WAIT_MS to pass (false). */
function waitForMicGrant(r: Room): Promise<boolean> {
  if (micGranted(r)) return Promise.resolve(true);
  if (grantWait?.room === r) return grantWait.done;
  let resolve!: (granted: boolean) => void;
  const done = new Promise<boolean>((res) => (resolve = res));
  const wait = { room: r, resolve, done };
  grantWait = wait;
  const timer = setTimeout(() => resolve(micGranted(r)), STAGE_GRANT_WAIT_MS);
  void done.then(() => {
    clearTimeout(timer);
    if (grantWait === wait) grantWait = null;
  });
  return done;
}

/** Invited up while the grant has not arrived: publish once it does, else get a fresh token. */
async function publishWhenGranted(r: Room): Promise<void> {
  const granted = await waitForMicGrant(r);
  if (room !== r || inAudience()) return;
  if (granted) {
    await applyMic();
    return;
  }
  if (refreshedTurn) return;
  refreshedTurn = true;
  await refreshMediaToken();
}

/** Moved to the audience: stop everything I publish (after any mic change in flight). */
function enterAudience(r: Room): Promise<void> {
  refreshedTurn = false;
  return micOp(async () => {
    await Promise.allSettled([
      r.localParticipant.setMicrophoneEnabled(false),
      r.localParticipant.setCameraEnabled(false),
      r.localParticipant.setScreenShareEnabled(false),
    ]);
    syncFlags();
    useVoice.getState().bumpRoom();
  });
}

// My Stage role (from `voice:state` / join results) drives what is published.
useVoice.subscribe((s, prev) => {
  const r = room;
  const me = useAuth.getState().user?.id;
  if (!r || !me) return;
  const now = s.byUser[me];
  const was = prev.byUser[me];
  if (!now || now.channelId !== s.connection?.channelId || now === was) return;
  if (!!now.suppressed === !!was?.suppressed && now.channelId === was?.channelId) return;
  if (connectedChat()?.type !== 'space_stage') return;
  if (now.suppressed) void enterAudience(r);
  else void applyMic().then(syncFlags);
});

// ---------------------------------------------------------------------------
// Settings → Voice & Video
// ---------------------------------------------------------------------------

/** The browser has its own voice isolation (the `voiceIsolation` constraint). */
function nativeVoiceIsolation(): boolean {
  try {
    const supported = navigator.mediaDevices?.getSupportedConstraints?.() as
      Record<string, boolean | undefined> | undefined;
    return !!supported?.voiceIsolation;
  } catch {
    return false;
  }
}

/** My mic as my settings want it (the room's capture defaults; mic restarts use it too). */
export function voiceCaptureOptions(prefs: DevicePrefs = useUi.getState().prefs): AudioCaptureOptions {
  return {
    deviceId: prefs.audioInputDevice || { ideal: 'default' },
    echoCancellation: prefs.echoCancellation,
    noiseSuppression: prefs.noiseCancellation,
    autoGainControl: prefs.autoGainControl,
    voiceIsolation: prefs.voiceIsolation,
  };
}

function cameraOptions(prefs: DevicePrefs): VideoCaptureOptions {
  return { deviceId: prefs.videoInputDevice || { ideal: 'default' } };
}

/**
 * Remote audio through Web Audio, so volumes can go past 100% — where the speaker can still
 * be chosen that way (`AudioContext.setSinkId`), or cannot be chosen at all.
 */
function webAudioOutput(): boolean {
  if (typeof AudioContext === 'undefined') return false;
  return 'setSinkId' in AudioContext.prototype || !outputSelectionSupported();
}

/** Tracks made later in this room (the mic after a Stage invite, the camera) use my settings. */
function syncCaptureDefaults(r: Room, prefs: DevicePrefs): void {
  Object.assign((r.options.audioCaptureDefaults ??= {}), voiceCaptureOptions(prefs));
  Object.assign((r.options.videoCaptureDefaults ??= {}), cameraOptions(prefs));
}

function isolationWanted(prefs = useUi.getState().prefs): boolean {
  return prefs.voiceIsolation && voiceIsolationAvailable();
}

/** The mic only sends through a gate: push to talk, or a manual input sensitivity. */
function gated(prefs = useUi.getState().prefs): boolean {
  return prefs.voiceInputMode === 'pushToTalk' || !prefs.inputSensitivityAuto;
}

function processingWanted(prefs = useUi.getState().prefs): boolean {
  return isolationWanted(prefs) || gated(prefs);
}

/** The gate lets my voice through now. */
function gateOpen(): boolean {
  const prefs = useUi.getState().prefs;
  if (prefs.voiceInputMode === 'pushToTalk') return !!ptt?.active;
  if (!prefs.inputSensitivityAuto) return vad.open;
  return true;
}

function applyGate(): void {
  if (processor) processor.setGateOpen(gateOpen());
  // No processor (it could not start): a gated mic mutes while the gate is closed.
  else if (room && gated() && micTrack(room)) void applyMic();
}

/** The meter's level: the sensitivity meter in Settings, and the manual-sensitivity gate. */
function onInputLevel(db: number): void {
  useVoiceInputLevel.setState({ db });
  const prefs = useUi.getState().prefs;
  if (prefs.voiceInputMode !== 'voiceActivity' || prefs.inputSensitivityAuto) return;
  const next = stepGate(vad, db, prefs.inputSensitivityDb, performance.now());
  if (next === vad) return;
  const changed = next.open !== vad.open;
  vad = next;
  if (changed) applyGate();
}

/** Push to talk listens while I am connected with that input mode. */
function syncPtt(): void {
  const on = !!room && useUi.getState().prefs.voiceInputMode === 'pushToTalk';
  if (on && !ptt) {
    ptt = createPushToTalk({
      shortcut: () => useUi.getState().prefs.pttShortcut,
      releaseDelayMs: () => useUi.getState().prefs.pttReleaseDelayMs,
      onChange: (active) => {
        useVoiceSelf.setState({ pttActive: active });
        // A key press is a user gesture: a graph waiting for one can start now.
        if (active && processor?.suspended) void processor.resume();
        applyGate();
      },
    });
  } else if (!on && ptt) {
    const p = ptt;
    ptt = null;
    p.dispose();
  }
}

/** A processor that could not start yet (no user gesture) starts on the next click or key. */
function resumeOnGesture(): void {
  const go = () => {
    window.removeEventListener('pointerdown', go, true);
    window.removeEventListener('keydown', go, true);
    void processor?.resume();
  };
  window.addEventListener('pointerdown', go, true);
  window.addEventListener('keydown', go, true);
}

/** Each remote voice at its gain (userAudio.ts). */
function applyVolumes(): void {
  const r = room;
  if (!r) return;
  applyVoiceGains(
    r.remoteParticipants.values(),
    { voice: Track.Source.Microphone, stream: Track.Source.ScreenShareAudio },
    {
      prefs: useUi.getState().prefs,
      deafened: useVoiceSelf.getState().deafened,
      maxGain: webAudioOut ? VOLUME_MAX * VOLUME_MAX : 1,
    },
  );
}

function applyOutputDevice(r: Room): void {
  if (!outputSelectionSupported()) return;
  const id = useUi.getState().prefs.audioOutputDevice || 'default';
  void r.switchActiveDevice('audiooutput', id).catch((err: unknown) => {
    console.warn('Could not switch the speaker', err);
    toast.error('That speaker isn’t available');
  });
}

async function switchMic(r: Room, id: string): Promise<void> {
  try {
    await r.switchActiveDevice('audioinput', id || 'default', !!id);
  } catch {
    toast.error('That microphone isn’t available');
    // The old mic was let go for the new one: back to the default.
    await r.switchActiveDevice('audioinput', 'default', false).catch(() => undefined);
  }
}

async function switchCamera(r: Room, id: string): Promise<void> {
  if (!r.localParticipant.isCameraEnabled) return;
  try {
    await r.switchActiveDevice('videoinput', id || 'default', !!id);
  } catch {
    toast.error('That camera isn’t available');
  }
}

/** The browser's processing changed: the mic restarts with it (the published track stays). */
async function restartMic(r: Room): Promise<void> {
  const track = micTrack(r);
  if (!track) return;
  try {
    await track.restartTrack(voiceCaptureOptions());
  } catch {
    toast.error('Enbox can’t use your microphone. Allow it in the browser to talk.');
  }
}

function processingChanged(a: DevicePrefs, b: DevicePrefs): boolean {
  return (
    a.noiseCancellation !== b.noiseCancellation ||
    a.echoCancellation !== b.echoCancellation ||
    a.autoGainControl !== b.autoGainControl ||
    (a.voiceIsolation !== b.voiceIsolation && nativeVoiceIsolation())
  );
}

// Settings changes reach the room at once.
useUi.subscribe((s, prev) => {
  const r = room;
  const a = s.prefs;
  const b = prev.prefs;
  if (!r || a === b) return;
  syncCaptureDefaults(r, a);
  if (a.audioInputDevice !== b.audioInputDevice) void micOp(() => switchMic(r, a.audioInputDevice));
  else if (processingChanged(a, b)) void micOp(() => restartMic(r));
  if (a.audioOutputDevice !== b.audioOutputDevice) applyOutputDevice(r);
  if (a.videoInputDevice !== b.videoInputDevice) void switchCamera(r, a.videoInputDevice);
  if (a.outputVolume !== b.outputVolume || a.userAudio !== b.userAudio) applyVolumes();
  if (a.voiceInputMode !== b.voiceInputMode) syncPtt();
  if (
    a.voiceIsolation !== b.voiceIsolation ||
    a.voiceInputMode !== b.voiceInputMode ||
    a.inputSensitivityAuto !== b.inputSensitivityAuto
  ) {
    vad = GATE_CLOSED;
    void applyMic();
  }
});

// ---------------------------------------------------------------------------
// Media
// ---------------------------------------------------------------------------

/** One microphone change at a time (publishing, the processor, restarts, the audience). */
let micChain: Promise<unknown> = Promise.resolve();
function micOp<T>(fn: () => Promise<T>): Promise<T> {
  const run = micChain.then(fn, fn);
  micChain = run.catch(() => undefined);
  return run;
}

/** My published microphone track in `r` (none before it was first turned on). */
function micTrack(r: Room): LocalAudioTrack | undefined {
  return r.localParticipant.getTrackPublication(Track.Source.Microphone)?.audioTrack;
}

/** A mic track whose processor would not start (not tried again on it). */
let processorFailed: LocalAudioTrack | null = null;

/**
 * Put the input processor on my mic track in `r`. False when it could not start (plain mic) or
 * `r` ended meanwhile (the track and its processor go with it).
 */
async function attachProcessor(r: Room, track: LocalAudioTrack): Promise<boolean> {
  if (processorFailed === track) return false;
  const p = new VoiceInputProcessor({
    isolation: isolationWanted(),
    open: gateOpen(),
    onLevel: onInputLevel,
  });
  try {
    await track.setProcessor(p);
  } catch (err) {
    console.warn('Voice processing is unavailable; using the plain microphone', err);
    processorFailed = track;
    await p.destroy();
    return false;
  }
  if (room !== r) return false;
  processor = p;
  if (p.suspended) resumeOnGesture();
  return true;
}

async function detachProcessor(track: LocalAudioTrack): Promise<void> {
  processor = null;
  vad = GATE_CLOSED;
  useVoiceInputLevel.setState({ db: null });
  await track.stopProcessor().catch(() => undefined);
}

/** The processor of my published mic matches my settings: on or off, voice isolation, gate. */
async function syncProcessing(r: Room): Promise<void> {
  const track = micTrack(r);
  if (!track || room !== r) return;
  const want = processingWanted();
  if (want && !processor) await attachProcessor(r, track);
  else if (!want && processor) await detachProcessor(track);
  if (room !== r || !processor) return;
  await processor.setIsolation(isolationWanted());
  processor.setGateOpen(gateOpen());
}

/**
 * The first publish of a processed mic: the processor goes on before anything is sent. Should
 * it not start, a gated mic goes out muted while its gate is closed.
 */
async function publishProcessedMic(r: Room): Promise<void> {
  const [track] = (await r.localParticipant.createTracks({ audio: true })) as LocalAudioTrack[];
  if (!track) return;
  try {
    const ok = await attachProcessor(r, track);
    if (room !== r) {
      track.stop();
      return;
    }
    if (!ok && gated() && !gateOpen()) await track.mute();
    await r.localParticipant.publishTrack(track, { source: Track.Source.Microphone });
  } catch (e) {
    track.stop();
    throw e;
  }
}

function applyMic(): Promise<void> {
  return micOp(applyMicNow);
}

async function applyMicNow(): Promise<void> {
  const r = room;
  if (!r) return;
  const { muted, deafened } = useVoiceSelf.getState();
  // A Stage audience never publishes, whatever the user panel says.
  const want = !(muted || deafened) && !inAudience();
  if (want && connectedChat()?.type === 'space_stage' && !micGranted(r)) {
    // Just invited up: the media server's grant follows the invite.
    if (stageMicPossible()) void publishWhenGranted(r);
    return;
  }
  try {
    if (want && !micTrack(r) && processingWanted()) {
      await publishProcessedMic(r);
      return;
    }
    // The processor first: with it the gate is its business; without it (it could not start)
    // a gated mic mutes while the gate is closed.
    await syncProcessing(r);
    if (room !== r) return;
    await r.localParticipant.setMicrophoneEnabled(want && (!!processor || !gated() || gateOpen()));
  } catch {
    toast.error('Enbox can’t use your microphone. Allow it in the browser to talk.');
    if (!useVoiceSelf.getState().muted) useVoiceSelf.getState().toggleMute();
  }
}

function syncFlags(): void {
  const r = room;
  if (!r) return;
  const { muted, deafened } = useVoiceSelf.getState();
  sendEvent('voice:update', {
    selfMute: muted || deafened,
    selfDeaf: deafened,
    selfVideo: r.localParticipant.isCameraEnabled,
    selfStream: r.localParticipant.isScreenShareEnabled,
  });
}

// The user panel's mute / deafen drive the room.
useVoiceSelf.subscribe((s, prev) => {
  if (!room || (s.muted === prev.muted && s.deafened === prev.deafened)) return;
  applyVolumes();
  void applyMic().then(syncFlags);
});

// ---------------------------------------------------------------------------
// Go Live: watch to subscribe, who watches (stream/)
// ---------------------------------------------------------------------------

/** Every remote publication of `r` as wanted (after connecting, after a reconnect). */
function syncSubscriptions(r: Room): void {
  const { watching } = useStreams.getState();
  for (const p of r.remoteParticipants.values()) syncParticipant(p, !!watching[p.identity]);
}

/** Tell the room (or only `to`) which streams I watch. Best effort. */
function sendWatching(r: Room, to?: string[]): void {
  const streams = Object.keys(useStreams.getState().watching);
  void r.localParticipant
    .publishData(encodeStreamMessage({ type: 'watching', streams }), {
      reliable: true,
      topic: STREAM_TOPIC,
      ...(to ? { destinationIdentities: to } : {}),
    })
    .catch(() => undefined);
}

/** Joining a room where someone streams: ask who watches. */
function askViewers(r: Room): void {
  if (![...r.remoteParticipants.values()].some(isStreaming)) return;
  void r.localParticipant
    .publishData(encodeStreamMessage({ type: 'sync' }), { reliable: true, topic: STREAM_TOPIC })
    .catch(() => undefined);
}

function onStreamData(r: Room, payload: Uint8Array, from: RemoteParticipant | undefined, topic: string | undefined): void {
  if (topic !== STREAM_TOPIC || !from || r !== room) return;
  const msg = decodeStreamMessage(payload);
  if (!msg) return;
  if (msg.type === 'watching') useStreams.getState().setViewing(from.identity, msg.streams);
  else if (Object.keys(useStreams.getState().watching).length) sendWatching(r, [from.identity]);
}

// What I watch drives the room's subscriptions; the others hear of it.
useStreams.subscribe((s, prev) => {
  const r = room;
  if (!r || s.watching === prev.watching) return;
  for (const id of new Set([...Object.keys(s.watching), ...Object.keys(prev.watching)])) {
    const on = !!s.watching[id];
    if (on === !!prev.watching[id]) continue;
    const p = r.remoteParticipants.get(id);
    if (p) syncParticipant(p, on);
  }
  sendWatching(r);
  useVoice.getState().bumpRoom();
});

function wire(r: Room): void {
  const bump = () => useVoice.getState().bumpRoom();
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      host().appendChild(track.attach());
      // Web Audio's context exists by now: it takes my speaker too (once per room).
      if (!speakerSet && webAudioOut && useUi.getState().prefs.audioOutputDevice) {
        speakerSet = true;
        applyOutputDevice(r);
      }
    }
    applyVolumes();
    bump();
  });
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    for (const el of track.detach()) el.remove();
    bump();
  });
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) =>
    useVoice.getState().setSpeaking(speakers.map((p) => p.identity)),
  );
  r.on(RoomEvent.ParticipantConnected, () => {
    applyVolumes();
    bump();
  });
  for (const ev of [RoomEvent.TrackMuted, RoomEvent.TrackUnmuted, RoomEvent.LocalTrackPublished] as const)
    r.on(ev, bump);
  // No auto-subscribe: what appears is asked for, a stream only while I watch it.
  r.on(RoomEvent.TrackPublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
    syncPublication(pub, !!useStreams.getState().watching[p.identity]);
    bump();
  });
  r.on(RoomEvent.TrackUnpublished, (pub: RemoteTrackPublication, p: RemoteParticipant) => {
    if (pub.source === Track.Source.ScreenShare) useStreams.getState().streamEnded(p.identity);
    bump();
  });
  r.on(RoomEvent.ParticipantDisconnected, (p?: RemoteParticipant) => {
    if (p) useStreams.getState().participantLeft(p.identity);
    bump();
  });
  r.on(RoomEvent.DataReceived, (payload: Uint8Array, p?: RemoteParticipant, _kind?: unknown, topic?: string) =>
    onStreamData(r, payload, p, topic),
  );
  // Stopping a screen share from the browser's own bar unpublishes it.
  r.on(RoomEvent.LocalTrackUnpublished, (pub?: LocalTrackPublication) => {
    if (pub?.source === Track.Source.ScreenShare) useStreams.getState().streamEnded(r.localParticipant.identity);
    bump();
    syncFlags();
  });
  // A Stage invite's grant (or its removal) reaches the media connection.
  r.on(RoomEvent.ParticipantPermissionsChanged, (_prev: unknown, p: Participant) => {
    if (p !== r.localParticipant) return;
    if (grantWait?.room === r && micGranted(r)) grantWait.resolve(true);
    bump();
  });
  r.on(RoomEvent.AudioPlaybackStatusChanged, () =>
    useVoice.setState({ audioBlocked: !r.canPlaybackAudio }),
  );
  r.on(RoomEvent.Reconnecting, () => setStatus('reconnecting'));
  r.on(RoomEvent.Reconnected, () => {
    setStatus('connected');
    syncSubscriptions(r);
  });
  r.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
    if (r !== room) return;
    cleanup();
    if (leaving) return;
    const c = useVoice.getState().connection;
    if (reason === DisconnectReason.PARTICIPANT_REMOVED && c) {
      // The server dropped me (moved or disconnected by a moderator, another device…): its
      // `voice:moved` / `voice:disconnected` follows. A `voice:leave` now could end the
      // connection it just moved.
      setStatus('reconnecting');
      setTimeout(() => {
        const now = useVoice.getState().connection;
        if (now?.channelId === c.channelId && !room) dropped(reason);
      }, REMOVED_GRACE_MS);
      return;
    }
    dropped(reason);
  });
}

/** The media connection ended without us asking: leave voice. */
function dropped(reason?: DisconnectReason): void {
  sendEvent('voice:leave', {});
  useVoice.getState().setConnection(null);
  if (reason !== DisconnectReason.CLIENT_INITIATED) toast.error('Disconnected from voice');
}

function setStatus(status: 'connecting' | 'connected' | 'reconnecting') {
  const c = useVoice.getState().connection;
  if (c) useVoice.getState().setConnection({ ...c, status });
}

function cleanup(): void {
  room = null;
  // The room stops my tracks, and their processor with them.
  processor = null;
  processorFailed = null;
  speakerSet = false;
  vad = GATE_CLOSED;
  useVoiceInputLevel.setState({ db: null });
  syncPtt();
  if (audioHost) audioHost.replaceChildren();
  grantWait?.resolve(false);
  useStreams.getState().reset();
  useVoice.getState().bumpRoom();
}

async function endRoom(): Promise<void> {
  const r = room;
  if (!r) return;
  leaving = true;
  try {
    await r.disconnect();
  } finally {
    leaving = false;
    if (room === r) cleanup();
  }
}

/** Show my state from a join result at once (the `voice:state` echo may come later). */
function applyMyState(state: VoiceState): void {
  useVoice.getState().applyState({ spaceId: state.spaceId, channelId: state.channelId, userId: state.userId, state });
}

/** Join a voice channel or Stage (moves me if I am in another one). */
export async function connectVoice(chat: ChatSummary): Promise<void> {
  const spaceId = chat.space?.spaceId;
  if (!spaceId || !isVoiceChat(chat)) return;
  const current = useVoice.getState().connection;
  if (current?.channelId === chat.id) return;
  if (!voiceAvailable()) {
    toast.error('Voice channels aren’t switched on for this server yet');
    return;
  }
  await endRoom();
  refreshedTurn = false;
  useVoice.getState().setConnection({ spaceId, channelId: chat.id, status: 'connecting' });
  const { muted, deafened } = useVoiceSelf.getState();
  try {
    const res = await emitWithAck('voice:join', {
      channelId: chat.id,
      selfMute: muted || deafened,
      selfDeaf: deafened,
    });
    await openRoom(res, chat.id);
  } catch (e) {
    await failConnect(chat.id, e);
  }
}

/** Connect the media room of `channelId` with the server's token (`voice:join` / `voice:moved`). */
async function openRoom(res: VoiceJoinResult, channelId: ID, opts: { chime?: boolean } = {}): Promise<void> {
  if (useVoice.getState().connection?.channelId !== channelId) return;
  applyMyState(res.state);
  const prefs = useUi.getState().prefs;
  const ice = await iceServers().catch(() => [] as RTCIceServer[]);
  if (useVoice.getState().connection?.channelId !== channelId) return;
  webAudioOut = webAudioOutput();
  const speaker = prefs.audioOutputDevice && outputSelectionSupported() ? prefs.audioOutputDevice : null;
  const r = new Room({
    adaptiveStream: true,
    dynacast: true,
    webAudioMix: webAudioOut,
    audioCaptureDefaults: voiceCaptureOptions(prefs),
    videoCaptureDefaults: cameraOptions(prefs),
    ...(speaker ? { audioOutput: { deviceId: speaker } } : {}),
    publishDefaults: { dtx: true, red: true },
  });
  wire(r);
  room = r;
  await r.connect(resolveUrl(res.url), res.token, {
    // Streams wait for Watch (stream/subscriptions.ts); the rest is asked for below.
    autoSubscribe: false,
    rtcConfig: { iceServers: ice, iceTransportPolicy: res.relayOnly ? 'relay' : 'all' },
  });
  if (room !== r || useVoice.getState().connection?.channelId !== channelId) {
    await r.disconnect();
    return;
  }
  // Who was here before me: their publications came with the join.
  syncSubscriptions(r);
  askViewers(r);
  if (speaker && webAudioOut) applyOutputDevice(r);
  syncPtt();
  await applyMic();
  applyVolumes();
  useVoice.setState({ audioBlocked: !r.canPlaybackAudio });
  setStatus('connected');
  if (opts.chime !== false) playSound('sent');
}

/** Connecting to `channelId` failed: leave voice (unless I went elsewhere meanwhile). */
async function failConnect(channelId: ID, e: unknown): Promise<void> {
  if (useVoice.getState().connection?.channelId !== channelId) return;
  useVoice.getState().setConnection(null);
  sendEvent('voice:leave', {});
  await endRoom();
  toast.error(e);
}

/**
 * A fresh token for the channel I am in (`voice:join` again keeps my Stage role) and a quick
 * reconnect with it: the grant of a Stage invite the media server never heard about.
 */
async function refreshMediaToken(): Promise<void> {
  const c = useVoice.getState().connection;
  if (!c) return;
  const { muted, deafened } = useVoiceSelf.getState();
  try {
    const res = await emitWithAck('voice:join', { channelId: c.channelId, selfMute: muted || deafened, selfDeaf: deafened });
    if (useVoice.getState().connection?.channelId !== c.channelId) return;
    await endRoom();
    setStatus('connecting');
    await openRoom(res, c.channelId, { chime: false });
  } catch (e) {
    await failConnect(c.channelId, e);
  }
}

/**
 * A moderator moved me to another voice channel (`voice:moved`): the server already moved my
 * voice state, so leave the old room and join the new one with its token (no `voice:join`).
 * The view follows only when I was looking at the old channel.
 */
export async function voiceMovedByServer(from: ID, result: VoiceJoinResult): Promise<void> {
  const c = useVoice.getState().connection;
  if (!c || c.channelId !== from) return;
  const { spaceId, channelId, userId } = result.state;
  const old = `/spaces/${spaceId}/${from}`;
  const path = window.location.pathname;
  const viewing = path === old || path.startsWith(`${old}/`);
  await endRoom();
  refreshedTurn = false;
  useVoice.getState().setConnection({ spaceId, channelId, status: 'connecting' });
  useVoice.getState().applyState({ spaceId, channelId, userId, state: result.state });
  if (viewing) bus.emit('navigate', { to: `/spaces/${spaceId}/${channelId}`, replace: true });
  try {
    await openRoom(result, channelId);
  } catch (e) {
    await failConnect(channelId, e);
  }
}

/** Leave voice (the Disconnect button; on a Stage, "Leave Quietly"). */
export async function disconnectVoice(): Promise<void> {
  if (!useVoice.getState().connection) return;
  sendEvent('voice:leave', {});
  useVoice.getState().setConnection(null);
  await endRoom();
  playSound('end');
}

/** The server ended my connection (another device joined, a moderator, lost access…). */
export async function voiceEndedByServer(channelId: ID, reason: VoiceDisconnectReason): Promise<void> {
  if (useVoice.getState().connection?.channelId !== channelId) return;
  useVoice.getState().setConnection(null);
  await endRoom();
  const text: Record<VoiceDisconnectReason, string> = {
    moved_elsewhere: 'You joined voice on another device',
    disconnected_by_moderator: 'A moderator disconnected you from voice',
    lost_access: 'You no longer have access to that voice channel',
    channel_deleted: 'The voice channel was deleted',
    server_restart: 'Voice was interrupted, join again',
  };
  toast.info(text[reason]);
}

/** After a socket reconnect: tell the server I am still here (the media never dropped). */
export async function reannounceVoice(): Promise<void> {
  const c = useVoice.getState().connection;
  if (!c || !room) return;
  const { muted, deafened } = useVoiceSelf.getState();
  try {
    const res = await emitWithAck('voice:join', { channelId: c.channelId, selfMute: muted || deafened, selfDeaf: deafened });
    // On a Stage the role may have changed meanwhile (back in the audience).
    applyMyState(res.state);
    syncFlags();
  } catch {
    await voiceEndedByServer(c.channelId, 'lost_access');
  }
}

/** Camera and screen are for speakers: a Stage audience is told so. */
function audienceRefuses(): boolean {
  if (!inAudience()) return false;
  toast.info('You’re in the audience. Ask to speak first.');
  return true;
}

export async function toggleCamera(): Promise<void> {
  const r = room;
  if (!r || audienceRefuses()) return;
  try {
    await r.localParticipant.setCameraEnabled(!r.localParticipant.isCameraEnabled);
  } catch {
    toast.error('Enbox can’t use your camera. Allow it in the browser.');
  }
  syncFlags();
  useVoice.getState().bumpRoom();
}

/** Go Live at my Screen share quality (stream/quality.ts), or stop. */
export async function toggleScreenShare(): Promise<void> {
  const r = room;
  if (!r || audienceRefuses()) return;
  try {
    if (r.localParticipant.isScreenShareEnabled) await r.localParticipant.setScreenShareEnabled(false);
    else {
      const { capture, publish } = screenShareOptions(useStreamQuality.getState().quality);
      await r.localParticipant.setScreenShareEnabled(true, capture, publish);
    }
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'NotAllowedError')) toast.error('Screen sharing didn’t start');
  }
  syncFlags();
  useVoice.getState().bumpRoom();
}

/** Start remote audio (and my mic's processing) after the browser blocked it (needs a click). */
export async function resumeVoiceAudio(): Promise<void> {
  await Promise.all([room?.startAudio(), processor?.resume()]);
  useVoice.setState({ audioBlocked: room ? !room.canPlaybackAudio : false });
}
