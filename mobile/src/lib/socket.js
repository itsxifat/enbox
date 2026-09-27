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
import { io } from 'socket.io-client';
import { create } from 'zustand';

import { ApiError } from './api';
import { AppState } from 'react-native';
import { getApiOrigin } from './env';

const initialConnection = {
  state: 'idle',
  ready: false,
  userId: null,
  sessionId: null,
  readyCount: 0,
  disconnectedAt: null,
  lastError: null,
};

export const useConnection = create(() => ({ ...initialConnection }));

let socket = null;
let socketToken = null;
let unauthorizedHandler = null;
const readyListeners = new Set();

/** Called when the server rejects the token (connect_error "unauthorized"). */
export function setSocketUnauthorizedHandler(fn) {
  unauthorizedHandler = fn;
}

/** Subscribe to every server `ready` (first connect + reconnects). Returns unsubscribe. */
export function onReady(fn) {
  readyListeners.add(fn);
  return () => {
    readyListeners.delete(fn);
  };
}

export function getSocket() {
  return socket;
}

export function isSocketConnected() {
  return !!socket?.connected;
}

let appStateSub = null;

/** Coming back to the foreground reconnects right away (Android pauses sockets in background). */
function onAppState(state) {
  if (state === 'active' && socket && !socket.connected && socketToken) socket.connect();
}

/**
 * Connect with the session token. Reuses the current socket when the token is unchanged.
 * `setup` is invoked synchronously with a new socket before it starts connecting.
 */
export function connectSocket(token, setup) {
  if (socket && socketToken === token) return socket;
  if (socket) disconnectSocket();

  const s = io(getApiOrigin() || undefined, {
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
    const info = { ...payload, reconnect: prev.readyCount > 0 };
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

  appStateSub?.remove();
  appStateSub = AppState.addEventListener('change', onAppState);

  setup?.(s);
  s.connect();
  return s;
}

/** Close the socket and forget all its handlers. */
export function disconnectSocket() {
  appStateSub?.remove();
  appStateSub = null;
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

/** Client events whose last argument is an ack callback. */
/** Fire-and-forget client events (no ack). */
/** The `data` type of an ack event, e.g. `AckResult<'call:start'>` = `{ call: Call }`. */
/**
 * Emit an event that expects an `Ack<T>` and resolve with `T`.
 * Rejects with `ApiError` (`code` from the server, or `network_error` / `timeout`).
 */
export function emitWithAck(event, payload, timeoutMs = 10_000) {
  const s = socket;
  if (!s || !s.connected) {
    return Promise.reject(new ApiError('network_error', 'Not connected'));
  }
  return new Promise((resolve, reject) => {
    // socket.io's timeout() typing doesn't compose with a generic event name; the
    // contract types above keep the public signature exact.
    const emitter = s.timeout(timeoutMs);
    emitter.emit(event, payload, (err, res) => {
      if (err) {
        reject(new ApiError('timeout', `No response to "${event}"`));
        return;
      }
      const ack = res;
      if (!ack || typeof ack !== 'object') {
        reject(new ApiError('bad_response', `Invalid ack for "${event}"`));
      } else if (ack.ok) {
        resolve(ack.data);
      } else {
        reject(new ApiError(ack.error.code, ack.error.message, 0, ack.error.details));
      }
    });
  });
}

/** Emit a fire-and-forget event. Returns false (and drops it) when disconnected. */
export function sendEvent(event, payload) {
  const s = socket;
  if (!s || !s.connected) return false;
  s.emit(event, payload);
  return true;
}
