/**
 * The voice engine's moves: `voice:moved` swaps the media room with the server's token (no new
 * `voice:join`, no `voice:leave`), the view follows only when it showed the old channel, and a
 * removal by the media server waits for the socket to say why.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChatSummary, VoiceJoinResult, VoiceState } from '@enbox/shared';
import type * as ApiModule from '@/lib/api';
import type * as SocketModule from '@/lib/socket';

const rooms = vi.hoisted(() => [] as FakeRoom[]);
const socket = vi.hoisted(() => ({ emitWithAck: vi.fn(), sendEvent: vi.fn() }));

interface FakeRoom {
  handlers: Map<string, (...args: unknown[]) => void>;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  emit(event: string, ...args: unknown[]): void;
}

vi.mock('livekit-client', () => {
  class Room {
    handlers = new Map<string, (...args: unknown[]) => void>();
    canPlaybackAudio = true;
    localParticipant = { setMicrophoneEnabled: vi.fn(async () => undefined), isCameraEnabled: false, isScreenShareEnabled: false };
    connect = vi.fn(async () => undefined);
    disconnect = vi.fn(async () => this.emit('disconnected', 1));
    constructor() {
      rooms.push(this as unknown as FakeRoom);
    }
    on(event: string, fn: (...args: unknown[]) => void) {
      this.handlers.set(event, fn);
      return this;
    }
    emit(event: string, ...args: unknown[]) {
      this.handlers.get(event)?.(...args);
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

const { bus } = await import('@/lib/bus');
const { useVoice } = await import('@/stores/voice');
const { connectVoice, voiceMovedByServer } = await import('./engine');

const state = (channelId: string): VoiceState => ({
  userId: 'me',
  spaceId: 's1',
  channelId,
  selfMute: false,
  selfDeaf: false,
  selfVideo: false,
  selfStream: false,
  serverMute: false,
  serverDeaf: false,
  joinedAt: '2026-10-23T10:00:00.000Z',
});
const result = (channelId: string, token: string): VoiceJoinResult => ({ url: 'wss://media.example', token, state: state(channelId), relayOnly: false });
const voiceChat = (id: string) => ({ id, type: 'space_voice', space: { spaceId: 's1' } }) as unknown as ChatSummary;

describe('voice engine moves', () => {
  beforeEach(async () => {
    rooms.length = 0;
    socket.emitWithAck.mockResolvedValue(result('a', 'token-a'));
    socket.sendEvent.mockClear();
    window.history.replaceState(null, '', '/spaces/s1/a');
    await connectVoice(voiceChat('a'));
    expect(useVoice.getState().connection).toMatchObject({ channelId: 'a', status: 'connected' });
  });
  afterEach(() => {
    useVoice.setState({ connection: null, byUser: {} });
    vi.useRealTimers();
  });

  it('voice:moved: leaves the old room, joins the new one with the sent token, the view follows', async () => {
    const navigate = vi.fn();
    const off = bus.on('navigate', navigate);
    socket.emitWithAck.mockClear();
    await voiceMovedByServer('a', result('b', 'token-b'));
    off();
    expect(rooms).toHaveLength(2);
    expect(rooms[0]!.disconnect).toHaveBeenCalled();
    expect(rooms[1]!.connect).toHaveBeenCalledWith('wss://media.example', 'token-b', expect.anything());
    expect(socket.emitWithAck).not.toHaveBeenCalled();
    expect(socket.sendEvent).not.toHaveBeenCalledWith('voice:leave', expect.anything());
    expect(useVoice.getState().connection).toMatchObject({ spaceId: 's1', channelId: 'b', status: 'connected' });
    expect(useVoice.getState().byUser.me?.channelId).toBe('b');
    expect(navigate).toHaveBeenCalledWith({ to: '/spaces/s1/b', replace: true });
  });

  it('the view stays when it showed something else; a move from a channel I am not in is ignored', async () => {
    window.history.replaceState(null, '', '/spaces/s1/general');
    const navigate = vi.fn();
    const off = bus.on('navigate', navigate);
    await voiceMovedByServer('elsewhere', result('c', 'token-c'));
    expect(rooms).toHaveLength(1);
    await voiceMovedByServer('a', result('b', 'token-b'));
    off();
    expect(useVoice.getState().connection?.channelId).toBe('b');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('removed by the media server: no voice:leave until the socket stays silent', async () => {
    vi.useFakeTimers();
    rooms[0]!.emit('disconnected', 4);
    expect(socket.sendEvent).not.toHaveBeenCalledWith('voice:leave', expect.anything());
    expect(useVoice.getState().connection).toMatchObject({ channelId: 'a', status: 'reconnecting' });
    // The move arrives: the new room connects and nothing leaves.
    await voiceMovedByServer('a', result('b', 'token-b'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(socket.sendEvent).not.toHaveBeenCalledWith('voice:leave', expect.anything());
    expect(useVoice.getState().connection?.channelId).toBe('b');
  });

  it('removed with no word from the socket: leaves after the grace period', async () => {
    vi.useFakeTimers();
    rooms[0]!.emit('disconnected', 4);
    await vi.advanceTimersByTimeAsync(4_000);
    expect(socket.sendEvent).toHaveBeenCalledWith('voice:leave', {});
    expect(useVoice.getState().connection).toBeNull();
  });
});
