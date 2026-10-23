/**
 * Watch to subscribe (LiveKit faked): the room connects without auto-subscribe; microphones and
 * cameras are asked for as they appear (also those of people already there), a stream — screen
 * and tab audio — only once I watch it, and dropped when I stop or it ends. Viewers hear what I
 * watch over data messages and I count theirs; Go Live uses the quality of Settings.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, VoiceJoinResult } from '@enbox/shared';
import type * as ApiModule from '@/lib/api';
import type * as SocketModule from '@/lib/socket';
import type { WatchableParticipant, WatchablePublication } from './subscriptions';
import type { StreamMessage } from './viewers';

interface FakePub {
  source: string;
  isDesired: boolean;
  setSubscribed: ReturnType<typeof vi.fn>;
}
interface FakeParticipant {
  identity: string;
  trackPublications: Map<string, FakePub>;
  setVolume: ReturnType<typeof vi.fn>;
}
interface FakeRoom {
  remoteParticipants: Map<string, FakeParticipant>;
  localParticipant: {
    identity: string;
    isScreenShareEnabled: boolean;
    publishData: ReturnType<typeof vi.fn>;
    setScreenShareEnabled: ReturnType<typeof vi.fn>;
  };
  connect: ReturnType<typeof vi.fn>;
  emit(event: string, ...args: unknown[]): void;
}

const rooms = vi.hoisted(() => [] as FakeRoom[]);
/** People in the room before I join (the join response brings them). */
const already = vi.hoisted(() => [] as FakeParticipant[]);
const socket = vi.hoisted(() => ({ emitWithAck: vi.fn(), sendEvent: vi.fn() }));

vi.mock('livekit-client', () => {
  class Room {
    handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    canPlaybackAudio = true;
    options = { audioCaptureDefaults: {}, videoCaptureDefaults: {} };
    remoteParticipants = new Map<string, FakeParticipant>();
    localParticipant = {
      identity: 'me',
      permissions: { canPublish: true, canPublishSources: [] as number[] },
      isCameraEnabled: false,
      isScreenShareEnabled: false,
      getTrackPublication: vi.fn(() => undefined),
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async () => undefined),
      setScreenShareEnabled: vi.fn(async () => undefined),
      publishData: vi.fn(async () => undefined),
    };
    connect = vi.fn(async () => {
      for (const p of already) this.remoteParticipants.set(p.identity, p);
    });
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
      Kind: { Audio: 'audio', Video: 'video' },
      Source: {
        Camera: 'camera',
        Microphone: 'microphone',
        ScreenShare: 'screen_share',
        ScreenShareAudio: 'screen_share_audio',
        Unknown: 'unknown',
      },
    },
  };
});
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

const { useVoice } = await import('@/stores/voice');
const { connectVoice, disconnectVoice, toggleScreenShare } = await import('../engine');
const { useStreams } = await import('./store');
const { useStreamQuality } = await import('./quality');
const { syncParticipant, syncPublication } = await import('./subscriptions');
const { decodeStreamMessage, encodeStreamMessage, STREAM_TOPIC } = await import('./viewers');

function pub(source: string, isDesired = false): FakePub {
  const p: FakePub = {
    source,
    isDesired,
    setSubscribed: vi.fn((on: boolean) => {
      p.isDesired = on;
    }),
  };
  return p;
}

function person(
  identity: string,
  sources: string[],
): FakeParticipant & { pub(source: string): FakePub } {
  const trackPublications = new Map(sources.map((s, i) => [`${identity}-${i}`, pub(s)]));
  return {
    identity,
    trackPublications,
    setVolume: vi.fn(),
    pub: (source: string) => [...trackPublications.values()].find((p) => p.source === source)!,
  };
}

const joined = (): VoiceJoinResult => ({
  url: 'wss://media.example',
  token: 'token',
  relayOnly: false,
  state: {
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
  },
});
const voiceChat = {
  id: 'v1',
  type: 'space_voice',
  space: { spaceId: 's1' },
} as unknown as ChatSummary;
const room = () => rooms[rooms.length - 1]!;
/** The data messages I sent: [message, options]. */
const sent = () =>
  room().localParticipant.publishData.mock.calls.map(([payload, opts]) => [
    decodeStreamMessage(payload as Uint8Array),
    opts,
  ]);

