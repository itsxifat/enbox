/**
 * Call controller flows with the socket, media and WebRTC engine mocked: mute before the
 * engine exists, forced leave, hang up during accept, lost acks, reload rejoin, rejoin
 * retries, late patches after the end, camera races.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Call, CallParticipant, IncomingCallPayload } from '@enbox/shared';
import { ApiError, api } from '@/lib/api';
import { bus } from '@/lib/bus';
import { resetSessionState } from '@/lib/session';
import { useConnection } from '@/lib/socket';
import { useAuth } from '@/stores/auth';
import { useCalls } from '@/stores/calls';
import { makeMe, makeUser } from '@/test/factories';
import type * as NotifyModule from '@/lib/notify';
import type * as SocketModule from '@/lib/socket';
import type * as MediaModule from './engine/media';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

interface PendingAck {
  event: string;
  payload: Record<string, unknown>;
  resolve(data: unknown): void;
  reject(e: unknown): void;
}

const sock = vi.hoisted(() => ({
  connected: true,
  pending: [] as PendingAck[],
  sent: [] as { event: string; payload: Record<string, unknown> }[],
}));

vi.mock('@/lib/socket', async (importOriginal) => {
  const mod = await importOriginal<typeof SocketModule>();
  const { ApiError: Err } = await import('@/lib/api');
  return {
    ...mod,
    isSocketConnected: () => sock.connected,
    sendEvent: (event: string, payload: Record<string, unknown>) => {
      if (!sock.connected) return false;
      sock.sent.push({ event, payload });
      return true;
    },
    emitWithAck: (event: string, payload: Record<string, unknown>) => {
      if (!sock.connected) return Promise.reject(new Err('network_error', 'Not connected'));
      return new Promise((resolve, reject) =>
        sock.pending.push({ event, payload, resolve, reject }),
      );
    },
  };
});

class FakeTrack {
  readyState = 'live';
  constructor(readonly kind: 'audio' | 'video') {}
  stop() {
    this.readyState = 'ended';
  }
  getSettings() {
    return {};
  }
}

const media = vi.hoisted(() => ({
  mic: null as null | Promise<unknown>,
  camera: null as null | Promise<unknown>,
}));

vi.mock('./engine/media', async (importOriginal) => {
  const mod = await importOriginal<typeof MediaModule>();
  return {
    ...mod,
    callsSupported: () => true,
    getMicrophoneStream: () =>
      media.mic ?? Promise.resolve({ getAudioTracks: () => [new FakeTrack('audio')] }),
    getCameraTrack: () => media.camera ?? Promise.resolve(new FakeTrack('video')),
    listDevices: async () => [],
  };
});

vi.mock('./engine/iceServers', () => ({ getIceServers: async () => [] }));
vi.mock('@/lib/notify', async (importOriginal) => ({
  ...(await importOriginal<typeof NotifyModule>()),
  playSound: () => undefined,
}));

const engines = vi.hoisted(() => [] as FakeEngineShape[]);
interface FakeEngineShape {
  log: string[];
  muted: boolean;
  camera: unknown;
  peers: Set<string>;
  closed: boolean;
}

vi.mock('./engine/CallEngine', () => ({
  CallEngine: class implements FakeEngineShape {
    log: string[] = [];
    muted = false;
    camera: unknown = null;
    peers = new Set<string>();
    closed = false;
    constructor() {
      engines.push(this);
    }
    setMuted(m: boolean) {
      this.muted = m;
      this.log.push(`setMuted:${m}`);
    }
    setMicrophone() {
      this.log.push('setMicrophone');
    }
    setCamera(t: unknown) {
      this.camera = t;
    }
    setScreen() {}
    connectTo(id: string) {
      this.peers.add(id);
    }
    removePeer(id: string) {
      this.peers.delete(id);
    }
    closePeers() {
      this.peers.clear();
      this.log.push('closePeers');
    }
    close() {
      this.closed = true;
    }
    handleSignal() {}
    refreshIceServers() {
      this.log.push('refreshIce');
      return Promise.resolve();
    }
    setOutputDevice() {
      return Promise.resolve();
    }
    currentCameraDeviceId() {
      return null;
    }
    resumeAudio() {}
  },
}));

const {
  acceptIncoming,
  flipCamera,
  inviteToCall,
  leaveCall,
  reconcile,
  startCall,
  toggleMute,
  toggleVideo,
} = await import('./controller');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const ME = '00000000-0000-4000-8000-0000000000aa';
const PEER = '00000000-0000-4000-8000-0000000000bb';
const OTHER = '00000000-0000-4000-8000-0000000000cc';

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

function call(p: Partial<Call> = {}): Call {
  return {
    id: 'call-1',
    chatId: 'chat-1',
    type: 'audio',
    isGroup: false,
    initiatorId: PEER,
    status: 'ringing',
    createdAt: '2099-01-01T10:00:00.000Z',
    answeredAt: null,
    endedAt: null,
    durationSec: null,
    participants: [part(PEER, 'joined'), part(ME, 'ringing')],
    ...p,
  };
}

const ongoing = (p: Partial<Call> = {}) =>
  call({ status: 'ongoing', participants: [part(PEER, 'joined'), part(ME, 'joined')], ...p });

function incomingOf(c: Call): IncomingCallPayload {
  return {
    call: c,
    chat: {
      id: c.chatId,
      type: c.isGroup ? 'group' : 'direct',
      name: null,
      avatarUrl: null,
      peer: null,
      memberCount: 2,
    },
    caller: makeUser({ id: c.initiatorId }),
    silent: false,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async (n = 5) => {
  for (let i = 0; i < n; i++) await new Promise((r) => setTimeout(r, 0));
};

function takeAck(event: string): PendingAck {
  const i = sock.pending.findIndex((p) => p.event === event);
  if (i < 0) throw new Error(`no pending ${event} (have: ${sock.pending.map((p) => p.event)})`);
  return sock.pending.splice(i, 1)[0]!;
}

const sentEvents = () => sock.sent.map((s) => s.event);
const active = () => useCalls.getState().active;

function socketDown() {
  sock.connected = false;
  useConnection.setState({ ready: false, state: 'disconnected' });
}

function socketUp() {
  sock.connected = true;
  useConnection.setState({ ready: true, state: 'connected' });
}

/** Accept an incoming call and complete the ack. */
async function inCall(c: Call = call(), joined: Call = ongoing({ id: c.id, isGroup: c.isGroup })) {
  useCalls.getState().setIncoming(incomingOf(c));
  const p = acceptIncoming();
  await flush();
  takeAck('call:accept').resolve({ call: joined });
  await p;
  await flush();
  return joined;
}

