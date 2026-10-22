/**
 * Presence bookkeeping for this process.
 *
 * 1. Online state: cluster-wide (cluster/presenceRegistry.ts). This node counts its own
 *    sockets (io.ts counts a socket once its rooms are joined) and replicates every other
 *    node's counts over the cluster bus; a user is online while any node counts a socket.
 * 2. Idle: a flag per counted socket, set by `presence:activity` (a device with no input for
 *    PRESENCE_IDLE_AFTER_MS, or hidden). The user is auto-idle when EVERY counted socket in
 *    the cluster is idle; a fresh socket starts active. Flags are ignored until the socket
 *    counts and dropped with it.
 * 3. Subscriptions (this node only): presence is NOT room-based. Each socket subscribes to
 *    subjects (`presence:subscribe`); the users module evaluates the subject's privacy PER
 *    VIEWER at subscribe time and at every emit, and emits `presence:update` to each
 *    subscribing socket individually (`emitToSocket`). Subscriptions die with the socket;
 *    clients re-subscribe after reconnecting. Every node re-evaluates its own subscribers:
 *    `presenceEvents` fire on every node for every global transition.
 */
import { EventEmitter } from 'node:events';
import { MAX_PRESENCE_SUBSCRIPTIONS } from '@enbox/shared';
import { onBus, onBusReconnect, publishRemote } from '../cluster/bus.js';
import { CLUSTER_HEARTBEAT_MS, CLUSTER_NODE_TTL_MS } from '../cluster/constants.js';
import { NODE_ID } from '../cluster/node.js';
import { PresenceRegistry, type PresenceEvents } from '../cluster/presenceRegistry.js';

export type { PresenceEvents };

/**
 * Emits 'online' when a user's first socket in the cluster connects, 'offline' when the last
 * one disconnects, 'activity' when their auto-idle state changes in between and 'lost' when a
 * vanished node took the last sockets of some users with it. Fired on EVERY node.
 */
export const presenceEvents = new EventEmitter<PresenceEvents>();

const registry = new PresenceRegistry(NODE_ID, { publish: publishRemote }, presenceEvents);

onBus('presence:delta', (d, from) => registry.onDelta(from, d));
onBus('presence:snapshot', (s, from) => registry.onSnapshot(from, s));
onBus('presence:hello', (_d, from) => registry.onHello(from));
onBus('presence:beat', (_d, from) => registry.onBeat(from));
onBus('presence:bye', (_d, from) => registry.onBye(from));
// Deltas may have been lost while the bus was down: resynchronise both ways.
onBusReconnect(() => registry.announce());

let ticker: NodeJS.Timeout | undefined;

/** Join the cluster's presence (after the bus connected): snapshots both ways, then beats. */
export function startPresenceReplication(): void {
  registry.announce();
  ticker ??= setInterval(() => registry.tick(CLUSTER_NODE_TTL_MS), CLUSTER_HEARTBEAT_MS);
  ticker.unref();
}

/** Leave the cluster's presence (shutdown): the others drop our users at once. */
export function stopPresenceReplication(): void {
  if (ticker) clearInterval(ticker);
  ticker = undefined;
  publishRemote('presence:bye', {});
}

export function isOnline(userId: string): boolean {
  return registry.isOnline(userId);
}

export function onlineUserIds(): string[] {
  return registry.onlineUserIds();
}

/** Every counted socket of the user (cluster-wide) reported itself idle (false when offline). */
export function autoIdle(userId: string): boolean {
  return registry.autoIdle(userId);
}

/** Count `socketId` for the user (it starts active); transitions fire `presenceEvents`. */
export function markConnected(userId: string, socketId: string): void {
  registry.markConnected(userId, socketId);
}

/**
 * Uncount `socketId` (its idle flag goes with it). Returns true when it was the user's last
 * socket on THIS node (record the last-seen time); a cluster-wide offline fires `offline`.
 */
export function markDisconnected(userId: string, socketId: string, at?: Date): boolean {
  return registry.markDisconnected(userId, socketId, at);
}

/**
 * `presence:activity`: record the device's idle state. Ignored (returns false) unless the
 * socket is counted for the user. Returns true when the user's auto-idle state changed (the
 * `activity` event has fired by then).
 */
export function setSocketIdle(userId: string, socketId: string, idle: boolean): boolean {
  return registry.setSocketIdle(userId, socketId, idle);
}

/** The presence registry (tests). */
export function presenceRegistry(): PresenceRegistry {
  return registry;
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
  registry.reset();
  subscribers.clear();
  bySocket.clear();
  viewerOf.clear();
}