// The fakes carry the sources' string values (the enum is mocked).
const asPub = (p: FakePub) => p as unknown as WatchablePublication;
const asPerson = (p: FakeParticipant) => p as unknown as WatchableParticipant;

describe('subscriptions (pure)', () => {
  it('everything but a stream is wanted; a stream only while watched', () => {
    const mic = pub('microphone');
    const screen = pub('screen_share');
    const tabAudio = pub('screen_share_audio');
    for (const p of [mic, screen, tabAudio]) syncPublication(asPub(p), false);
    expect(mic.setSubscribed).toHaveBeenCalledWith(true);
    expect(screen.setSubscribed).not.toHaveBeenCalled();
    expect(tabAudio.setSubscribed).not.toHaveBeenCalled();

    const ann = person('ann', ['microphone', 'camera', 'screen_share', 'screen_share_audio']);
    syncParticipant(asPerson(ann), true);
    for (const p of ann.trackPublications.values())
      expect(p.setSubscribed).toHaveBeenCalledWith(true);
    syncParticipant(asPerson(ann), false);
    expect(ann.pub('screen_share').setSubscribed).toHaveBeenLastCalledWith(false);
    expect(ann.pub('screen_share_audio').setSubscribed).toHaveBeenLastCalledWith(false);
    // Already as wanted: nothing more is asked.
    expect(ann.pub('microphone').setSubscribed).toHaveBeenCalledTimes(1);
  });

  it('data messages round-trip; anything else is ignored', () => {
    const msg: StreamMessage = { type: 'watching', streams: ['ann', 'bob'] };
    expect(decodeStreamMessage(encodeStreamMessage(msg))).toEqual(msg);
    expect(decodeStreamMessage(encodeStreamMessage({ type: 'sync' }))).toEqual({ type: 'sync' });
    const raw = (v: string) => new TextEncoder().encode(v);
    expect(decodeStreamMessage(raw('nope'))).toBeNull();
    expect(decodeStreamMessage(raw('{"type":"watching","streams":[1]}'))).toBeNull();
    expect(decodeStreamMessage(raw('{"type":"other"}'))).toBeNull();
  });
});

