/**
 * Presence bookkeeping for this process.
 *
 * 1. Online state: connection counts. A user is online while at least one of their sockets
 *    is connected. (With multiple instances behind the Redis adapter this is per-instance —
 *    a shared counter is out of scope for v1; see docs/ARCHITECTURE.md.)
 * 2. Subscriptions: presence is NOT room-based. Each socket subscribes to subjects
 *    (`presence:subscribe`); the users module evaluates the subject's privacy PER VIEWER at
 *    subscribe time and at every emit, and emits `presence:update` to each subscribing
 *    socket individually (`emitToSocket`). Subscriptions die with the socket; clients
 *    re-subscribe after reconnecting.
 */
import { EventEmitter } from 'node:events';
import { MAX_PRESENCE_SUBSCRIPTIONS } from '@enbox/shared';

const counts = new Map<string, number>();

export interface PresenceEvents {
  online: [userId: string];
  offline: [userId: string, lastSeenAt: Date];
}

/** Emits 'online' when a user's first socket connects and 'offline' when the last one disconnects. */
export const presenceEvents = new EventEmitter<PresenceEvents>();

export function isOnline(userId: string): boolean {
  return (counts.get(userId) ?? 0) > 0;
}

export function onlineUserIds(): string[] {
  return [...counts.keys()];
}

/** Returns true if the user just came online. */
export function markConnected(userId: string): boolean {
  const n = (counts.get(userId) ?? 0) + 1;
  counts.set(userId, n);
  return n === 1;
}

/** Returns true if the user just went offline. */
export function markDisconnected(userId: string): boolean {
  const n = (counts.get(userId) ?? 0) - 1;
  if (n <= 0) {
    counts.delete(userId);
    return true;
  }
  counts.set(userId, n);
  return false;
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
export function addPresenceSubscriptions(socketId: string, viewerId: string, subjectIds: Iterable<string>): string[] {
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
  counts.clear();
  subscribers.clear();
  bySocket.clear();
  viewerOf.clear();
}
