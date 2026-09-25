import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSignal } from '@enbox/shared';
import { PeerLink, isPolite, type LinkRole } from './PeerLink';
import { FakeMediaStream, FakePeerConnection, FakeTrack, asPc, asTrack, flush } from './fakeRtc';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';

function makeLink(opts: {
  self?: string;
  remote?: string;
  role: LinkRole;
  audio?: FakeTrack | null;
  video?: FakeTrack | null;
  beforeRestart?: () => Promise<unknown>;
}) {
  const sent: CallSignal[] = [];
  const states: RTCPeerConnectionState[] = [];
  const remoteTracks: string[] = [];
  let pc!: FakePeerConnection;
  const link = new PeerLink({
    selfId: opts.self ?? A,
    remoteId: opts.remote ?? B,
    role: opts.role,
    iceServers: [{ urls: 'stun:example.org' }],
    audioTrack:
      opts.audio === undefined
        ? asTrack(new FakeTrack('audio'))
        : opts.audio && asTrack(opts.audio),
    videoTrack: opts.video ? asTrack(opts.video) : null,
    sendSignal: (s) => sent.push(s),
    beforeRestart: opts.beforeRestart,
    onStateChange: (s) => states.push(s),
    onRemoteTrack: (_stream, track) => remoteTracks.push(track.kind),
    createPeerConnection: asPc((config) => (pc = new FakePeerConnection(config))),
    log: () => undefined,
  });
  return { link, sent, states, remoteTracks, pc: () => pc };
}

beforeEach(() => {
  vi.stubGlobal('MediaStream', FakeMediaStream);
  FakePeerConnection.instances = [];
});
afterEach(() => {
  vi.useRealTimers();
});

describe('isPolite', () => {
  it('makes the lexicographically smaller id polite', () => {
    expect(isPolite(A, B)).toBe(true);
    expect(isPolite(B, A)).toBe(false);
  });
});

describe('PeerLink (offerer / newcomer)', () => {
  it('adds audio + video sendrecv transceivers and sends the initial offer', async () => {
    const audio = new FakeTrack('audio');
    const { sent, pc } = makeLink({ role: 'offerer', audio, video: null });
    await flush();
    const ts = pc().transceivers;
    expect(ts.map((t) => [t.receiver.track.kind, t.direction])).toEqual([
      ['audio', 'sendrecv'],
      ['video', 'sendrecv'],
    ]);
    expect(ts[0]!.sender.track).toBe(audio);
    expect(ts[1]!.sender.track).toBeNull();
    expect(sent).toEqual([{ type: 'offer', sdp: expect.stringMatching(/^offer-/) }]);
    expect(pc().config.iceServers).toEqual([{ urls: 'stun:example.org' }]);
  });

  it('applies the answer and reports remote tracks', async () => {
    const { link, remoteTracks, pc } = makeLink({ role: 'offerer' });
    await flush();
    await link.handleSignal({ type: 'answer', sdp: 'answer-x' });
    expect(pc().signalingState).toBe('stable');
    expect(remoteTracks.sort()).toEqual(['audio', 'video']);
  });

  it('ignores a stale answer instead of throwing', async () => {
    const { link, pc } = makeLink({ role: 'offerer' });
    await flush();
    await link.handleSignal({ type: 'answer', sdp: 'a1' });
    await link.handleSignal({ type: 'answer', sdp: 'a2' });
    expect(pc().remoteDescription?.sdp).toBe('a1');
  });

  it('relays local ICE candidates (and end-of-candidates)', async () => {
    const { sent, pc } = makeLink({ role: 'offerer' });
    await flush();
    pc().emitCandidate('candidate:1 1 udp 1 10.0.0.1 5000 typ host');
    pc().emitCandidate(null);
    expect(sent.slice(1)).toEqual([
      {
        type: 'candidate',
        candidate: {
          candidate: 'candidate:1 1 udp 1 10.0.0.1 5000 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
        },
      },
      { type: 'candidate', candidate: null },
    ]);
  });
});

describe('PeerLink (answerer / existing participant)', () => {
  it('answers an offer, sending on the offered transceivers with local tracks', async () => {
    const audio = new FakeTrack('audio');
    const video = new FakeTrack('video');
    const { link, sent, pc } = makeLink({ role: 'answerer', audio, video });
    await flush();
    expect(sent).toEqual([]); // no offer of its own
    await link.handleSignal({ type: 'offer', sdp: 'offer-remote' });
    expect(sent).toEqual([{ type: 'answer', sdp: expect.stringMatching(/^answer-/) }]);
    const ts = pc().transceivers;
    expect(ts.map((t) => t.direction)).toEqual(['sendrecv', 'sendrecv']);
    expect(ts[0]!.sender.track).toBe(audio);
    expect(ts[1]!.sender.track).toBe(video);
  });

  it('applies candidates strictly after the offer (ordered chain)', async () => {
    const { link, pc } = makeLink({ role: 'answerer' });
    void link.handleSignal({ type: 'offer', sdp: 'o' });
    await link.handleSignal({
      type: 'candidate',
      candidate: { candidate: 'c1', sdpMid: '0', sdpMLineIndex: 0 },
    });
    expect(pc().candidates).toEqual([{ candidate: 'c1', sdpMid: '0', sdpMLineIndex: 0 }]);
  });
});