describe('the voice room and streams', () => {
  let ann: ReturnType<typeof person>;

  beforeEach(async () => {
    rooms.length = 0;
    // Ann is already here and sharing her screen.
    ann = person('ann', ['microphone', 'screen_share', 'screen_share_audio']);
    already.splice(0, already.length, ann);
    socket.emitWithAck.mockResolvedValue(joined());
    await connectVoice(voiceChat);
    expect(useVoice.getState().connection).toMatchObject({ channelId: 'v1', status: 'connected' });
  });
  afterEach(async () => {
    await disconnectVoice();
    useVoice.setState({ connection: null, byUser: {} });
  });

  it('connects without auto-subscribe and asks for what was already there, a stream excepted', () => {
    expect(room().connect).toHaveBeenCalledWith(
      'wss://media.example',
      'token',
      expect.objectContaining({ autoSubscribe: false }),
    );
    expect(ann.pub('microphone').setSubscribed).toHaveBeenCalledWith(true);
    expect(ann.pub('screen_share').setSubscribed).not.toHaveBeenCalled();
    expect(ann.pub('screen_share_audio').setSubscribed).not.toHaveBeenCalled();
    // Someone streams: I ask who watches.
    expect(sent()).toEqual([[{ type: 'sync' }, { reliable: true, topic: STREAM_TOPIC }]]);
  });

  it('later tracks: mic and camera at once, a stream on Watch; Stop Watching and the stream ending drop it', () => {
    const bob = person('bob', ['microphone', 'camera', 'screen_share', 'screen_share_audio']);
    room().remoteParticipants.set('bob', bob);
    room().emit('ParticipantConnected', bob);
    for (const p of bob.trackPublications.values()) room().emit('TrackPublished', p, bob);
    expect(bob.pub('microphone').setSubscribed).toHaveBeenCalledWith(true);
    expect(bob.pub('camera').setSubscribed).toHaveBeenCalledWith(true);
    expect(bob.pub('screen_share').setSubscribed).not.toHaveBeenCalled();

    useStreams.getState().watch('bob');
    expect(bob.pub('screen_share').setSubscribed).toHaveBeenLastCalledWith(true);
    expect(bob.pub('screen_share_audio').setSubscribed).toHaveBeenLastCalledWith(true);
    expect(ann.pub('screen_share').setSubscribed).not.toHaveBeenCalled();
    expect(useStreams.getState().focus).toBe('bob:screen');
    expect(sent().at(-1)).toEqual([
      { type: 'watching', streams: ['bob'] },
      { reliable: true, topic: STREAM_TOPIC },
    ]);

    useStreams.getState().stopWatching('bob');
    expect(bob.pub('screen_share').setSubscribed).toHaveBeenLastCalledWith(false);
    expect(bob.pub('screen_share_audio').setSubscribed).toHaveBeenLastCalledWith(false);
    expect(sent().at(-1)?.[0]).toEqual({ type: 'watching', streams: [] });

    // Watching again, then Bob stops sharing: no longer watched, out of focus.
    useStreams.getState().watch('bob');
    const screen = bob.pub('screen_share');
    bob.trackPublications.delete([...bob.trackPublications].find(([, p]) => p === screen)![0]);
    room().emit('TrackUnpublished', screen, bob);
    expect(useStreams.getState().watching).toEqual({});
    expect(useStreams.getState().focus).toBeNull();
    expect(bob.pub('screen_share_audio').setSubscribed).toHaveBeenLastCalledWith(false);
  });

  it('counts who watches from their messages, answers a sync while watching, forgets who leaves', () => {
    const carol = person('carol', ['microphone']);
    room().remoteParticipants.set('carol', carol);
    const data = (
      from: FakeParticipant,
      msg: Parameters<typeof encodeStreamMessage>[0],
      topic = STREAM_TOPIC,
    ) => room().emit('DataReceived', encodeStreamMessage(msg), from, undefined, topic);

    data(carol, { type: 'watching', streams: ['ann', 'me'] });
    expect(useStreams.getState().viewers).toEqual({ ann: { carol: true }, me: { carol: true } });
    data(carol, { type: 'watching', streams: ['me'] });
    expect(useStreams.getState().viewers.ann).toEqual({});
    // Other topics are not ours.
    data(carol, { type: 'watching', streams: [] }, 'chat');
    expect(useStreams.getState().viewers.me).toEqual({ carol: true });

    // A newcomer asks: nothing to say while I watch nothing, my list once I do.
    room().localParticipant.publishData.mockClear();
    data(carol, { type: 'sync' });
    expect(sent()).toEqual([]);
    useStreams.getState().watch('ann');
    room().localParticipant.publishData.mockClear();
    data(carol, { type: 'sync' });
    expect(sent()).toEqual([
      [
        { type: 'watching', streams: ['ann'] },
        { reliable: true, topic: STREAM_TOPIC, destinationIdentities: ['carol'] },
      ],
    ]);

    room().emit('ParticipantDisconnected', carol);
    expect(useStreams.getState().viewers.me).toEqual({});
  });

  it('Go Live at the chosen quality; leaving the room forgets the streams', async () => {
    useStreamQuality.getState().setQuality('1080p60');
    await toggleScreenShare();
    expect(room().localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(
      true,
      expect.objectContaining({
        audio: true,
        resolution: { width: 1920, height: 1080, frameRate: 60 },
      }),
      expect.objectContaining({ screenShareEncoding: { maxBitrate: 7_000_000, maxFramerate: 60 } }),
    );
    room().localParticipant.isScreenShareEnabled = true;
    await toggleScreenShare();
    expect(room().localParticipant.setScreenShareEnabled).toHaveBeenLastCalledWith(false);

    useStreams.getState().watch('ann');
    await disconnectVoice();
    expect(useStreams.getState()).toMatchObject({ watching: {}, viewers: {}, focus: null });
  });
});
