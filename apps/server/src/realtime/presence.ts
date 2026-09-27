/**
 * Presence bookkeeping for this process.
 *
 * 1. Online state: the counted sockets per user. A user is online while at least one of
 *    their sockets is connected (and counted: io.ts counts a socket once its rooms are
 *    joined). (With multiple instances behind the Redis adapter this is per-instance — a
 *    shared registry is out of scope for v1; see docs/ARCHITECTURE.md.)
 * 2. Idle: a flag per counted socket, set by `presence:activity` (a device with no input for
 *    PRESENCE_IDLE_AFTER_MS, or hidden). The user is auto-idle when EVERY counted socket is
 *    idle; a fresh socket starts active. Flags are ignored until the socket counts and
 *    dropped with it.
 * 3. Subscriptions: presence is NOT room-based. Each socket subscribes to subjects
 *    (`presence:subscribe`); the users module evaluates the subject's privacy PER VIEWER at
 *    subscribe time and at every emit, and emits `presence:update` to each subscribing
 *    socket individually (`emitToSocket`). Subscriptions die with the socket; clients
 *    re-subscribe after reconnecting.
 */
import { EventEmitter } from 'node:events';
import { MAX_PRESENCE_SUBSCRIPTIONS } from '@enbox/shared';

/** userId → counted socket ids (online = at least one). */
const countedSockets = new Map<string, Set<string>>();
/** Counted socket ids whose device reported itself idle. */
const socketIdle = new Set<string>();

export interface PresenceEvents {
  online: [userId: string];
  offline: [userId: string, lastSeenAt: Date];
  /** The user's auto-idle state (every counted socket idle) flipped. */
  activity: [userId: string];
}

/**
 * Emits 'online' when a user's first socket connects, 'offline' when the last one
 * disconnects and 'activity' when their auto-idle state changes in between.
 */
export const presenceEvents = new EventEmitter<PresenceEvents>();

export function isOnline(userId: string): boolean {
  return (countedSockets.get(userId)?.size ?? 0) > 0;
}

export function onlineUserIds(): string[] {
  return [...countedSockets.keys()];
}

/** Every counted socket of the user reported itself idle (false when offline). */
export function autoIdle(userId: string): boolean {
  const mine = countedSockets.get(userId);
  if (!mine || mine.size === 0) return false;
  for (const socketId of mine) if (!socketIdle.has(socketId)) return false;
  return true;
}

/** Count `socketId` for the user (it starts active). Returns true if the user just came online. */
export function markConnected(userId: string, socketId: string): boolean {
  let mine = countedSockets.get(userId);
  if (!mine) countedSockets.set(userId, (mine = new Set()));
  mine.add(socketId);
  return mine.size === 1;
}

/** Uncount `socketId` (its idle flag goes with it). Returns true if the user just went offline. */
export function markDisconnected(userId: string, socketId: string): boolean {
  socketIdle.delete(socketId);
  const mine = countedSockets.get(userId);
  if (!mine) return true;
  mine.delete(socketId);
  if (mine.size > 0) return false;
  countedSockets.delete(userId);
  return true;
}

/**
 * `presence:activity`: record the device's idle state. Ignored (returns false) unless the
 * socket is counted for the user. Returns true when the user's auto-idle state changed.
 */
export function setSocketIdle(userId: string, socketId: string, idle: boolean): boolean {
  if (!countedSockets.get(userId)?.has(socketId)) return false;
  const before = autoIdle(userId);
  if (idle) socketIdle.add(socketId);
  else socketIdle.delete(socketId);
  return autoIdle(userId) !== before;
}

// ---------------------------------------------------------------------------
// Per-socket subscriptions: subjectId → subscribing socket ids (+ reverse index)
// ---------------------------------------------------------------------------

const subscribers = new Map<string, Set<string>>();
const bySocket = new Map<string, Set<string>>();
/** socketId → the subscribing (viewer) user id. */
const viewerOf = new Map<string, string>();

/**
 * Record that `socketId` watches these subjects (call after the privacy check). Ids beyond
 * MAX_PRESENCE_SUBSCRIPTIONS per socket are ignored. Returns the ids actually subscribed.
 */
export function addPresenceSubscriptions(
  socketId: string,
  viewerId: string,
  subjectIds: Iterable<string>,
): string[] {
  viewerOf.set(socketId, viewerId);
  let mine = bySocket.get(socketId);
  if (!mine) bySocket.set(socketId, (mine = new Set()));
  const added: string[] = [];
  for (const id of subjectIds) {
    if (!mine.has(id)) {
      if (mine.size >= MAX_PRESENCE_SUBSCRIPTIONS) continue;
      mine.add(id);
      let set = subscribers.get(id);
      if (!set) subscribers.set(id, (set = new Set()));
      set.add(socketId);
    }
    added.push(id);
  }
  return added;
}

export function removePresenceSubscriptions(socketId: string, subjectIds: Iterable<string>): void {
  const mine = bySocket.get(socketId);
  if (!mine) return;
  for (const id of subjectIds) {
    if (!mine.delete(id)) continue;
    const set = subscribers.get(id);
    set?.delete(socketId);
    if (set && set.size === 0) subscribers.delete(id);
  }
  if (mine.size === 0) {
    bySocket.delete(socketId);
    viewerOf.delete(socketId);
  }
}

/** Drop every subscription of a socket (on disconnect). */
export function dropPresenceSocket(socketId: string): void {
  const mine = bySocket.get(socketId);
  if (mine) removePresenceSubscriptions(socketId, [...mine]);
}

/** Sockets currently subscribed to `subjectId`, with their viewer (evaluate privacy per viewer before emitting). */
export function presenceSubscribers(subjectId: string): { socketId: string; viewerId: string }[] {
  const out: { socketId: string; viewerId: string }[] = [];
  for (const socketId of subscribers.get(subjectId) ?? []) {
    const viewerId = viewerOf.get(socketId);
    if (viewerId) out.push({ socketId, viewerId });
  }
  return out;
}

export function resetPresence() {
  countedSockets.clear();
  socketIdle.clear();
  subscribers.clear();
  bySocket.clear();
  viewerOf.clear();
}
