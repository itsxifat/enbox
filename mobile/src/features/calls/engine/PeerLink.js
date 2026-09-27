/**
 * One RTCPeerConnection to one remote call participant (full mesh), following the
 * normative negotiation rules in @enbox/shared events.ts:
 *
 * - Every connection has BOTH an audio and a video transceiver (`sendrecv`) from the start,
 *   also for audio calls, so camera toggles / screen share are `replaceTrack()` only.
 * - The newcomer is the `offerer`: it adds the transceivers, which fires
 *   `negotiationneeded` → initial offer. Existing participants are `answerer`s: they create
 *   the connection when that offer arrives, flip the offered transceivers to `sendrecv`,
 *   attach their tracks and answer (no negotiation of their own).
 * - Any later renegotiation / ICE restart uses "perfect negotiation": the peer with the
 *   lexicographically SMALLER userId is polite (rolls back on glare), the other ignores
 *   colliding offers.
 * - Incoming signals are applied strictly in order (one promise chain per link).
 * - `iceconnectionstate === 'failed'` → `restartIce()`; a connection stuck in
 *   `disconnected` for DISCONNECT_RESTART_MS also restarts ICE (after `beforeRestart`, which
 *   refreshes time-limited TURN credentials).
 * - An offerer link ignores every remote offer until its first answer arrived: such an offer
 *   can only come from a connection the remote already closed (both sides rejoined at once —
 *   the remote dropped that link on `call:participant-joined` and answers ours instead).
 *   Rolling back for it (polite side) would wedge both links.
 */

/** Restart ICE when a connection stays `disconnected` this long. */
export const DISCONNECT_RESTART_MS = 4_000;

/** Perfect negotiation: the lexicographically smaller user id is the polite peer. */
export function isPolite(selfId, remoteId) {
  return selfId < remoteId;
}

function kindOf(t) {
  return t.receiver?.track?.kind ?? t.sender?.track?.kind ?? undefined;
}

function isStopped(t) {
  return t.currentDirection === 'stopped' || t.direction === 'stopped';
}

export class PeerLink {
  selfId;
  remoteId;
  polite;
  pc;
  remoteStream;

  opts;
  audioTrack;
  videoTrack;
  makingOffer = false;
  ignoreOffer = false;
  closed = false;
  /** Offerer: no answer applied yet (remote offers are stale, see the header). */
  awaitingFirstAnswer;
  restarting = false;
  chain = Promise.resolve();
  disconnectTimer = null;

  constructor(opts) {
    this.opts = opts;
    this.selfId = opts.selfId;
    this.remoteId = opts.remoteId;
    this.polite = isPolite(opts.selfId, opts.remoteId);
    this.audioTrack = opts.audioTrack;
    this.videoTrack = opts.videoTrack;
    this.awaitingFirstAnswer = opts.role === 'offerer';
    this.remoteStream = new MediaStream();

    const config = { iceServers: opts.iceServers, bundlePolicy: 'max-bundle' };
    this.pc = opts.createPeerConnection
      ? opts.createPeerConnection(config)
      : new RTCPeerConnection(config);

    this.pc.onnegotiationneeded = () => void this.negotiate();
    this.pc.onicecandidate = (e) => {
      if (this.closed) return;
      const candidate = e.candidate ? e.candidate.toJSON() : null;
      this.opts.sendSignal({ type: 'candidate', candidate });
    };
    this.pc.ontrack = (e) => this.addRemoteTrack(e.track);
    this.pc.onconnectionstatechange = () => this.onConnectionState();
    this.pc.oniceconnectionstatechange = () => {
      if (!this.closed && this.pc.iceConnectionState === 'failed') this.restartIce();
    };

    if (opts.role === 'offerer') {
      // Adding the transceivers fires `negotiationneeded` → the initial offer.
      this.pc.addTransceiver(this.audioTrack ?? 'audio', { direction: 'sendrecv' });
      this.pc.addTransceiver(this.videoTrack ?? 'video', { direction: 'sendrecv' });
    }
  }

  get connectionState() {
    return this.pc.connectionState;
  }

  get isClosed() {
    return this.closed;
  }

  /** Apply a relayed signal (in arrival order). */
  handleSignal(signal) {
    const run = this.chain.then(() => this.applySignal(signal));
    this.chain = run.catch((err) => this.log(`signal ${signal.type} failed`, err));
    return this.chain;
  }

  /** Send this track instead of the current audio (null = send nothing, e.g. muted). */
  setAudioTrack(track) {
    this.audioTrack = track;
    void this.replace('audio', track);
  }

  /** Camera, screen or nothing. */
  setVideoTrack(track) {
    this.videoTrack = track;
    void this.replace('video', track);
  }

