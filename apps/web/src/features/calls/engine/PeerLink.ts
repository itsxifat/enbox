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
 *   `disconnected` for DISCONNECT_RESTART_MS also restarts ICE.
 */
import type { CallSignal, RTCIceCandidateJSON } from '@enbox/shared';

export type LinkRole = 'offerer' | 'answerer';

export interface PeerLinkOptions {
  selfId: string;
  remoteId: string;
  role: LinkRole;
  iceServers: RTCIceServer[];
  audioTrack: MediaStreamTrack | null;
  videoTrack: MediaStreamTrack | null;
  sendSignal: (signal: CallSignal) => void;
  onRemoteTrack?: (stream: MediaStream, track: MediaStreamTrack) => void;
  onStateChange?: (state: RTCPeerConnectionState) => void;
  /** Injected in tests. */
  createPeerConnection?: (config: RTCConfiguration) => RTCPeerConnection;
  log?: (msg: string, err?: unknown) => void;
}

/** Restart ICE when a connection stays `disconnected` this long. */
export const DISCONNECT_RESTART_MS = 4_000;

/** Perfect negotiation: the lexicographically smaller user id is the polite peer. */
export function isPolite(selfId: string, remoteId: string): boolean {
  return selfId < remoteId;
}

function kindOf(t: RTCRtpTransceiver): string | undefined {
  return t.receiver?.track?.kind ?? t.sender?.track?.kind ?? undefined;
}

function isStopped(t: RTCRtpTransceiver): boolean {
  return t.currentDirection === 'stopped' || t.direction === 'stopped';
}

export class PeerLink {
  readonly selfId: string;
  readonly remoteId: string;
  readonly polite: boolean;
  readonly pc: RTCPeerConnection;
  readonly remoteStream: MediaStream;

  private readonly opts: PeerLinkOptions;
  private audioTrack: MediaStreamTrack | null;
  private videoTrack: MediaStreamTrack | null;
  private makingOffer = false;
  private ignoreOffer = false;
  private closed = false;
  private chain: Promise<void> = Promise.resolve();
  private disconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: PeerLinkOptions) {
    this.opts = opts;
    this.selfId = opts.selfId;
    this.remoteId = opts.remoteId;
    this.polite = isPolite(opts.selfId, opts.remoteId);
    this.audioTrack = opts.audioTrack;
    this.videoTrack = opts.videoTrack;
    this.remoteStream = new MediaStream();

    const config: RTCConfiguration = { iceServers: opts.iceServers, bundlePolicy: 'max-bundle' };
    this.pc = opts.createPeerConnection
      ? opts.createPeerConnection(config)
      : new RTCPeerConnection(config);

    this.pc.onnegotiationneeded = () => void this.negotiate();
    this.pc.onicecandidate = (e) => {
      if (this.closed) return;
      const candidate: RTCIceCandidateJSON | null = e.candidate ? e.candidate.toJSON() : null;
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

  get connectionState(): RTCPeerConnectionState {
    return this.pc.connectionState;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Apply a relayed signal (in arrival order). */
  handleSignal(signal: CallSignal): Promise<void> {
    const run = this.chain.then(() => this.applySignal(signal));
    this.chain = run.catch((err) => this.log(`signal ${signal.type} failed`, err));
    return this.chain;
  }

  /** Send this track instead of the current audio (null = send nothing, e.g. muted). */
  setAudioTrack(track: MediaStreamTrack | null): void {
    this.audioTrack = track;
    void this.replace('audio', track);
  }

  /** Camera, screen or nothing. */
  setVideoTrack(track: MediaStreamTrack | null): void {
    this.videoTrack = track;
    void this.replace('video', track);
  }

  restartIce(): void {
    if (this.closed) return;
    try {
      this.pc.restartIce();
    } catch (err) {
      this.log('restartIce failed', err);
    }
  }

  close(): void {
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

  private log(msg: string, err?: unknown): void {
    (this.opts.log ?? ((m: string, e?: unknown) => console.warn(`[call] ${m}`, e ?? '')))(
      `${this.remoteId.slice(0, 8)}: ${msg}`,
      err,
    );
  }

  private async negotiate(): Promise<void> {
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

  private async applySignal(signal: CallSignal): Promise<void> {
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
    this.ignoreOffer = !this.polite && offerCollision;
    if (this.ignoreOffer) return;
    // A late/duplicate answer (we are not waiting for one) would throw.
    if (signal.type === 'answer' && this.pc.signalingState !== 'have-local-offer') return;

    // Polite peers roll back their own offer implicitly on glare.
    await this.pc.setRemoteDescription({ type: signal.type, sdp: signal.sdp });
    if (signal.type === 'offer') {
      await this.ensureSending();
      await this.pc.setLocalDescription();
      const sdp = this.pc.localDescription?.sdp;
      if (sdp && !this.closed) this.opts.sendSignal({ type: 'answer', sdp });
    }
  }

  /** Answerer: offered transceivers default to recvonly — send on them too. */
  private async ensureSending(): Promise<void> {
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

  private async replace(kind: 'audio' | 'video', track: MediaStreamTrack | null): Promise<void> {
    if (this.closed) return;
    const t = this.pc.getTransceivers().find((x) => kindOf(x) === kind && !isStopped(x));
    if (!t || t.sender.track === track) return;
    try {
      await t.sender.replaceTrack(track);
    } catch (err) {
      this.log(`replaceTrack(${kind}) failed`, err);
    }
  }

  private addRemoteTrack(track: MediaStreamTrack): void {
    for (const old of this.remoteStream.getTracks()) {
      if (old.kind === track.kind && old !== track) this.remoteStream.removeTrack(old);
    }
    if (!this.remoteStream.getTracks().includes(track)) this.remoteStream.addTrack(track);
    this.opts.onRemoteTrack?.(this.remoteStream, track);
  }

  private onConnectionState(): void {
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

  private clearDisconnectTimer(): void {
    if (this.disconnectTimer) clearTimeout(this.disconnectTimer);
    this.disconnectTimer = null;
  }
}
