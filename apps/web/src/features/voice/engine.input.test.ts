/**
 * The voice engine and Settings → Voice & Video (LiveKit and the input processor faked):
 * - push to talk: the mic is published with the processor already on and its gate closed,
 *   the shortcut opens it, letting go closes it after the release delay, typing does not;
 * - a manual sensitivity gates on the processor's levels, with the hold;
 * - switching back to voice activity takes the processor off;
 * - device and processing changes reach the mic at once;
 * - remote voices: per-person volume × output volume, muted for me, deafened.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, VoiceJoinResult, VoiceState } from '@enbox/shared';
import type * as ApiModule from '@/lib/api';
import type * as SocketModule from '@/lib/socket';
import type { KeyCombo } from '@/stores/ui';

interface FakeProcessor {
  opts: { isolation: boolean; open: boolean; onLevel?: (db: number) => void };
  gate: boolean[];
  suspended: boolean;
}
interface FakeTrack {
  setProcessor: ReturnType<typeof vi.fn>;
  stopProcessor: ReturnType<typeof vi.fn>;
  restartTrack: ReturnType<typeof vi.fn>;
  mute: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}
interface FakeParticipant {
  identity: string;
  setVolume: ReturnType<typeof vi.fn>;
}
interface FakeRoom {
  options: {
    audioCaptureDefaults: Record<string, unknown>;
    videoCaptureDefaults: Record<string, unknown>;
  };
  remoteParticipants: Map<string, FakeParticipant>;
  switchActiveDevice: ReturnType<typeof vi.fn>;
  localParticipant: {
    published?: FakeTrack;
    createTracks: ReturnType<typeof vi.fn>;
    publishTrack: ReturnType<typeof vi.fn>;
    setMicrophoneEnabled: ReturnType<typeof vi.fn>;
  };
  emit(event: string, ...args: unknown[]): void;
}

const rooms = vi.hoisted(() => [] as FakeRoom[]);
const processors = vi.hoisted(() => [] as FakeProcessor[]);
/** What happened to the mic, in order. */
const steps = vi.hoisted(() => [] as string[]);
const socket = vi.hoisted(() => ({ emitWithAck: vi.fn(), sendEvent: vi.fn() }));

vi.mock('livekit-client', () => {
  class Track {
    setProcessor = vi.fn(async () => void steps.push('processor'));
    stopProcessor = vi.fn(async () => void steps.push('processor off'));
    restartTrack = vi.fn(async () => void steps.push('restart'));
    mute = vi.fn(async () => undefined);
    stop = vi.fn();
  }
  class Room {
    handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    canPlaybackAudio = true;
    options = { audioCaptureDefaults: {}, videoCaptureDefaults: {} };
    remoteParticipants = new Map();
    switchActiveDevice = vi.fn(async () => true);
    localParticipant = {
      permissions: { canPublish: true, canPublishSources: [] as number[] },
      isCameraEnabled: false,
      isScreenShareEnabled: false,
      published: undefined as Track | undefined,
      getTrackPublication: vi.fn(() =>
        this.localParticipant.published
          ? { audioTrack: this.localParticipant.published }
          : undefined,
      ),
      createTracks: vi.fn(async () => [new Track()]),
      publishTrack: vi.fn(async (t: Track) => {
        steps.push('publish');
        this.localParticipant.published = t;
      }),
      setMicrophoneEnabled: vi.fn(
        async (on: boolean) => void steps.push(on ? 'mic on' : 'mic off'),
      ),
      setCameraEnabled: vi.fn(async () => undefined),
      setScreenShareEnabled: vi.fn(async () => undefined),
    };
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => this.emit('disconnected', 1));
    constructor() {
      rooms.push(this as unknown as FakeRoom);
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers.set(event, [...(this.handlers.get(event) ?? []), fn]);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      for (const fn of this.handlers.get(event) ?? []) fn(...args);
    }
  }
  return {
    Room,
    RoomEvent: new Proxy({} as Record<string, string>, {
      get: (_t, k) => (k === 'Disconnected' ? 'disconnected' : String(k)),
    }),
    DisconnectReason: { CLIENT_INITIATED: 1, PARTICIPANT_REMOVED: 4 },
    Track: {
      Kind: { Audio: 'audio' },
      Source: { Microphone: 'microphone', ScreenShareAudio: 'screen_share_audio' },
    },
    /** The fake mic track (tests hand one out as if LiveKit published it). */
    FakeAudioTrack: Track,
  };
});
vi.mock('./processor', () => ({
  VoiceInputProcessor: class {
    gate: boolean[] = [];
    suspended = false;
    constructor(public opts: FakeProcessor['opts']) {
      processors.push(this as unknown as FakeProcessor);
    }
    setGateOpen(open: boolean) {
      this.gate.push(open);
    }
    async setIsolation() {}
    async resume() {}
    async destroy() {}
  },
}));
vi.mock('@/lib/socket', async (importOriginal) => ({
  ...(await importOriginal<typeof SocketModule>()),
  ...socket,
}));
vi.mock('@/lib/serverConfig', () => ({ serverConfig: () => ({ voice: true }) }));
vi.mock('@/lib/notify', () => ({ playSound: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { get: vi.fn(async () => ({ iceServers: [] })) },
}));

