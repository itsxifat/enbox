/**
 * The single typed Socket.IO connection.
 *
 * - `connectSocket(token, setup?)` creates (or reuses) the socket; `setup` runs before the
 *   connection opens so handlers can be attached first (see src/realtime/).
 * - `emitWithAck('presence:subscribe', { userIds })` → Promise of the ack's `data`
 *   (rejects with `ApiError` on `{ ok: false }`, timeout or when disconnected).
 * - `sendEvent('chat:typing', { chatId, state })` fire-and-forget; returns false offline.
 * - `useConnection` is a tiny zustand store with the connection state for banners.
 * - `onReady(fn)` runs on every server `ready` (first connect and each reconnect) —
 *   use it (or the `realtime:ready` bus event) to resync.
 *
 * Feature code must not create sockets; subscribe to server events in `src/realtime/<domain>.ts`.
 */
import { io, type Socket } from 'socket.io-client';
import { create } from 'zustand';
import type { Ack, AckFn, ClientToServerEvents, ID, ServerToClientEvents } from '@enbox/shared';
import { ApiError } from './api';
import { SOCKET_ORIGIN } from './env';

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'disconnected';

export interface ConnectionStore {
  /** idle = no session; connecting = first connect or retrying; disconnected = dropped. */
  state: ConnectionState;
  /** The server sent `ready` on the current connection (rooms joined). */
  ready: boolean;
  userId: ID | null;
  /** This device's session id (from `ready`). */
  sessionId: ID | null;
  /** Number of `ready`s received since the socket was created. */
  readyCount: number;
  /** Epoch ms when the connection dropped (null while connected). */
  disconnectedAt: number | null;
  lastError: string | null;
}

const initialConnection: ConnectionStore = {
  state: 'idle',
  ready: false,
  userId: null,
  sessionId: null,
  readyCount: 0,
  disconnectedAt: null,
  lastError: null,
};

export const useConnection = create<ConnectionStore>(() => ({ ...initialConnection }));

export interface ReadyInfo {
  userId: ID;
  sessionId: ID;
  serverTime: string;
  /** False for the first `ready` of this socket, true after reconnects. */
  reconnect: boolean;
}

let socket: AppSocket | null = null;
let socketToken: string | null = null;
let unauthorizedHandler: (() => void) | null = null;
const readyListeners = new Set<(info: ReadyInfo) => void>();

/** Called when the server rejects the token (connect_error "unauthorized"). */
export function setSocketUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

/** Subscribe to every server `ready` (first connect + reconnects). Returns unsubscribe. */
export function onReady(fn: (info: ReadyInfo) => void): () => void {
  readyListeners.add(fn);
  return () => {
    readyListeners.delete(fn);
  };
}

export function getSocket(): AppSocket | null {
  return socket;
}

export function isSocketConnected(): boolean {
  return !!socket?.connected;
}

function onVisible() {
  if (document.visibilityState === 'visible' && socket && !socket.connected && socketToken) {
    socket.connect();
  }
}

/**
 * Connect with the session token. Reuses the current socket when the token is unchanged.
 * `setup` is invoked synchronously with a new socket before it starts connecting.
 */