  /** Replace the STUN/TURN servers used from now on (new allocations, ICE restarts). */
  setIceServers(iceServers) {
    if (this.closed) return;
    try {
      this.pc.setConfiguration({ ...this.pc.getConfiguration(), iceServers });
    } catch (err) {
      this.log('setConfiguration failed', err);
    }
  }

  restartIce() {
    if (this.closed || this.restarting) return;
    const run = () => {
      this.restarting = false;
      if (this.closed) return;
      try {
        this.pc.restartIce();
      } catch (err) {
        this.log('restartIce failed', err);
      }
    };
    const hook = this.opts.beforeRestart;
    if (!hook) {
      run();
      return;
    }
    this.restarting = true;
    void hook()
      .catch(() => undefined)
      .then(run);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearDisconnectTimer();
    this.pc.onnegotiationneeded = null;
    this.pc.onicecandidate = null;
    this.pc.ontrack = null;
    this.pc.onconnectionstatechange = null;
    this.pc.oniceconnectionstatechange = null;
    try {
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.remoteStream.getTracks().forEach((t) => t.stop());
  }

  // -------------------------------------------------------------------------

  log(msg, err) {
    (this.opts.log ?? ((m, e) => console.warn(`[call] ${m}`, e ?? '')))(
      `${this.remoteId.slice(0, 8)}: ${msg}`,
      err,
    );
  }

  async negotiate() {
    if (this.closed) return;
    try {
      this.makingOffer = true;
      await this.pc.setLocalDescription();
      const sdp = this.pc.localDescription?.sdp;
      if (sdp && this.pc.localDescription?.type === 'offer' && !this.closed) {
        this.opts.sendSignal({ type: 'offer', sdp });
      }
    } catch (err) {
      this.log('offer failed', err);
    } finally {
      this.makingOffer = false;
    }
  }

  async applySignal(signal) {
    if (this.closed) return;
    if (signal.type === 'candidate') {
      try {
        await this.pc.addIceCandidate(signal.candidate ?? undefined);
      } catch (err) {
        // Candidates of an offer we ignored (glare) are expected to fail.
        if (!this.ignoreOffer) this.log('addIceCandidate failed', err);
      }
      return;
    }

    const offerCollision =
      signal.type === 'offer' && (this.makingOffer || this.pc.signalingState !== 'stable');
    // A stale offer (see the header) is ignored by both polite and impolite peers.
    this.ignoreOffer =
      signal.type === 'offer' && (this.awaitingFirstAnswer || (!this.polite && offerCollision));
    if (this.ignoreOffer) return;
    // A late/duplicate answer (we are not waiting for one) would throw.
    if (signal.type === 'answer' && this.pc.signalingState !== 'have-local-offer') return;

    // Polite peers roll back their own offer implicitly on glare.
    await this.pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    if (signal.type === 'answer') this.awaitingFirstAnswer = false;
    if (signal.type === 'offer') {
      await this.ensureSending();
      await this.pc.setLocalDescription();
      const sdp = this.pc.localDescription?.sdp;
      if (sdp && !this.closed) this.opts.sendSignal({ type: 'answer', sdp });
    }
  }

  /** Answerer: offered transceivers default to recvonly — send on them too. */
  async ensureSending() {
    for (const t of this.pc.getTransceivers()) {
      if (isStopped(t)) continue;
      if (t.direction !== 'sendrecv') t.direction = 'sendrecv';
      const kind = kindOf(t);
      const want = kind === 'audio' ? this.audioTrack : kind === 'video' ? this.videoTrack : null;
      if (t.sender.track !== want) {
        try {
          await t.sender.replaceTrack(want);
        } catch (err) {
          this.log(`replaceTrack(${kind}) failed`, err);
        }
      }
    }
  }

  async replace(kind, track) {
    if (this.closed) return;
    const t = this.pc.getTransceivers().find((x) => kindOf(x) === kind && !isStopped(x));
    if (!t || t.sender.track === track) return;
    try {
      await t.sender.replaceTrack(track);
    } catch (err) {
      this.log(`replaceTrack(${kind}) failed`, err);
    }
  }

  addRemoteTrack(track) {
    for (const old of this.remoteStream.getTracks()) {
      if (old.kind === track.kind && old !== track) this.remoteStream.removeTrack(old);
    }
    if (!this.remoteStream.getTracks().includes(track)) this.remoteStream.addTrack(track);
    this.opts.onRemoteTrack?.(this.remoteStream, track);
  }

  onConnectionState() {
    if (this.closed) return;
    const state = this.pc.connectionState;
    if (state === 'disconnected') {
      this.clearDisconnectTimer();
      this.disconnectTimer = setTimeout(() => {
        if (!this.closed && this.pc.connectionState === 'disconnected') this.restartIce();
      }, DISCONNECT_RESTART_MS);
    } else {
      this.clearDisconnectTimer();
    }
    if (state === 'failed') this.restartIce();
    this.opts.onStateChange?.(state);
  }

  clearDisconnectTimer() {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }
}
