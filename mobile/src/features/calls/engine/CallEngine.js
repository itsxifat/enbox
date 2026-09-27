/**
 * WebRTC engine of the current call (plain TS, no React/zustand): local media, one
 * PeerLink per remote participant (full mesh), remote audio playback, active-speaker
 * detection. The controller (features/calls/controller.ts) drives it from socket events
 * and mirrors its serializable state into `useCalls`.
 *
 * Media rules (events.ts "Call negotiation"): every link has audio + video transceivers;
 * mute / camera / flip / screen share only `replaceTrack()` on every link.
 */

import { PeerLink } from './PeerLink';
import { AudioLevelMonitor } from './speaking';
import { LOCAL_STREAM, clearCallStreams, setCallStream, touchCallStreams } from './streams';

export class CallEngine {
  selfId;
  iceServers;
  opts;
  links = new Map();
  /** Signals that arrived before the offer that creates the link (normally none). */
  pending = new Map();
  sinks = new Map();
  monitor;
  audioTrack = null;
  cameraTrack = null;
  screenTrack = null;
  muted = false;
  outputDeviceId = null;
  audioBlocked = false;
  closed = false;
  iceRefresh = null;

  constructor(opts) {
    this.opts = opts;
    this.selfId = opts.selfId;
    this.iceServers = opts.iceServers;
    this.monitor =
      opts.monitor ?? new AudioLevelMonitor((s) => opts.events?.onSpeaking?.(s), opts.selfId);
  }

  // -------------------------------------------------------------------------
  // Local media
  // -------------------------------------------------------------------------

  /** The video track peers receive: the screen while sharing, else the camera (or none). */
  get outgoingVideo() {
    return this.screenTrack ?? this.cameraTrack;
  }

  get hasCamera() {
    return !!this.cameraTrack && this.cameraTrack.readyState === 'live';
  }

  currentCameraDeviceId() {
    return this.cameraTrack?.getSettings().deviceId ?? null;
  }

  get isScreenSharing() {
    return !!this.screenTrack;
  }

  get peerIds() {
    return [...this.links.keys()];
  }

  /** Use these servers for new links and apply them to the live ones (ICE restarts). */
  setIceServers(servers) {
    if (this.closed) return;
    this.iceServers = servers;
    for (const link of this.links.values()) link.setIceServers(servers);
  }

  /** Fetch fresh servers (deduped) and apply them; never rejects. */
  refreshIceServers() {
    const fetchServers = this.opts.refreshIceServers;
    if (!fetchServers || this.closed) return Promise.resolve();
    if (!this.iceRefresh) {
      this.iceRefresh = fetchServers()
        .then((servers) => this.setIceServers(servers))
        .catch(() => undefined)
        .finally(() => {
          this.iceRefresh = null;
        });
    }
    return this.iceRefresh;
  }

  /** Microphone track (from getMicrophoneStream). */
  setMicrophone(track) {
    if (this.audioTrack && this.audioTrack !== track) this.audioTrack.stop();
    this.audioTrack = track;
    this.monitor.add(this.selfId, track);
    this.applyAudio();
  }

  setMuted(muted) {
    this.muted = muted;
    this.applyAudio();
  }

  /** Replace the camera track (null = camera off; the old track is stopped). */
  setCamera(track) {
    if (this.cameraTrack && this.cameraTrack !== track) this.cameraTrack.stop();
    this.cameraTrack = track;
    this.applyVideo();
  }

  /** Start (track) or stop (null) sending a screen capture instead of the camera. */
  setScreen(track) {
    const old = this.screenTrack;
    if (old && old !== track) {
      old.onended = null;
      old.stop();
    }
    this.screenTrack = track;
    if (track) {
      track.onended = () => {
        if (this.screenTrack !== track) return;
        this.screenTrack = null;
        this.applyVideo();
        this.opts.events?.onScreenShareEnded?.();
      };
    }
    this.applyVideo();
  }

  applyAudio() {
    const send = this.muted ? null : this.audioTrack;
    for (const link of this.links.values()) link.setAudioTrack(send);
  }

  applyVideo() {
    const video = this.outgoingVideo;
    for (const link of this.links.values()) link.setVideoTrack(video);
    setCallStream(LOCAL_STREAM, video ? new MediaStream([video]) : null);
  }

  // -------------------------------------------------------------------------
  // Peers
  // -------------------------------------------------------------------------

