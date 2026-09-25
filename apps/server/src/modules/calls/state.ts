/**
 * In-memory live call state (per process; v1 assumes a single instance, see
 * docs/ARCHITECTURE.md "Calls"):
 * - tunable timings (ring timeout, reconnect grace) — overridable in tests;
 * - a per-call operation queue so accept/join/rejoin/leave/invite/timeouts of one call run
 *   one after the other in this process (the `calls` row lock serializes them in the DB, the
 *   queue additionally orders the post-commit socket bindings and timers);
 * - the call-socket binding of each joined participant (socket id ↔ rooms `call:<id>` and
 *   `call:<id>:<userId>`);
 * - ring-timeout and reconnect-grace timers (the calls job re-checks the DB as a safety net).
 */
import { CALL_RECONNECT_GRACE_MS, CALL_RING_TIMEOUT_MS, rooms } from '@enbox/shared';
import { getIo } from '../../realtime/emit.js';
import type { AppSocket, ServerEvent, ServerPayload } from '../../realtime/types.js';

// ---------------------------------------------------------------------------
// Timings
// ---------------------------------------------------------------------------

export interface CallTimings {
  /** An invitee rings this long (from `invited_at`) before becoming `missed`. */
  ringTimeoutMs: number;
  /** A disconnected call socket may be reclaimed with `call:rejoin` within this window. */
  reconnectGraceMs: number;
}

const DEFAULT_TIMINGS: Readonly<CallTimings> = Object.freeze({
  ringTimeoutMs: CALL_RING_TIMEOUT_MS,
  reconnectGraceMs: CALL_RECONNECT_GRACE_MS,
});

export const callTimings: CallTimings = { ...DEFAULT_TIMINGS };

/** Override timings (tests); call with no argument to restore the defaults. */
export function setCallTimings(patch: Partial<CallTimings> = { ...DEFAULT_TIMINGS }): void {
  Object.assign(callTimings, patch);
}

// ---------------------------------------------------------------------------
// Per-call operation queue
// ---------------------------------------------------------------------------

const queues = new Map<string, Promise<unknown>>();

/** Run `fn` after every previously queued operation of `callId` settled (in-process FIFO). */
export function withCallQueue<T>(callId: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(callId) ?? Promise.resolve();
  const run = prev.then(() => fn());
  const tail = run.then(
    () => undefined,
    () => undefined,
  );
  queues.set(callId, tail);
  void tail.then(() => {
    if (queues.get(callId) === tail) queues.delete(callId);
  });
  return run;
}

// ---------------------------------------------------------------------------
// Call-socket bindings
// ---------------------------------------------------------------------------

/** callId → userId → socket id of that participant's call socket. */
const byCall = new Map<string, Map<string, string>>();
/** socket id → callId → userId. */
const bySocket = new Map<string, Map<string, string>>();

function callRooms(callId: string, userId: string): string[] {
  return [rooms.call(callId), rooms.callMember(callId, userId)];
}

function forget(callId: string, userId: string, socketId: string): void {
  const users = byCall.get(callId);
  if (users?.get(userId) === socketId) {
    users.delete(userId);
    if (users.size === 0) byCall.delete(callId);
  }
  const calls = bySocket.get(socketId);
  if (calls?.get(callId) === userId) {
    calls.delete(callId);
    if (calls.size === 0) bySocket.delete(socketId);
  }
}

/** The socket id bound as `userId`'s call socket for `callId` (this process), if any. */
export function boundSocketId(callId: string, userId: string): string | undefined {
  return byCall.get(callId)?.get(userId);
}

/** Whether `socket` is `userId`'s call socket for `callId` (room-based, so it holds for this socket). */
export function isCallSocket(socket: AppSocket, callId: string, userId: string): boolean {
  return socket.rooms.has(rooms.callMember(callId, userId));
}

