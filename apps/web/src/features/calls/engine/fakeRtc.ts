/**
 * Minimal RTCPeerConnection / MediaStream fakes for unit tests of the call engine (jsdom has
 * no WebRTC). They model the signaling state machine closely enough for perfect negotiation:
 * implicit setLocalDescription (offer/answer), implicit rollback on a colliding remote offer,
 * InvalidStateError for answers in the wrong state, transceivers created from a remote offer.
 */
export class FakeTrack {
  readyState: MediaStreamTrackState = 'live';
  enabled = true;
  muted = false;
  onended: (() => void) | null = null;
  constructor(
    readonly kind: 'audio' | 'video',
    readonly id = `${kind}-${Math.random().toString(36).slice(2, 8)}`,
  ) {}
  stop = () => {
    this.readyState = 'ended';
  };
  getSettings() {
    return { deviceId: `dev-${this.id}` };
  }
  addEventListener() {}
  removeEventListener() {}
}

export class FakeMediaStream {
  private tracks: FakeTrack[];
  constructor(tracks: FakeTrack[] = []) {
    this.tracks = [...tracks];
  }
  getTracks() {
    return [...this.tracks];
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === 'audio');
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === 'video');
  }
  addTrack(t: FakeTrack) {
    this.tracks.push(t);
  }
  removeTrack(t: FakeTrack) {
    this.tracks = this.tracks.filter((x) => x !== t);
  }
  addEventListener() {}
  removeEventListener() {}
}

export class FakeSender {
  track: FakeTrack | null;
  replaced: (FakeTrack | null)[] = [];
  constructor(track: FakeTrack | null) {
    this.track = track;
  }
  replaceTrack = async (t: FakeTrack | null) => {
    this.replaced.push(t);
    this.track = t;
  };
}

export class FakeTransceiver {
  currentDirection: RTCRtpTransceiverDirection | null = null;
  sender: FakeSender;
  receiver: { track: FakeTrack };
  constructor(
    kind: 'audio' | 'video',
    public direction: RTCRtpTransceiverDirection,
    track: FakeTrack | null,
  ) {
    this.sender = new FakeSender(track);
    this.receiver = { track: new FakeTrack(kind) };
  }
}

let sdpSeq = 0;

export class FakePeerConnection {
  static instances: FakePeerConnection[] = [];
  signalingState: RTCSignalingState = 'stable';
  connectionState: RTCPeerConnectionState = 'new';
  iceConnectionState: RTCIceConnectionState = 'new';
  localDescription: { type: RTCSdpType; sdp: string } | null = null;
  remoteDescription: { type: RTCSdpType; sdp: string } | null = null;
  transceivers: FakeTransceiver[] = [];
  candidates: unknown[] = [];
  rollbacks = 0;
  closed = false;
  restartIceCalls = 0;
  onnegotiationneeded: (() => void) | null = null;
  onicecandidate: ((e: { candidate: { toJSON(): unknown } | null }) => void) | null = null;
  ontrack: ((e: { track: FakeTrack; streams: unknown[] }) => void) | null = null;
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  private negotiationQueued = false;

  constructor(readonly config: RTCConfiguration) {
    FakePeerConnection.instances.push(this);
  }

  addTransceiver(
    trackOrKind: FakeTrack | 'audio' | 'video',
    init: { direction: RTCRtpTransceiverDirection },
  ) {
    const kind = typeof trackOrKind === 'string' ? trackOrKind : trackOrKind.kind;
    const t = new FakeTransceiver(
      kind,
      init.direction,
      typeof trackOrKind === 'string' ? null : trackOrKind,
    );
    this.transceivers.push(t);
    this.queueNegotiation();
    return t;
  }

  getTransceivers() {
    return this.transceivers;
  }

  private queueNegotiation() {
    if (this.negotiationQueued) return;
    this.negotiationQueued = true;
    queueMicrotask(() => {
      this.negotiationQueued = false;
      if (!this.closed && this.signalingState === 'stable') this.onnegotiationneeded?.();
    });
  }

  async setLocalDescription() {
    await Promise.resolve();
    if (this.signalingState === 'have-remote-offer') {
      this.localDescription = { type: 'answer', sdp: `answer-${++sdpSeq}` };
      this.signalingState = 'stable';
      for (const t of this.transceivers) t.currentDirection = t.direction;
    } else {
      this.localDescription = { type: 'offer', sdp: `offer-${++sdpSeq}` };
      this.signalingState = 'have-local-offer';
    }
  }

  async setRemoteDescription(desc: { type: RTCSdpType; sdp: string }) {
    await Promise.resolve();
    if (desc.type === 'offer') {
      if (this.signalingState === 'have-local-offer') {
        this.rollbacks++;
        this.signalingState = 'stable';
      } else if (this.signalingState !== 'stable') {
        throw Object.assign(new Error('bad state'), { name: 'InvalidStateError' });
      }
      this.remoteDescription = desc;
      this.signalingState = 'have-remote-offer';
      if (!this.transceivers.length) {
        for (const kind of ['audio', 'video'] as const) {
          const t = new FakeTransceiver(kind, 'recvonly', null);
          this.transceivers.push(t);
          this.ontrack?.({ track: t.receiver.track, streams: [] });
        }
      }
      return;
    }
    if (this.signalingState !== 'have-local-offer') {
      throw Object.assign(new Error('bad state'), { name: 'InvalidStateError' });
    }
    this.remoteDescription = desc;
    this.signalingState = 'stable';
    for (const t of this.transceivers) {
      t.currentDirection = t.direction;
      this.ontrack?.({ track: t.receiver.track, streams: [] });
    }
  }

  async addIceCandidate(c?: unknown) {
    await Promise.resolve();
    if (!this.remoteDescription)
      throw Object.assign(new Error('no remote description'), { name: 'InvalidStateError' });
    this.candidates.push(c ?? null);
  }

  restartIce() {
    this.restartIceCalls++;
    this.queueNegotiation();
  }

  close() {
    this.closed = true;
    this.signalingState = 'closed';
  }

  /** Test helper: emit a local ICE candidate. */
  emitCandidate(candidate: string | null) {
    this.onicecandidate?.({
      candidate:
        candidate === null
          ? null
          : { toJSON: () => ({ candidate, sdpMid: '0', sdpMLineIndex: 0 }) },
    });
  }

  setConnectionState(state: RTCPeerConnectionState) {
    this.connectionState = state;
    this.onconnectionstatechange?.();
  }

  setIceState(state: RTCIceConnectionState) {
    this.iceConnectionState = state;
    this.oniceconnectionstatechange?.();
  }
}

/** Let queued microtasks / promise chains run. */
export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

/** Let everything settle (a macrotask after the microtask queue drained). */
export function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export const asPc = (f: (config: RTCConfiguration) => FakePeerConnection) =>
  f as unknown as (config: RTCConfiguration) => RTCPeerConnection;
export const asTrack = (t: FakeTrack) => t as unknown as MediaStreamTrack;