const { DEFAULT_PREFS, useUi } = await import('@/stores/ui');
const { useAuth } = await import('@/stores/auth');
const { useVoice } = await import('@/stores/voice');
const { useVoiceSelf } = await import('@/stores/voiceSelf');
const { makeMe } = await import('@/test/factories');
const { connectVoice, disconnectVoice } = await import('./engine');
const { FakeAudioTrack } = (await import('livekit-client')) as unknown as {
  FakeAudioTrack: new () => FakeTrack;
};

const BACKQUOTE: KeyCombo = {
  code: 'Backquote',
  key: '`',
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
};

const state: VoiceState = {
  userId: 'me',
  spaceId: 's1',
  channelId: 'v1',
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream: false,
  serverMute: false,
  serverDeaf: false,
  joinedAt: '2026-10-23T10:00:00.000Z',
};
const joined: VoiceJoinResult = { url: 'wss://media.example', token: 't', state, relayOnly: false };
const voiceChat = {
  id: 'v1',
  type: 'space_voice',
  space: { spaceId: 's1' },
} as unknown as ChatSummary;

const setPref = <K extends keyof typeof DEFAULT_PREFS>(k: K, v: (typeof DEFAULT_PREFS)[K]) =>
  useUi.getState().setPref(k, v);
const key = (type: 'keydown' | 'keyup', code: string, target: EventTarget = window) =>
  target.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true, cancelable: true }));
const room = () => rooms[rooms.length - 1]!;
const track = () => room().localParticipant.published!;

async function connect(prefs: Partial<typeof DEFAULT_PREFS> = {}) {
  useUi.setState({ prefs: { ...DEFAULT_PREFS, ...prefs } });
  await connectVoice(voiceChat);
  expect(useVoice.getState().connection).toMatchObject({ channelId: 'v1', status: 'connected' });
}

