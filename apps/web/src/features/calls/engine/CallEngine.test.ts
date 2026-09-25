import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CallSignal } from '@enbox/shared';
import { CallEngine } from './CallEngine';
import {
  FakeMediaStream,
  FakePeerConnection,
  FakeTrack,
  asPc,
  asTrack,
  flush,
  settle,
} from './fakeRtc';
import { LOCAL_STREAM, getCallStream } from './streams';

const ME = '00000000-0000-4000-8000-000000000001';
const P1 = '00000000-0000-4000-8000-000000000002';
const P2 = '00000000-0000-4000-8000-000000000003';

function setup() {
  const sent: { to: string; signal: CallSignal }[] = [];
  const states: [string, string][] = [];
  const sinks: {
    play: ReturnType<typeof vi.fn>;
    srcObject: unknown;
    remove: ReturnType<typeof vi.fn>;
    dataset: Record<string, string>;
  }[] = [];
  const monitor = { add: vi.fn(), remove: vi.fn(), stop: vi.fn() };
  const blocked: boolean[] = [];
  const engine = new CallEngine({
    selfId: ME,
    iceServers: [],
    sendSignal: (to, signal) => sent.push({ to, signal }),
    events: {
      onPeerState: (id, s) => states.push([id, s]),
      onAudioBlocked: (b) => blocked.push(b),
    },
    createPeerConnection: asPc((c) => new FakePeerConnection(c)),
    createAudioSink: () => {
      const el = {
        play: vi.fn(() => Promise.resolve()),
        srcObject: null as unknown,
        remove: vi.fn(),
        dataset: {},
        autoplay: false,
        hidden: false,
      };
      sinks.push(el);
      return el as unknown as HTMLAudioElement;
    },
    monitor,
  });
  return { engine, sent, states, sinks, monitor, blocked };
}

beforeEach(() => {
  vi.stubGlobal('MediaStream', FakeMediaStream);
  FakePeerConnection.instances = [];
});