  createLink(userId, role) {
    this.removePeer(userId);
    const link = new PeerLink({
      selfId: this.selfId,
      remoteId: userId,
      role,
      iceServers: this.iceServers,
      audioTrack: this.muted ? null : this.audioTrack,
      videoTrack: this.outgoingVideo,
      sendSignal: (signal) => {
        if (!this.closed && this.links.get(userId) === link) this.opts.sendSignal(userId, signal);
      },
      onRemoteTrack: (stream, track) => {
        if (this.links.get(userId) !== link) return;
        setCallStream(userId, stream);
        touchCallStreams();
        if (track.kind === 'audio') this.attachAudio(userId, track);
      },
      onStateChange: (state) => {
        if (this.links.get(userId) === link) this.opts.events?.onPeerState?.(userId, state);
      },
      beforeRestart: this.opts.refreshIceServers ? () => this.refreshIceServers() : undefined,
      createPeerConnection: this.opts.createPeerConnection,
    });
    this.links.set(userId, link);
    this.opts.events?.onPeerState?.(userId, 'new');
    return link;
  }

  /** Newcomer side: open a connection to a joined participant and offer. */
  connectTo(userId) {
    if (this.closed || userId === this.selfId) return;
    this.pending.delete(userId);
    this.createLink(userId, 'offerer');
  }

  /** A relayed signal. An offer from an unknown peer creates the (answerer) connection. */
  handleSignal(fromUserId, signal) {
    if (this.closed || fromUserId === this.selfId) return;
    let link = this.links.get(fromUserId);
    if (!link || link.isClosed) {
      if (signal.type !== 'offer') {
        // Keep early candidates until the offer arrives (bounded).
        const list = this.pending.get(fromUserId) ?? [];
        if (list.length < 64) list.push(signal);
        this.pending.set(fromUserId, list);
        return;
      }
      const early = this.pending.get(fromUserId) ?? [];
      this.pending.delete(fromUserId);
      link = this.createLink(fromUserId, 'answerer');
      void link.handleSignal(signal);
      for (const s of early) void link.handleSignal(s);
      return;
    }
    void link.handleSignal(signal);
  }

  hasPeer(userId) {
    return this.links.has(userId);
  }

  removePeer(userId) {
    const link = this.links.get(userId);
    this.pending.delete(userId);
    if (!link) return;
    this.links.delete(userId);
    link.close();
    this.detachAudio(userId);
    this.monitor.remove(userId);
    setCallStream(userId, null);
  }

  /** Close every peer connection (e.g. before a rejoin) but keep local media. */
  closePeers() {
    for (const id of [...this.links.keys()]) this.removePeer(id);
  }

  restartIce() {
    for (const link of this.links.values()) link.restartIce();
  }

  // -------------------------------------------------------------------------
  // Remote audio
  // -------------------------------------------------------------------------

  attachAudio(userId, track) {
    let el = this.sinks.get(userId);
    if (!el) {
      el = this.opts.createAudioSink
        ? this.opts.createAudioSink()
        : document.createElement('audio');
      el.autoplay = true;
      el.hidden = true;
      el.dataset.callAudio = userId;
      if (!this.opts.createAudioSink) document.body.appendChild(el);
      this.sinks.set(userId, el);
      if (this.outputDeviceId) void this.applySink(el, this.outputDeviceId);
    }
    el.srcObject = new MediaStream([track]);
    this.monitor.add(userId, track);
    this.play(el);
  }

  play(el) {
    const p = el.play?.();
    if (p && typeof p.then === 'function') {
      p.then(
        () => this.setAudioBlocked(false),
        (err) => {
          if (err?.name === 'NotAllowedError') this.setAudioBlocked(true);
        },
      );
    }
  }

  setAudioBlocked(blocked) {
    if (this.audioBlocked === blocked) return;
    this.audioBlocked = blocked;
    this.opts.events?.onAudioBlocked?.(blocked);
  }

  /** Retry playback after a user gesture ("Tap to enable audio"). */
  resumeAudio() {
    for (const el of this.sinks.values()) this.play(el);
  }

  detachAudio(userId) {
    const el = this.sinks.get(userId);
    if (!el) return;
    this.sinks.delete(userId);
    el.srcObject = null;
    el.remove();
  }

  async applySink(el, deviceId) {
    const withSink = el;
    try {
      await withSink.setSinkId?.(deviceId);
    } catch {
      /* unsupported device */
    }
  }

  /** Route remote audio to an output device (speaker / headset) when supported. */
  async setOutputDevice(deviceId) {
    this.outputDeviceId = deviceId;
    await Promise.all([...this.sinks.values()].map((el) => this.applySink(el, deviceId)));
  }

  // -------------------------------------------------------------------------

  /** Hang up locally: close connections, stop capture, forget streams. */
  close() {
    if (this.closed) return;
    this.closed = true;
    for (const id of [...this.links.keys()]) this.removePeer(id);
    for (const id of [...this.sinks.keys()]) this.detachAudio(id);
    this.monitor.stop();
    this.audioTrack?.stop();
    this.cameraTrack?.stop();
    if (this.screenTrack) {
      this.screenTrack.onended = null;
      this.screenTrack.stop();
    }
    this.audioTrack = this.cameraTrack = this.screenTrack = null;
    clearCallStreams();
  }

  get isClosed() {
    return this.closed;
  }
}