beforeEach(() => {
  useAuth.setState({ user: makeMe({ id: ME }), token: 't', status: 'authenticated' });
  socketUp();
  sock.pending = [];
  sock.sent = [];
  media.mic = null;
  media.camera = null;
  engines.length = 0;
});

afterEach(() => {
  resetSessionState();
  sessionStorage.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------

describe('mute before the engine exists (CALLS-1)', () => {
  it('applies the mute to the engine before the microphone is attached', async () => {
    const mic = deferred<unknown>();
    media.mic = mic.promise;
    useCalls.getState().setIncoming(incomingOf(call()));
    const p = acceptIncoming();
    await flush();
    toggleMute(); // "M" while the permission prompt is up
    expect(active()!.audioMuted).toBe(true);
    mic.resolve({ getAudioTracks: () => [new FakeTrack('audio')] });
    await flush();
    const e = engines[0]!;
    expect(e.log.slice(0, 2)).toEqual(['setMuted:true', 'setMicrophone']);
    const ack = takeAck('call:accept');
    expect(ack.payload.audioMuted).toBe(true);
    ack.resolve({ call: ongoing() });
    await p;
    expect(e.muted).toBe(true);
  });
});

describe('my own participant leaves on the server (CALLS-2)', () => {
  it('a call:updated showing me left ends the call locally', async () => {
    const group = call({
      isGroup: true,
      participants: [part(PEER, 'joined'), part(OTHER, 'joined'), part(ME, 'ringing')],
    });
    const joined = await inCall(
      group,
      ongoing({
        isGroup: true,
        participants: [part(PEER, 'joined'), part(OTHER, 'joined'), part(ME, 'joined')],
      }),
    );
    expect(active()!.phase).not.toBe('ended');
    bus.emit('call:updated', {
      call: {
        ...joined,
        participants: [part(PEER, 'joined'), part(OTHER, 'joined'), part(ME, 'left')],
      },
    });
    expect(active()!.phase).toBe('ended');
    expect(engines[0]!.closed).toBe(true);
  });
});

describe('hang up during accept (CALLS-3)', () => {
  it('declines when End is pressed while the media is still being acquired', async () => {
    const mic = deferred<unknown>();
    media.mic = mic.promise;
    useCalls.getState().setIncoming(incomingOf(call()));
    const p = acceptIncoming();
    await flush();
    leaveCall();
    expect(sentEvents()).toEqual(['call:leave', 'call:decline']);
    mic.resolve({ getAudioTracks: () => [new FakeTrack('audio')] });
    await p;
    await flush();
    expect(sock.pending.map((a) => a.event)).toEqual([]); // no call:accept after all
  });

  it('declines too when the accept ack is still pending', async () => {
    useCalls.getState().setIncoming(incomingOf(call()));
    const p = acceptIncoming();
    await flush();
    const ack = takeAck('call:accept');
    leaveCall();
    expect(sentEvents()).toEqual(['call:leave', 'call:decline']);
    ack.resolve({ call: ongoing() });
    await p;
    // Joined meanwhile: the leave is repeated from the (now bound) call socket.
    expect(sentEvents()).toEqual(['call:leave', 'call:decline', 'call:leave']);
  });
});

describe('lost acks (CALLS-4)', () => {
  it('a timeout on a live socket undoes a late accept (leave + decline)', async () => {
    useCalls.getState().setIncoming(incomingOf(call()));
    const p = acceptIncoming();
    await flush();
    takeAck('call:accept').reject(new ApiError('timeout', 'No response'));
    await p;
    expect(sentEvents()).toEqual(['call:leave', 'call:decline']);
    expect(active()).toBeNull();
  });

  it('an accept ack lost to a socket drop rejoins on the next ready when the server joined me', async () => {
    useCalls.getState().setIncoming(incomingOf(call()));
    const p = acceptIncoming();
    await flush();
    const ack = takeAck('call:accept');
    socketDown();
    ack.reject(new ApiError('timeout', 'socket has been disconnected'));
    await p;
    expect(active()!.phase).toBe('reconnecting');
    expect(sessionStorage.getItem('enbox.calls.current')).toContain('call-1');

    socketUp();
    const r = reconcile([ongoing()], { reconnect: true });
    await flush();
    takeAck('call:rejoin').resolve({ call: ongoing() });
    await r;
    expect(active()!.phase).not.toBe('ended');
    expect(active()!.phase).not.toBe('reconnecting');
  });

  it('an accept that never reached the server is redone on the next ready', async () => {
    useCalls.getState().setIncoming(incomingOf(call()));
    const p = acceptIncoming();
    await flush();
    const ack = takeAck('call:accept');
    socketDown();
    ack.reject(new ApiError('timeout', 'socket has been disconnected'));
    await p;
    // A call:updated before the reconcile (still ringing me) must not end it.
    socketUp();
    bus.emit('call:updated', { call: call() });
    expect(active()!.phase).not.toBe('ended');
    const r = reconcile([call()], { reconnect: true });
    await flush();
    takeAck('call:accept').resolve({ call: ongoing() });
    await r;
    expect(active()!.phase).not.toBe('ended');
  });

  it('a call:start ack lost offline adopts the call the server created', async () => {
    const r0 = startCall('chat-1', 'audio', undefined);
    await flush();
    const ack = takeAck('call:start');
    socketDown();
    ack.reject(new ApiError('timeout', 'socket has been disconnected'));
    await r0;
    expect(active()!.phase).toBe('reconnecting');
    socketUp();
    const mine = call({
      id: 'call-9',
      initiatorId: ME,
      participants: [part(ME, 'joined'), part(PEER, 'ringing')],
    });
    const r = reconcile([mine], { reconnect: true });
    await flush();
    const rejoin = takeAck('call:rejoin');
    expect(rejoin.payload.callId).toBe('call-9');
    rejoin.resolve({ call: mine });
    await r;
    expect(active()!.call.id).toBe('call-9');
    expect(active()!.phase).toBe('ringing');
  });
});

describe('page reload (CALLS-5)', () => {
  const navType = (type: string) =>
    vi
      .spyOn(performance, 'getEntriesByType')
      .mockReturnValue([{ type } as unknown as PerformanceEntry]);

  async function reloadWith(type: string) {
    await inCall();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false }));
    expect(sentEvents()).not.toContain('call:leave');
    const saved = sessionStorage.getItem('enbox.calls.current');
    expect(saved).toContain('call-1');
    // The new document: fresh module state, same sessionStorage.
    resetSessionState();
    sessionStorage.setItem('enbox.calls.current', saved!);
    sock.sent = [];
    navType(type);
  }

  it('pagehide keeps the call; the reloaded page rejoins it', async () => {
    await reloadWith('reload');
    const r = reconcile([ongoing()], { reconnect: false });
    await flush();
    const ack = takeAck('call:rejoin');
    ack.resolve({ call: ongoing() });
    await r;
    expect(active()!.call.id).toBe('call-1');
    expect(active()!.phase).not.toBe('ended');
  });

  it('a new navigation (not a reload) forgets the remembered call', async () => {
    await reloadWith('navigate');
    await reconcile([ongoing()], { reconnect: false });
    expect(sock.pending).toEqual([]);
    expect(active()).toBeNull();
    expect(sessionStorage.getItem('enbox.calls.current')).toBeNull();
  });

  it('retries call:rejoin while the server still sees the old socket (409)', async () => {
    await reloadWith('reload');
    vi.spyOn(api, 'get').mockResolvedValue([ongoing()] as never);
    const r = reconcile([ongoing()], { reconnect: false });
    await flush();
    takeAck('call:rejoin').reject(
      new ApiError('conflict', 'This call is active in another tab or on another device'),
    );
    await flush(30); // backoff (500 ms) runs on real timers
    await vi.waitFor(() => expect(sock.pending.map((a) => a.event)).toContain('call:rejoin'), {
      timeout: 2_000,
    });
    takeAck('call:rejoin').resolve({ call: ongoing() });
    await r;
    expect(active()!.phase).not.toBe('ended');
  });

  it('stops retrying once the server says I am no longer joined', async () => {
    await reloadWith('reload');
    vi.spyOn(api, 'get').mockResolvedValue([
      ongoing({ participants: [part(PEER, 'joined'), part(ME, 'left')] }),
    ] as never);
    const r = reconcile([ongoing()], { reconnect: false });
    await flush();
    takeAck('call:rejoin').reject(new ApiError('conflict', 'You are no longer in this call'));
    await vi.waitFor(() => expect(active()?.phase).toBe('ended'), { timeout: 2_000 });
    await r;
    expect(sock.pending).toEqual([]);
  });
});

