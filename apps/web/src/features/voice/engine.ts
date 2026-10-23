/**
 * The voice connection (one at a time): `voice:join` on the socket for a LiveKit token, then a
 * LiveKit `Room` for the media. Remote audio plays through hidden <audio> elements; deafen
 * mutes them and the mic. Mute/deafen come from the user panel (`useVoiceSelf`), camera and
 * screen from the voice view. The server learns my flags through `voice:update`.
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
 */
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
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
import { api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { API_ORIGIN } from '@/lib/env';
import { playSound } from '@/lib/notify';
import { serverConfig } from '@/lib/serverConfig';
import { emitWithAck, sendEvent } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useChats } from '@/stores/chats';
import { useUi } from '@/stores/ui';
import { useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { toast } from '@/components/ui';

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

/** Moved to the audience: stop everything I publish. */
async function enterAudience(r: Room): Promise<void> {
  refreshedTurn = false;
  await Promise.allSettled([
    r.localParticipant.setMicrophoneEnabled(false),
    r.localParticipant.setCameraEnabled(false),
    r.localParticipant.setScreenShareEnabled(false),
  ]);
  syncFlags();
  useVoice.getState().bumpRoom();
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
// Media
// ---------------------------------------------------------------------------

function applyAudioOut(): void {
  const deaf = useVoiceSelf.getState().deafened;
  for (const el of host().querySelectorAll('audio')) el.muted = deaf;
}

async function applyMic(): Promise<void> {
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
    await r.localParticipant.setMicrophoneEnabled(want);
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
  applyAudioOut();
  void applyMic().then(syncFlags);
});

function wire(r: Room): void {
  const bump = () => useVoice.getState().bumpRoom();
  r.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
    if (track.kind === Track.Kind.Audio) {
      const el = track.attach();
      el.muted = useVoiceSelf.getState().deafened;
      host().appendChild(el);
    }
    bump();
  });
  r.on(RoomEvent.TrackUnsubscribed, (track: RemoteTrack) => {
    for (const el of track.detach()) el.remove();
    bump();
  });
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers: Participant[]) =>
    useVoice.getState().setSpeaking(speakers.map((p) => p.identity)),
  );
  for (const ev of [
    RoomEvent.ParticipantConnected,
    RoomEvent.ParticipantDisconnected,
    RoomEvent.TrackMuted,
    RoomEvent.TrackUnmuted,
    RoomEvent.TrackPublished,
    RoomEvent.TrackUnpublished,
    RoomEvent.LocalTrackPublished,
  ] as const)
    r.on(ev, bump);
  // Stopping a screen share from the browser's own bar unpublishes it.
  r.on(RoomEvent.LocalTrackUnpublished, () => {
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
  r.on(RoomEvent.Reconnected, () => setStatus('connected'));
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
  if (audioHost) audioHost.replaceChildren();
  grantWait?.resolve(false);
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
  const r = new Room({
    adaptiveStream: true,
    dynacast: true,
    audioCaptureDefaults: {
      noiseSuppression: prefs.noiseCancellation,
      echoCancellation: prefs.echoCancellation,
      autoGainControl: prefs.autoGainControl,
    },
    publishDefaults: { dtx: true, red: true },
  });
  wire(r);
  room = r;
  await r.connect(resolveUrl(res.url), res.token, {
    rtcConfig: { iceServers: ice, iceTransportPolicy: res.relayOnly ? 'relay' : 'all' },
  });
  if (room !== r || useVoice.getState().connection?.channelId !== channelId) {
    await r.disconnect();
    return;
  }
  await applyMic();
  applyAudioOut();
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

export async function toggleScreenShare(): Promise<void> {
  const r = room;
  if (!r || audienceRefuses()) return;
  try {
    await r.localParticipant.setScreenShareEnabled(!r.localParticipant.isScreenShareEnabled, { audio: true });
  } catch (e) {
    if (!(e instanceof DOMException && e.name === 'NotAllowedError')) toast.error('Screen sharing didn’t start');
  }
  syncFlags();
  useVoice.getState().bumpRoom();
}

/** Start remote audio after the browser blocked autoplay (needs a click). */
export async function resumeVoiceAudio(): Promise<void> {
  await room?.startAudio();
  useVoice.setState({ audioBlocked: room ? !room.canPlaybackAudio : false });
}