export function connectSocket(token: string, setup?: (socket: AppSocket) => void): AppSocket {
  if (socket && socketToken === token) return socket;
  if (socket) disconnectSocket();

  const s: AppSocket = io(SOCKET_ORIGIN, {
    path: '/socket.io',
    autoConnect: false,
    auth: { token },
    // WebSocket first (no sticky sessions needed when scaled out), long-polling fallback.
    transports: ['websocket', 'polling'],
    tryAllTransports: true,
    reconnectionDelay: 1_000,
    reconnectionDelayMax: 10_000,
  });
  socket = s;
  socketToken = token;
  useConnection.setState({ ...initialConnection, state: 'connecting' });

  s.on('connect', () => {
    useConnection.setState({
      state: 'connected',
      disconnectedAt: null,
      lastError: null,
      ready: false,
    });
  });
  s.on('ready', (payload) => {
    const prev = useConnection.getState();
    useConnection.setState({
      ready: true,
      userId: payload.userId,
      sessionId: payload.sessionId,
      readyCount: prev.readyCount + 1,
    });
    const info: ReadyInfo = { ...payload, reconnect: prev.readyCount > 0 };
    for (const fn of [...readyListeners]) {
      try {
        fn(info);
      } catch (e) {
        console.error('[socket] ready listener failed', e);
      }
    }
  });
  s.on('disconnect', (reason) => {
    useConnection.setState((st) => ({
      state: 'disconnected',
      ready: false,
      disconnectedAt: st.disconnectedAt ?? Date.now(),
    }));
    // A server-side disconnect is not retried automatically by socket.io.
    if (reason === 'io server disconnect' && socket === s) {
      setTimeout(() => {
        if (socket === s && !s.connected) s.connect();
      }, 1_500);
    }
  });
  s.on('connect_error', (err) => {
    if (err.message === 'unauthorized') {
      useConnection.setState({ state: 'disconnected', lastError: 'unauthorized' });
      unauthorizedHandler?.();
      return;
    }
    useConnection.setState((st) => ({
      state: s.active ? 'connecting' : 'disconnected',
      lastError: err.message,
      disconnectedAt: st.disconnectedAt ?? Date.now(),
    }));
  });
  s.io.on('reconnect_attempt', () => {
    useConnection.setState({ state: 'connecting' });
  });

  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);

  setup?.(s);
  s.connect();
  return s;
}

/** Close the socket and forget all its handlers. */
export function disconnectSocket(): void {
  document.removeEventListener('visibilitychange', onVisible);
  window.removeEventListener('online', onVisible);
  const s = socket;
  socket = null;
  socketToken = null;
  if (s) {
    s.removeAllListeners();
    s.io.removeAllListeners();
    s.disconnect();
  }
  useConnection.setState({ ...initialConnection });
}

// ---------------------------------------------------------------------------
// Typed emit helpers
// ---------------------------------------------------------------------------

type EventName = keyof ClientToServerEvents;

/** Client events whose last argument is an ack callback. */
export type AckEventName = {
  [K in EventName]: Parameters<ClientToServerEvents[K]> extends [unknown, (res: never) => void]
    ? K
    : never;
}[EventName];

/** Fire-and-forget client events (no ack). */
export type PlainEventName = Exclude<EventName, AckEventName>;

export type EventPayload<E extends EventName> = Parameters<ClientToServerEvents[E]>[0];

/** The `data` type of an ack event, e.g. `AckResult<'call:start'>` = `{ call: Call }`. */
export type AckResult<E extends AckEventName> =
  Parameters<ClientToServerEvents[E]>[1] extends AckFn<infer T> ? T : never;

type LooseEmitter = {
  emit(event: string, payload: unknown, ack?: (err: Error | null, res: unknown) => void): void;
};

/**
 * Emit an event that expects an `Ack<T>` and resolve with `T`.
 * Rejects with `ApiError` (`code` from the server, or `network_error` / `timeout`).
 */
export function emitWithAck<E extends AckEventName>(
  event: E,
  payload: EventPayload<E>,
  timeoutMs = 10_000,
): Promise<AckResult<E>> {
  const s = socket;
  if (!s || !s.connected) {
    return Promise.reject(new ApiError('network_error', 'Not connected'));
  }
  return new Promise<AckResult<E>>((resolve, reject) => {
    // socket.io's timeout() typing doesn't compose with a generic event name; the
    // contract types above keep the public signature exact.
    const emitter = s.timeout(timeoutMs) as unknown as LooseEmitter;
    emitter.emit(event, payload, (err, res) => {
      if (err) {
        reject(new ApiError('timeout', `No response to "${event}"`));
        return;
      }
      const ack = res as Ack<AckResult<E>> | null | undefined;
      if (!ack || typeof ack !== 'object') {
        reject(new ApiError('bad_response', `Invalid ack for "${event}"`));
      } else if (ack.ok) {
        resolve(ack.data);
      } else {
        reject(new ApiError(ack.error.code, ack.error.message));
      }
    });
  });
}

/** Emit a fire-and-forget event. Returns false (and drops it) when disconnected. */
export function sendEvent<E extends PlainEventName>(event: E, payload: EventPayload<E>): boolean {
  const s = socket;
  if (!s || !s.connected) return false;
  (s as unknown as LooseEmitter).emit(event, payload);
  return true;
}