describe('CallEngine', () => {
  it('newcomer: offers to each joined participant through sendSignal', async () => {
    const { engine, sent, states } = setup();
    engine.setMicrophone(asTrack(new FakeTrack('audio')));
    engine.connectTo(P1);
    engine.connectTo(P2);
    engine.connectTo(ME); // never to myself
    await flush();
    expect(sent.map((s) => [s.to, s.signal.type])).toEqual([
      [P1, 'offer'],
      [P2, 'offer'],
    ]);
    expect(states).toEqual([
      [P1, 'new'],
      [P2, 'new'],
    ]);
    expect(engine.peerIds).toEqual([P1, P2]);
  });

  it('existing participant: an offer from an unknown peer creates the connection (early candidates buffered)', async () => {
    const { engine, sent, sinks, monitor } = setup();
    engine.setMicrophone(asTrack(new FakeTrack('audio')));
    engine.handleSignal(P1, { type: 'candidate', candidate: { candidate: 'early' } });
    expect(engine.hasPeer(P1)).toBe(false);
    engine.handleSignal(P1, { type: 'offer', sdp: 'o' });
    await settle();
    expect(engine.hasPeer(P1)).toBe(true);
    expect(sent).toEqual([{ to: P1, signal: { type: 'answer', sdp: expect.any(String) } }]);
    const pc = FakePeerConnection.instances[0]!;
    expect(pc.candidates).toEqual([{ candidate: 'early' }]);
    // Remote audio is played through a sink and monitored for speaking.
    expect(sinks).toHaveLength(1);
    expect(sinks[0]!.play).toHaveBeenCalled();
    expect(monitor.add).toHaveBeenCalledWith(P1, expect.anything());
    expect(getCallStream(P1)).not.toBeNull();
  });

  it('mute / camera / screen share replace tracks on every connection', async () => {
    const { engine } = setup();
    const mic = new FakeTrack('audio');
    engine.setMicrophone(asTrack(mic));
    engine.connectTo(P1);
    engine.connectTo(P2);
    await flush();
    engine.setMuted(true);
    const cam = new FakeTrack('video');
    engine.setCamera(asTrack(cam));
    await flush();
    for (const pc of FakePeerConnection.instances) {
      expect(pc.transceivers[0]!.sender.track).toBeNull();
      expect(pc.transceivers[1]!.sender.track).toBe(cam);
    }
    expect(getCallStream(LOCAL_STREAM)?.getVideoTracks()).toEqual([cam]);

    const screen = new FakeTrack('video');
    engine.setScreen(asTrack(screen));
    await flush();
    expect(FakePeerConnection.instances[0]!.transceivers[1]!.sender.track).toBe(screen);
    // The browser's "Stop sharing" restores the camera.
    screen.onended?.();
    await flush();
    expect(FakePeerConnection.instances[0]!.transceivers[1]!.sender.track).toBe(cam);
    expect(engine.isScreenSharing).toBe(false);

    engine.setMuted(false);
    engine.setCamera(null);
    await flush();
    expect(cam.readyState).toBe('ended');
    expect(FakePeerConnection.instances[1]!.transceivers[0]!.sender.track).toBe(mic);
    expect(FakePeerConnection.instances[1]!.transceivers[1]!.sender.track).toBeNull();
  });

  it('new connections start with the current media state', async () => {
    const { engine } = setup();
    engine.setMicrophone(asTrack(new FakeTrack('audio')));
    engine.setMuted(true);
    const cam = new FakeTrack('video');
    engine.setCamera(asTrack(cam));
    engine.connectTo(P1);
    await flush();
    const pc = FakePeerConnection.instances[0]!;
    expect(pc.transceivers[0]!.sender.track).toBeNull();
    expect(pc.transceivers[1]!.sender.track).toBe(cam);
  });

  it('a rejoining peer gets a fresh connection; removePeer closes it', async () => {
    const { engine, sinks } = setup();
    engine.handleSignal(P1, { type: 'offer', sdp: 'o1' });
    await settle();
    const first = FakePeerConnection.instances[0]!;
    engine.removePeer(P1);
    expect(first.closed).toBe(true);
    expect(sinks[0]!.remove).toHaveBeenCalled();
    expect(getCallStream(P1)).toBeNull();
    engine.handleSignal(P1, { type: 'offer', sdp: 'o2' });
    await settle();
    expect(FakePeerConnection.instances).toHaveLength(2);
  });

  it('reports blocked autoplay and retries on resumeAudio()', async () => {
    const { engine, sinks, blocked } = setup();
    engine.handleSignal(P1, { type: 'offer', sdp: 'o' });
    await settle();
    sinks[0]!.play.mockImplementationOnce(() =>
      Promise.reject(Object.assign(new Error('no'), { name: 'NotAllowedError' })),
    );
    engine.resumeAudio();
    await flush();
    expect(blocked).toEqual([true]);
    engine.resumeAudio();
    await flush();
    expect(blocked).toEqual([true, false]);
  });

  it('close() stops local capture, closes connections and ignores later signals', async () => {
    const { engine, monitor } = setup();
    const mic = new FakeTrack('audio');
    const cam = new FakeTrack('video');
    engine.setMicrophone(asTrack(mic));
    engine.setCamera(asTrack(cam));
    engine.connectTo(P1);
    await flush();
    engine.close();
    expect(mic.readyState).toBe('ended');
    expect(cam.readyState).toBe('ended');
    expect(FakePeerConnection.instances[0]!.closed).toBe(true);
    expect(monitor.stop).toHaveBeenCalled();
    engine.handleSignal(P2, { type: 'offer', sdp: 'x' });
    expect(engine.hasPeer(P2)).toBe(false);
    expect(getCallStream(LOCAL_STREAM)).toBeNull();
  });
});