describe('rejoin after a reconnect (CALLS-7)', () => {
  it('keeps reconnecting when the rejoin ack is lost to another drop', async () => {
    await inCall();
    socketDown();
    expect(active()!.phase).toBe('reconnecting');
    socketUp();
    const r1 = reconcile([ongoing()], { reconnect: true });
    await flush();
    expect(engines[0]!.log).toContain('refreshIce');
    const ack = takeAck('call:rejoin');
    socketDown();
    ack.reject(new ApiError('timeout', 'socket has been disconnected'));
    await r1;
    expect(active()!.phase).toBe('reconnecting');
    socketUp();
    const r2 = reconcile([ongoing()], { reconnect: true });
    await flush();
    takeAck('call:rejoin').resolve({ call: ongoing() });
    await r2;
    expect(active()!.phase).not.toBe('reconnecting');
    expect(active()!.phase).not.toBe('ended');
  });

  it('a second reconcile while connected does not rejoin again', async () => {
    await inCall();
    await reconcile([ongoing()], { reconnect: true });
    expect(sock.pending).toEqual([]);
  });
});

describe('late patches after the end (CALLS-9)', () => {
  it('the ended screen still clears when an invite ack lands after hanging up', async () => {
    const group = call({
      isGroup: true,
      participants: [part(PEER, 'joined'), part(OTHER, 'joined'), part(ME, 'ringing')],
    });
    const joined = await inCall(
      group,
      ongoing({
        isGroup: true,
        participants: [part(PEER, 'joined'), part(OTHER, 'joined'), part(ME, 'joined')],
      }),
    );
    vi.useFakeTimers();
    const inv = inviteToCall(['00000000-0000-4000-8000-0000000000dd']);
    const ack = takeAck('call:invite');
    leaveCall();
    expect(active()!.phase).toBe('ended');
    ack.resolve({ call: joined });
    await inv;
    await vi.advanceTimersByTimeAsync(3_000);
    expect(active()).toBeNull();
  });
});

