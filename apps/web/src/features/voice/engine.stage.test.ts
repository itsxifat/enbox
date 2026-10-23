/**
 * The voice engine on a Stage: nothing is published in the audience (whatever the user panel
 * says); invited up, the mic goes on once the media server grants it, without a reconnect and
 * not while I muted myself; a grant that never comes brings one fresh token and a reconnect;
 * moved back to the audience, everything I publish stops.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PERM, type ChatSummary, type VoiceJoinResult, type VoiceState } from '@enbox/shared';
import type * as ApiModule from '@/lib/api';
import type * as SocketModule from '@/lib/socket';

interface FakeRoom {
  handlers: Map<string, ((...args: unknown[]) => void)[]>;
  localParticipant: {
    permissions?: { canPublish: boolean; canPublishSources: number[] };
    setMicrophoneEnabled: ReturnType<typeof vi.fn>;
    setCameraEnabled: ReturnType<typeof vi.fn>;
    setScreenShareEnabled: ReturnType<typeof vi.fn>;
    isCameraEnabled: boolean;
    isScreenShareEnabled: boolean;
  };
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  emit(event: string, ...args: unknown[]): void;
}

const rooms = vi.hoisted(() => [] as FakeRoom[]);
const socket = vi.hoisted(() => ({ emitWithAck: vi.fn(), sendEvent: vi.fn() }));
/** The grant the next room connects with (LiveKit takes it from the token). */
const nextGrant = vi.hoisted(() => ({ canPublish: false, canPublishSources: [] as number[] }));

vi.mock('livekit-client', () => {
  class Room {
    handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    canPlaybackAudio = true;
    localParticipant = {
      permissions: undefined as { canPublish: boolean; canPublishSources: number[] } | undefined,
      setMicrophoneEnabled: vi.fn(async () => undefined),
      setCameraEnabled: vi.fn(async () => undefined),
      setScreenShareEnabled: vi.fn(async () => undefined),
      isCameraEnabled: false,
      isScreenShareEnabled: false,
    };
    connect = vi.fn(async () => {
      this.localParticipant.permissions = { ...nextGrant, canPublishSources: [...nextGrant.canPublishSources] };
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
    RoomEvent: new Proxy({} as Record<string, string>, { get: (_t, k) => (k === 'Disconnected' ? 'disconnected' : String(k)) }),
    DisconnectReason: { CLIENT_INITIATED: 1, PARTICIPANT_REMOVED: 4 },
    Track: { Kind: { Audio: 'audio' }, Source: {} },
  };
});
vi.mock('@/lib/socket', async (importOriginal) => ({ ...(await importOriginal<typeof SocketModule>()), ...socket }));
vi.mock('@/lib/serverConfig', () => ({ serverConfig: () => ({ voice: true }) }));
vi.mock('@/lib/notify', () => ({ playSound: vi.fn() }));
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { get: vi.fn(async () => ({ iceServers: [] })) },
}));

const { useAuth } = await import('@/stores/auth');
const { useChats } = await import('@/stores/chats');
const { useVoice } = await import('@/stores/voice');
const { useVoiceSelf } = await import('@/stores/voiceSelf');
const { makeChat, makeMe } = await import('@/test/factories');
const { STAGE_GRANT_WAIT_MS, connectVoice, disconnectVoice } = await import('./engine');

const MIC = 2;
const SPEAKER_GRANT = { canPublish: true, canPublishSources: [MIC, 1] };

const state = (p: Partial<VoiceState> = {}): VoiceState => ({
  userId: 'me',
  spaceId: 's1',
  channelId: 'st',
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream: false,
  serverMute: false,
  serverDeaf: false,
  suppressed: true,
  requestToSpeakAt: null,
  joinedAt: '2026-10-23T10:00:00.000Z',
  ...p,
});
const joined = (p: Partial<VoiceState> = {}, token = 'audience'): VoiceJoinResult => ({
  url: 'wss://media.example',
  token,
  state: state(p),
  relayOnly: false,
});
const stage = { ...makeChat({ id: 'st', type: 'space_stage', spacePermissions: PERM.VIEW_CHANNEL | PERM.CONNECT | PERM.SPEAK }), space: { spaceId: 's1' } } as unknown as ChatSummary;

/** The server's `voice:state` for my own state on the Stage. */
const seat = (p: Partial<VoiceState>) =>
  useVoice.getState().applyState({ spaceId: 's1', channelId: 'st', userId: 'me', state: state(p) });
