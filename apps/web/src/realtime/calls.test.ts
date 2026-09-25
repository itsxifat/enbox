/**
 * Realtime call handlers: simultaneous incoming calls are queued (CALLS-12), rings stop
 * locally when the ring-stop was missed (CALLS-11), and a failed `GET /api/calls/active`
 * after a reconnect is retried while the active call rejoins anyway (CALLS-8).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call, CallParticipant, IncomingCallPayload } from '@enbox/shared';
import { api } from '@/lib/api';
import { resetSessionState } from '@/lib/session';
import { useConnection, type AppSocket } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useCalls, type ActiveCall } from '@/stores/calls';
import { makeMe, makeUser } from '@/test/factories';
import type * as NotifyModule from '@/lib/notify';
import type * as SocketModule from '@/lib/socket';

const sent = vi.hoisted(() => [] as { event: string; payload: { callId?: string } }[]);

vi.mock('@/lib/socket', async (importOriginal) => ({
  ...(await importOriginal<typeof SocketModule>()),
  sendEvent: (event: string, payload: { callId?: string }) => {
    sent.push({ event, payload });
    return true;
  },
}));
vi.mock('@/lib/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof NotifyModule>()),
  showNotification: async () => false,
}));
const controller = vi.hoisted(() => ({
  reconcile: vi.fn(async () => undefined),
  reconcileWithoutList: vi.fn(),
}));
vi.mock('@/features/calls/controller', () => controller);

const { LOCAL_RING_TIMEOUT_MS, registerCallHandlers, resyncCalls } = await import('./calls');

const ME = '00000000-0000-4000-8000-0000000000aa';

function part(userId: string, status: CallParticipant['status']): CallParticipant {
  return {
    userId,
    status,
    joinedAt: null,
    leftAt: null,
    audioMuted: false,
    videoOff: true,
    screenSharing: false,
  };
}

function ringingCall(id: string, from: string): Call {
  return {
    id,
    chatId: `chat-${id}`,
    type: 'audio',
    isGroup: false,
    initiatorId: from,
    status: 'ringing',
    createdAt: '2099-01-01T10:00:00.000Z',
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    participants: [part(from, 'joined'), part(ME, 'invited')],
  };
}

function incoming(c: Call): IncomingCallPayload {
  return {
    call: c,
    chat: { id: c.chatId, type: 'direct', name: null, avatarUrl: null, peer: null, memberCount: 2 },
    caller: makeUser({ id: c.initiatorId }),
    silent: false,
  };
}

type Handler = (payload: unknown) => void;
const handlers = new Map<string, Handler>();
const fakeSocket = {
  on: (event: string, fn: Handler) => handlers.set(event, fn),
} as unknown as AppSocket;
const emit = (event: string, payload: unknown) => handlers.get(event)!(payload);
const ringingSentFor = () =>
  sent.filter((s) => s.event === 'call:ringing').map((s) => s.payload.callId);
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: ME }), token: 't', status: 'authenticated' });
  handlers.clear();
  registerCallHandlers(fakeSocket);
  sent.length = 0;
});

afterEach(() => {
  resetSessionState();
  vi.useRealTimers();
  vi.restoreAllMocks();
  controller.reconcile.mockClear();
  controller.reconcileWithoutList.mockClear();
});

describe('simultaneous incoming calls (CALLS-12)', () => {
  it('queues a second call and shows it once the first is declined', async () => {
    const x = ringingCall('x', 'caller-x');
    const y = ringingCall('y', 'caller-y');
    emit('call:incoming', incoming(x));
    emit('call:incoming', incoming(y));
    expect(useCalls.getState().incoming?.call.id).toBe('x');
    expect(ringingSentFor()).toEqual(['x']);

    useCalls.getState().declineIncoming();
    await flush();
    expect(useCalls.getState().incoming?.call.id).toBe('y');
    expect(ringingSentFor()).toEqual(['x', 'y']);

    emit('call:ring-stop', { callId: 'y', reason: 'cancelled' });
    await flush();
    expect(useCalls.getState().incoming).toBeNull();
  });

  it('skips queued calls that stopped ringing meanwhile', async () => {
    emit('call:incoming', incoming(ringingCall('x', 'a')));
    emit('call:incoming', incoming(ringingCall('y', 'b')));
    emit('call:incoming', incoming(ringingCall('z', 'c')));
    emit('call:ring-stop', { callId: 'y', reason: 'cancelled' });
    emit('call:ring-stop', { callId: 'x', reason: 'timeout' });
    await flush();
    expect(useCalls.getState().incoming?.call.id).toBe('z');
  });
});

describe('local ring timeout (CALLS-11)', () => {
  it('stops ringing when the ring-stop never arrives (offline)', async () => {
    vi.useFakeTimers();
    emit('call:incoming', incoming(ringingCall('x', 'a')));
    await vi.advanceTimersByTimeAsync(LOCAL_RING_TIMEOUT_MS - 1_000);
    // A re-emit after reconnecting does not extend the deadline.
    emit('call:incoming', incoming(ringingCall('x', 'a')));
    expect(useCalls.getState().incoming?.call.id).toBe('x');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(useCalls.getState().incoming).toBeNull();
  });
});

describe('resync after a reconnect (CALLS-8)', () => {
  const info = { userId: ME, sessionId: 's', serverTime: '', reconnect: true };

  it('retries GET /api/calls/active and rejoins the active call meanwhile', async () => {
    vi.useFakeTimers();
    useConnection.setState({ ready: true });
    useCalls.setState({
      active: { call: ringingCall('c1', 'a'), phase: 'reconnecting' } as unknown as ActiveCall,
    });
    const get = vi
      .spyOn(api, 'get')
      .mockRejectedValueOnce(new Error('502'))
      .mockResolvedValue([] as never);
    await expect(resyncCalls(info)).rejects.toThrow('502');
    expect(controller.reconcileWithoutList).toHaveBeenCalledTimes(1);
    expect(controller.reconcile).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1_000);
    expect(get.mock.calls.filter(([path]) => path === '/api/calls/active')).toHaveLength(2);
    expect(controller.reconcile).toHaveBeenCalledWith([], info);
  });

  it('does not retry once the socket is down (the next ready resyncs)', async () => {
    vi.useFakeTimers();
    useConnection.setState({ ready: true });
    useCalls.setState({
      active: { call: ringingCall('c1', 'a'), phase: 'reconnecting' } as unknown as ActiveCall,
    });
    const get = vi.spyOn(api, 'get').mockRejectedValue(new Error('502'));
    await expect(resyncCalls(info)).rejects.toThrow();
    useConnection.setState({ ready: false });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(get).toHaveBeenCalledTimes(1);
  });
});