describe('camera races (CALLS-10)', () => {
  it('a flip finishing after "camera off" does not turn the camera back on', async () => {
    const video = call({ type: 'video' });
    await inCall(video, ongoing({ type: 'video' }));
    expect(active()!.videoOff).toBe(false);
    const cam = deferred<unknown>();
    media.camera = cam.promise;
    const flip = flipCamera();
    await flush();
    await toggleVideo(); // camera off while the flip is still opening the other camera
    const late = new FakeTrack('video');
    cam.resolve(late);
    await flip;
    expect(active()!.videoOff).toBe(true);
    expect(engines[0]!.camera).toBeNull();
    expect(late.readyState).toBe('ended');
  });

  it('the newest of two quick camera toggles wins', async () => {
    await inCall(call({ type: 'video' }), ongoing({ type: 'video' }));
    await toggleVideo(); // off
    const first = deferred<unknown>();
    media.camera = first.promise;
    const on1 = toggleVideo(); // on (slow)
    await flush();
    const second = new FakeTrack('video');
    media.camera = Promise.resolve(second);
    // Still videoOff: a second "on" tap starts another capture.
    const on2 = toggleVideo();
    await on2;
    const stale = new FakeTrack('video');
    first.resolve(stale);
    await on1;
    expect(engines[0]!.camera).toBe(second);
    expect(stale.readyState).toBe('ended');
  });
});