/** Make `socket` the call socket of `userId` (the previous one, if any, leaves the call rooms). */
export function bindCallSocket(callId: string, userId: string, socket: AppSocket): void {
  const prev = boundSocketId(callId, userId);
  if (prev && prev !== socket.id) releaseCallSocket(callId, userId);
  void socket.join(callRooms(callId, userId));
  let users = byCall.get(callId);
  if (!users) byCall.set(callId, (users = new Map()));
  users.set(userId, socket.id);
  let calls = bySocket.get(socket.id);
  if (!calls) bySocket.set(socket.id, (calls = new Map()));
  calls.set(callId, userId);
}

/** `userId`'s call socket (if any) leaves the call rooms and is unbound. */
export function releaseCallSocket(callId: string, userId: string): void {
  const socketId = boundSocketId(callId, userId);
  if (!socketId) return;
  getIo()?.in(socketId).socketsLeave(callRooms(callId, userId));
  forget(callId, userId, socketId);
}

/** Every call socket leaves the call rooms (call ended). */
export function releaseCall(callId: string): void {
  for (const userId of [...(byCall.get(callId)?.keys() ?? [])]) releaseCallSocket(callId, userId);
  getIo()?.in(rooms.call(callId)).socketsLeave(rooms.call(callId));
}

/**
 * A socket disconnected: drop its bindings (Socket.IO already removed it from its rooms) and
 * return the calls it was the call socket of.
 */
export function takeSocketBindings(socketId: string): { callId: string; userId: string }[] {
  const calls = bySocket.get(socketId);
  if (!calls) return [];
  const out = [...calls].map(([callId, userId]) => ({ callId, userId }));
  for (const { callId, userId } of out) forget(callId, userId, socketId);
  return out;
}

/** Emit to an arbitrary room (call rooms; emit.ts only covers user/chat/session/socket targets). */
export function emitToRoom<E extends ServerEvent>(room: string, event: E, payload: ServerPayload<E>): void {
  const io = getIo();
  if (!io) return;
  (io.to(room) as unknown as { emit: (event: string, payload: unknown) => boolean }).emit(event, payload);
}

// ---------------------------------------------------------------------------
// Timers
// ---------------------------------------------------------------------------

const ringTimers = new Map<string, NodeJS.Timeout>();
const graceTimers = new Map<string, NodeJS.Timeout>();
const graceKey = (callId: string, userId: string) => `${callId}|${userId}`;

/** (Re)schedule the ring-timeout check of a call at `atMs` (epoch ms). */
export function scheduleRingCheck(callId: string, atMs: number, fn: () => void): void {
  clearRingCheck(callId);
  const timer = setTimeout(
    () => {
      ringTimers.delete(callId);
      fn();
    },
    Math.max(0, atMs - Date.now()),
  );
  timer.unref();
  ringTimers.set(callId, timer);
}

export function clearRingCheck(callId: string): void {
  const timer = ringTimers.get(callId);
  if (timer) clearTimeout(timer);
  ringTimers.delete(callId);
}

/** Schedule the reconnect-grace expiry of one participant. */
export function scheduleGrace(callId: string, userId: string, delayMs: number, fn: () => void): void {
  clearGrace(callId, userId);
  const key = graceKey(callId, userId);
  const timer = setTimeout(() => {
    graceTimers.delete(key);
    fn();
  }, Math.max(0, delayMs));
  timer.unref();
  graceTimers.set(key, timer);
}

export function clearGrace(callId: string, userId: string): void {
  const key = graceKey(callId, userId);
  const timer = graceTimers.get(key);
  if (timer) clearTimeout(timer);
  graceTimers.delete(key);
}

/** Drop every timer of an ended call. */
export function clearCallTimers(callId: string): void {
  clearRingCheck(callId);
  const prefix = `${callId}|`;
  for (const [key, timer] of graceTimers) {
    if (key.startsWith(prefix)) {
      clearTimeout(timer);
      graceTimers.delete(key);
    }
  }
}

/** Forget all in-memory call state (tests). */
export function resetCallState(): void {
  for (const t of ringTimers.values()) clearTimeout(t);
  for (const t of graceTimers.values()) clearTimeout(t);
  ringTimers.clear();
  graceTimers.clear();
  byCall.clear();
  bySocket.clear();
  queues.clear();
}
