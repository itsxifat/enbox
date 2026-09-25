/**
 * Connection-count based presence for this process. A user is online while at least one of
 * their sockets is connected. (With multiple server instances behind the Redis adapter this
 * is per-instance; see docs/ARCHITECTURE.md.)
 */
import { EventEmitter } from 'node:events';

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

export function resetPresence() {
  counts.clear();
}