describe('voice engine input and output settings', () => {
  beforeEach(() => {
    rooms.length = 0;
    processors.length = 0;
    steps.length = 0;
    socket.emitWithAck.mockResolvedValue(joined);
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    useVoiceSelf.setState({ muted: false, deafened: false, pttActive: false });
  });
  afterEach(async () => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    await disconnectVoice();
    useVoice.setState({ connection: null, byUser: {} });
    useUi.setState({ prefs: DEFAULT_PREFS });
    document.body.replaceChildren();
  });

  it('push to talk: published with the processor on and the gate closed; the shortcut opens it', async () => {
    vi.useFakeTimers();
    await connect({ voiceInputMode: 'pushToTalk', pttShortcut: BACKQUOTE, pttReleaseDelayMs: 100 });
    expect(steps).toEqual(['processor', 'publish']);
    expect(room().localParticipant.setMicrophoneEnabled).not.toHaveBeenCalledWith(true);
    const p = processors[0]!;
    expect(p.opts.open).toBe(false);

    key('keydown', 'Backquote');
    expect(p.gate.at(-1)).toBe(true);
    expect(useVoiceSelf.getState().pttActive).toBe(true);
    key('keyup', 'Backquote');
    vi.advanceTimersByTime(99);
    expect(p.gate.at(-1)).toBe(true);
    vi.advanceTimersByTime(1);
    expect(p.gate.at(-1)).toBe(false);
    expect(useVoiceSelf.getState().pttActive).toBe(false);

    // Typing the key in a text field types.
    const input = document.body.appendChild(document.createElement('input'));
    key('keydown', 'Backquote', input);
    expect(p.gate.at(-1)).toBe(false);
  });

  it('back to voice activity: the processor comes off and push to talk stops listening', async () => {
    await connect({ voiceInputMode: 'pushToTalk', pttShortcut: BACKQUOTE });
    setPref('voiceInputMode', 'voiceActivity');
    await vi.waitFor(() => expect(track().stopProcessor).toHaveBeenCalled());
    await vi.waitFor(() => expect(steps.at(-1)).toBe('mic on'));
    key('keydown', 'Backquote');
    expect(useVoiceSelf.getState().pttActive).toBe(false);
  });

  it('switching to push to talk mid-call puts the processor on the published mic', async () => {
    await connect();
    expect(steps).toEqual(['mic on']);
    // LiveKit published the plain mic: the fake hands it out from now on.
    room().localParticipant.published = new FakeAudioTrack();
    setPref('pttShortcut', BACKQUOTE);
    setPref('voiceInputMode', 'pushToTalk');
    await vi.waitFor(() => expect(track().setProcessor).toHaveBeenCalled());
    const p = processors[0]!;
    await vi.waitFor(() => expect(p.gate.at(-1)).toBe(false));
    // The processor gates: LiveKit's own mute stays off.
    expect(steps.at(-1)).toBe('mic on');
    key('keydown', 'Backquote');
    expect(p.gate.at(-1)).toBe(true);
  });

  it('a manual sensitivity gates on my level, with the hold', async () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    await connect({ inputSensitivityAuto: false, inputSensitivityDb: -60 });
    const p = processors[0]!;
    expect(p.opts.open).toBe(false);
    p.opts.onLevel!(-30);
    expect(p.gate.at(-1)).toBe(true);
    now.mockReturnValue(1000);
    p.opts.onLevel!(-90);
    expect(p.gate.at(-1)).toBe(true);
    now.mockReturnValue(1500);
    p.opts.onLevel!(-90);
    expect(p.gate.at(-1)).toBe(false);
    // A level inside the gap does not reopen it.
    p.opts.onLevel!(-62);
    expect(p.gate.at(-1)).toBe(false);
  });

  it('devices and processing reach the mic at once', async () => {
    await connect({ voiceInputMode: 'pushToTalk', pttShortcut: BACKQUOTE });
    setPref('audioInputDevice', 'mic-2');
    await vi.waitFor(() =>
      expect(room().switchActiveDevice).toHaveBeenCalledWith('audioinput', 'mic-2', true),
    );
    expect(room().options.audioCaptureDefaults).toMatchObject({ deviceId: 'mic-2' });
    setPref('noiseCancellation', false);
    await vi.waitFor(() =>
      expect(track().restartTrack).toHaveBeenCalledWith(
        expect.objectContaining({ deviceId: 'mic-2', noiseSuppression: false }),
      ),
    );
    // The camera is off: the next one uses the choice.
    setPref('videoInputDevice', 'cam-2');
    expect(room().switchActiveDevice).not.toHaveBeenCalledWith(
      'videoinput',
      expect.anything(),
      expect.anything(),
    );
    expect(room().options.videoCaptureDefaults).toMatchObject({ deviceId: 'cam-2' });
  });

  it('remote voices: their volume × my output volume, muted for me, deafened', async () => {
    await connect({ outputVolume: 0.5 });
    const bob: FakeParticipant = { identity: 'bob', setVolume: vi.fn() };
    room().remoteParticipants.set('bob', bob);
    room().emit('ParticipantConnected', bob);
    expect(bob.setVolume).toHaveBeenCalledWith(0.5, 'microphone');
    expect(bob.setVolume).toHaveBeenCalledWith(0.5, 'screen_share_audio');

    setPref('userAudio', { bob: { volume: 1.5 } });
    // Media elements cannot go past 100% (no Web Audio here).
    expect(bob.setVolume).toHaveBeenLastCalledWith(0.5, 'screen_share_audio');
    expect(bob.setVolume).toHaveBeenCalledWith(0.75, 'microphone');
    setPref('outputVolume', 1);
    expect(bob.setVolume).toHaveBeenCalledWith(1, 'microphone');

    setPref('userAudio', { bob: { volume: 1.5, muted: true } });
    expect(bob.setVolume).toHaveBeenCalledWith(0, 'microphone');
    expect(bob.setVolume).toHaveBeenLastCalledWith(1, 'screen_share_audio');

    setPref('userAudio', {});
    useVoiceSelf.getState().toggleDeafen();
    expect(bob.setVolume.mock.calls.slice(-2)).toEqual([
      [0, 'microphone'],
      [0, 'screen_share_audio'],
    ]);
  });
});