/** An offerer link past its initial offer/answer, renegotiating (ICE restart) now. */
async function renegotiating(self: string, remote: string) {
  const l = makeLink({ self, remote, role: 'offerer' });
  await flush();
  await l.link.handleSignal({ type: 'answer', sdp: 'first-answer' });
  l.link.restartIce();
  await flush();
  expect(l.pc().signalingState).toBe('have-local-offer');
  return l;
}

describe('perfect negotiation (glare)', () => {
  it('the polite peer rolls back its own offer and answers', async () => {
    // A < B → A is polite.
    const { link, sent, pc } = await renegotiating(A, B);
    await link.handleSignal({ type: 'offer', sdp: 'their-offer' });
    expect(pc().rollbacks).toBe(1);
    expect(sent.at(-1)).toEqual({ type: 'answer', sdp: expect.any(String) });
  });

  it('the impolite peer ignores a colliding offer and its candidates', async () => {
    const { link, sent, pc } = await renegotiating(B, A);
    const before = sent.length;
    await link.handleSignal({ type: 'offer', sdp: 'their-offer' });
    await link.handleSignal({ type: 'candidate', candidate: { candidate: 'x' } });
    expect(pc().rollbacks).toBe(0);
    expect(pc().signalingState).toBe('have-local-offer');
    expect(sent.length).toBe(before);
  });

  it.each([
    ['polite', A, B],
    ['impolite', B, A],
  ])(
    'a %s newcomer ignores a stale offer before its first answer (both rejoined at once)',
    async (_label, self, remote) => {
      // The remote closed the link that sent this offer (call:participant-joined) and answers
      // our offer on a fresh one instead.
      const { link, sent, pc } = makeLink({ self, remote, role: 'offerer' });
      await flush();
      const before = sent.length;
      await link.handleSignal({ type: 'offer', sdp: 'stale-offer' });
      await link.handleSignal({ type: 'candidate', candidate: { candidate: 'stale' } });
      expect(pc().rollbacks).toBe(0);
      expect(sent.length).toBe(before); // no answer to the dead connection
      await link.handleSignal({ type: 'answer', sdp: 'real-answer' });
      expect(pc().signalingState).toBe('stable');
      expect(pc().remoteDescription?.sdp).toBe('real-answer');
    },
  );
});

describe('media & recovery', () => {
  it('replaceTrack() on the right sender for mute/camera, without renegotiation', async () => {
    const { link, sent, pc } = makeLink({ role: 'offerer' });
    await flush();
    await link.handleSignal({ type: 'answer', sdp: 'a' });
    const cam = new FakeTrack('video');
    link.setAudioTrack(null);
    link.setVideoTrack(asTrack(cam));
    await flush();
    const [audioT, videoT] = pc().transceivers;
    expect(audioT!.sender.track).toBeNull();
    expect(videoT!.sender.track).toBe(cam);
    expect(sent.filter((s) => s.type === 'offer')).toHaveLength(1);
  });

  it('restarts ICE when ICE fails or stays disconnected', async () => {
    vi.useFakeTimers();
    const { link, states, pc } = makeLink({ role: 'offerer' });
    await vi.advanceTimersByTimeAsync(0);
    pc().setIceState('failed');
    expect(pc().restartIceCalls).toBe(1);
    pc().setConnectionState('disconnected');
    expect(states).toEqual(['disconnected']);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(pc().restartIceCalls).toBe(2);
    link.close();
    expect(pc().closed).toBe(true);
  });

  it('refreshes ICE servers before restarting ICE', async () => {
    let release!: () => void;
    const refreshed = new Promise<void>((r) => (release = r));
    const beforeRestart = vi.fn(() => refreshed);
    const { link, pc } = makeLink({ role: 'offerer', beforeRestart });
    await flush();
    pc().setIceState('failed');
    pc().setIceState('failed'); // a second trigger while refreshing is coalesced
    expect(beforeRestart).toHaveBeenCalledTimes(1);
    expect(pc().restartIceCalls).toBe(0);
    link.setIceServers([{ urls: 'turn:fresh.example', username: 'u', credential: 'c' }]);
    release();
    await flush();
    expect(pc().restartIceCalls).toBe(1);
    expect(pc().config.iceServers).toEqual([
      { urls: 'turn:fresh.example', username: 'u', credential: 'c' },
    ]);
    expect(pc().config.bundlePolicy).toBe('max-bundle');
  });

  it('stops emitting after close', async () => {
    const { link, sent, pc } = makeLink({ role: 'offerer' });
    await flush();
    link.close();
    pc().emitCandidate('late');
    await link.handleSignal({ type: 'offer', sdp: 'x' });
    expect(sent.filter((s) => s.type === 'candidate')).toHaveLength(0);
  });
});