const mic = (r: FakeRoom) => r.localParticipant.setMicrophoneEnabled;
const turnedOn = (r: FakeRoom) => mic(r).mock.calls.some((c) => c[0] === true);

describe('voice engine on a Stage', () => {
  beforeEach(async () => {
    rooms.length = 0;
    Object.assign(nextGrant, { canPublish: false, canPublishSources: [] });
    socket.emitWithAck.mockReset().mockResolvedValue(joined());
    socket.sendEvent.mockClear();
    useAuth.setState({ user: makeMe({ id: 'me' }), token: 't', status: 'authenticated' });
    useChats.setState({ byId: { st: stage } });
    useVoiceSelf.setState({ muted: false, deafened: false });
    await connectVoice(stage);
    expect(useVoice.getState().connection).toMatchObject({ channelId: 'st', status: 'connected' });
  });
  afterEach(async () => {
    vi.useRealTimers();
    await disconnectVoice();
    useVoice.setState({ connection: null, byUser: {} });
  });

  it('the audience publishes nothing, even unmuted from the user panel', async () => {
    const r = rooms[0]!;
    expect(useVoice.getState().byUser.me).toMatchObject({ suppressed: true });
    expect(mic(r)).toHaveBeenCalledWith(false);
    useVoiceSelf.setState({ muted: true });
    useVoiceSelf.setState({ muted: false });
    await vi.waitFor(() => expect(socket.sendEvent).toHaveBeenCalledWith('voice:update', expect.objectContaining({ selfMute: false })));
    expect(turnedOn(r)).toBe(false);
  });

  it('invited up: the mic goes on once the media server grants it, without reconnecting', async () => {
    const r = rooms[0]!;
    seat({ suppressed: false });
    await new Promise((res) => setTimeout(res, 0));
    expect(turnedOn(r)).toBe(false);
    r.localParticipant.permissions = { ...SPEAKER_GRANT };
    r.emit('ParticipantPermissionsChanged', { canPublish: false }, r.localParticipant);
    await vi.waitFor(() => expect(mic(r)).toHaveBeenLastCalledWith(true));
    expect(rooms).toHaveLength(1);
    expect(socket.emitWithAck).toHaveBeenCalledTimes(1);
  });

  it('invited up while muted: nothing is published until I unmute', async () => {
    const r = rooms[0]!;
    useVoiceSelf.setState({ muted: true });
    r.localParticipant.permissions = { ...SPEAKER_GRANT };
    seat({ suppressed: false });
    await vi.waitFor(() => expect(socket.sendEvent).toHaveBeenCalledWith('voice:update', expect.objectContaining({ selfMute: true })));
    expect(turnedOn(r)).toBe(false);
    useVoiceSelf.setState({ muted: false });
    await vi.waitFor(() => expect(mic(r)).toHaveBeenLastCalledWith(true));
  });

  it('a grant that never comes: one fresh token (my role is kept) and a reconnect', async () => {
    vi.useFakeTimers();
    socket.emitWithAck.mockResolvedValue(joined({ suppressed: false }, 'speaker'));
    Object.assign(nextGrant, SPEAKER_GRANT);
    seat({ suppressed: false });
    await vi.advanceTimersByTimeAsync(STAGE_GRANT_WAIT_MS - 100);
    expect(rooms).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(200);
    await vi.waitFor(() => expect(rooms).toHaveLength(2));
    expect(socket.emitWithAck).toHaveBeenLastCalledWith('voice:join', expect.objectContaining({ channelId: 'st' }));
    expect(rooms[0]!.disconnect).toHaveBeenCalled();
    expect(rooms[1]!.connect).toHaveBeenCalledWith('wss://media.example', 'speaker', expect.anything());
    await vi.waitFor(() => expect(mic(rooms[1]!)).toHaveBeenLastCalledWith(true));
    expect(useVoice.getState().connection).toMatchObject({ channelId: 'st', status: 'connected' });
  });

  it('moved back to the audience: mic, camera and screen stop', async () => {
    const r = rooms[0]!;
    r.localParticipant.permissions = { ...SPEAKER_GRANT };
    seat({ suppressed: false });
    await vi.waitFor(() => expect(mic(r)).toHaveBeenLastCalledWith(true));
    seat({ suppressed: true });
    await vi.waitFor(() => expect(mic(r)).toHaveBeenLastCalledWith(false));
    expect(r.localParticipant.setCameraEnabled).toHaveBeenCalledWith(false);
    expect(r.localParticipant.setScreenShareEnabled).toHaveBeenCalledWith(false);
  });
});
