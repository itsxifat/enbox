/**
 * The voice connection (one at a time): `voice:join` on the socket for a LiveKit token, then a
 * LiveKit `Room` for the media. Remote audio plays through hidden <audio> elements; deafen
 * mutes them and the mic. Mute/deafen come from the user panel (`useVoiceSelf`), camera and
 * screen from the voice view. The server learns my flags through `voice:update`.
 *
 * Media goes through TURN only while the server says `relayOnly` (the media server's ports
 * are not reachable from the internet yet).
 */
import {
  DisconnectReason,
  Room,
  RoomEvent,
  Track,
  type Participant,
  type RemoteTrack,
} from 'livekit-client';
import type { ChatSummary, IceServerConfig, ID, VoiceDisconnectReason } from '@enbox/shared';
import { api } from '@/lib/api';
import { API_ORIGIN } from '@/lib/env';
import { playSound } from '@/lib/notify';
import { serverConfig } from '@/lib/serverConfig';
import { emitWithAck, sendEvent } from '@/lib/socket';
import { useUi } from '@/stores/ui';
import { useVoice } from '@/stores/voice';
import { useVoiceSelf } from '@/stores/voiceSelf';
import { toast } from '@/components/ui';

let room: Room | null = null;
/** Set while we end the room ourselves (no "disconnected" toast, no extra leave). */
let leaving = false;
let audioHost: HTMLDivElement | null = null;

export function getVoiceRoom(): Room | null {
  return room;
}

export function voiceAvailable(): boolean {
  return !!serverConfig()?.voice;
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

function applyAudioOut(): void {
  const deaf = useVoiceSelf.getState().deafened;
  for (const el of host().querySelectorAll('audio')) el.muted = deaf;
}

async function applyMic(): Promise<void> {
  const r = room;
  if (!r) return;
  const { muted, deafened } = useVoiceSelf.getState();
  try {
    await r.localParticipant.setMicrophoneEnabled(!(muted || deafened));
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
  r.on(RoomEvent.AudioPlaybackStatusChanged, () =>
    useVoice.setState({ audioBlocked: !r.canPlaybackAudio }),
  );
  r.on(RoomEvent.Reconnecting, () => setStatus('reconnecting'));
  r.on(RoomEvent.Reconnected, () => setStatus('connected'));
  r.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
    if (r !== room) return;
    cleanup();
    if (leaving) return;
    sendEvent('voice:leave', {});
    useVoice.getState().setConnection(null);
    if (reason !== DisconnectReason.CLIENT_INITIATED) toast.error('Disconnected from voice');
  });
}

function setStatus(status: 'connecting' | 'connected' | 'reconnecting') {
  const c = useVoice.getState().connection;
  if (c) useVoice.getState().setConnection({ ...c, status });
}

function cleanup(): void {
  room = null;
  if (audioHost) audioHost.replaceChildren();
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

/** Join a voice channel (moves me if I am in another one). */
export async function connectVoice(chat: ChatSummary): Promise<void> {
  const spaceId = chat.space?.spaceId;
  if (!spaceId || chat.type !== 'space_voice') return;
  const current = useVoice.getState().connection;
  if (current?.channelId === chat.id) return;
  if (!voiceAvailable()) {
    toast.error('Voice channels aren’t switched on for this server yet');
    return;
  }
  await endRoom();
  useVoice.getState().setConnection({ spaceId, channelId: chat.id, status: 'connecting' });
  const { muted, deafened } = useVoiceSelf.getState();
  const prefs = useUi.getState().prefs;
  try {
    const res = await emitWithAck('voice:join', {
      channelId: chat.id,
      selfMute: muted || deafened,
      selfDeaf: deafened,
    });
    const ice = await iceServers().catch(() => [] as RTCIceServer[]);
    if (useVoice.getState().connection?.channelId !== chat.id) return;
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
    if (room !== r || useVoice.getState().connection?.channelId !== chat.id) {
      await r.disconnect();
      return;
    }
    await applyMic();
    applyAudioOut();
    useVoice.setState({ audioBlocked: !r.canPlaybackAudio });
    setStatus('connected');
    playSound('sent');
  } catch (e) {
    if (useVoice.getState().connection?.channelId === chat.id) {
      useVoice.getState().setConnection(null);
      sendEvent('voice:leave', {});
      await endRoom();
      toast.error(e);
    }
  }
}

/** Leave voice (the Disconnect button). */
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
    await emitWithAck('voice:join', { channelId: c.channelId, selfMute: muted || deafened, selfDeaf: deafened });
    syncFlags();
  } catch {
    await voiceEndedByServer(c.channelId, 'lost_access');
  }
}

export async function toggleCamera(): Promise<void> {
  const r = room;
  if (!r) return;
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
  if (!r) return;
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
