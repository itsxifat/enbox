/**
 * Cluster-wide online/idle registry (docs "Cluster" → "Presence"). Pure: the transport and the
 * clock are injected, so tests can wire several registries together in one process.
 *
 * Each node counts its OWN sockets (counted = rooms joined, see realtime/io.ts) and their idle
 * flags, publishes its per-user counts as deltas, and keeps a replica of every other node's
 * counts. A user is online while any node counts a socket of theirs; auto-idle while every
 * counted socket in the cluster is idle. Every GLOBAL transition fires `presenceEvents` on
 * every node ('online', 'offline' with the last-seen time, 'activity' for idle flips), so each
 * node re-evaluates its own presence subscribers.
 *
 * Replicas converge through snapshots: a node that (re)joins says hello and every node
 * answers with its full counts; a node that is not heard from for the TTL (or says bye) is
 * dropped, and the users only it counted go offline.
 */
import type { EventEmitter } from 'node:events';
import type { BusTopics, PresenceEntry } from './bus.js';

export interface PresenceEvents {
  online: [userId: string];
  offline: [userId: string, lastSeenAt: Date];
  /** The user's auto-idle state (every counted socket idle) flipped while online. */
  activity: [userId: string];
  /**
   * These users went offline because the node counting them vanished (crash, or a shutdown's
   * bye): nobody recorded their disconnect, so the listener writes their last-seen time.
   */
  lost: [userIds: string[], lastSeenAt: Date];
}

/** Sends to the OTHER nodes (this node's state is applied locally before publishing). */
export interface PresenceTransport {
  publish<K extends keyof BusTopics>(topic: K, data: BusTopics[K]): void;
}

interface Counts {
  sockets: number;
  idle: number;
}

interface RemoteNode {
  /** Last time anything was heard from the node (epoch ms). */
  seenAt: number;
  users: Map<string, Counts>;
}

interface UserState {
  online: boolean;
  idle: boolean;
}

export class PresenceRegistry {
  /** userId → this node's counted socket ids. */
  private readonly local = new Map<string, Set<string>>();
  /** This node's counted sockets whose device reported itself idle. */
  private readonly idleSockets = new Set<string>();
  /** nodeId → replica of that node's counts. */
  private readonly nodes = new Map<string, RemoteNode>();

  constructor(
    readonly nodeId: string,
    private readonly transport: PresenceTransport,
    private readonly events: EventEmitter<PresenceEvents>,
    private readonly now: () => number = Date.now,
  ) {}

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  isOnline(userId: string): boolean {
    if ((this.local.get(userId)?.size ?? 0) > 0) return true;
    for (const node of this.nodes.values()) if (node.users.has(userId)) return true;
    return false;
  }

  /** Every counted socket of the user in the cluster is idle (false when offline). */
  autoIdle(userId: string): boolean {
    return this.state(userId).idle;
  }

  onlineUserIds(): string[] {
    const ids = new Set(this.local.keys());
    for (const node of this.nodes.values()) for (const id of node.users.keys()) ids.add(id);
    return [...ids];
  }

  /** Nodes this one currently has a replica of (tests, diagnostics). */
  knownNodes(): string[] {
    return [...this.nodes.keys()];
  }

  private localCounts(userId: string): Counts {
    const mine = this.local.get(userId);
    if (!mine) return { sockets: 0, idle: 0 };
    let idle = 0;
    for (const id of mine) if (this.idleSockets.has(id)) idle += 1;
    return { sockets: mine.size, idle };
  }

  private state(userId: string): UserState {
    const c = this.localCounts(userId);
    let { sockets, idle } = c;
    for (const node of this.nodes.values()) {
      const r = node.users.get(userId);
      if (r) {
        sockets += r.sockets;
        idle += r.idle;
      }
    }
    return { online: sockets > 0, idle: sockets > 0 && idle === sockets };
  }

  private transition(userId: string, before: UserState, at: Date): void {
    const after = this.state(userId);
    if (!before.online && after.online) this.events.emit('online', userId);
    else if (before.online && !after.online) this.events.emit('offline', userId, at);
    else if (after.online && before.idle !== after.idle) this.events.emit('activity', userId);
  }

  // -------------------------------------------------------------------------
  // This node's sockets
  // -------------------------------------------------------------------------

  /** Count `socketId` for the user (it starts active). */
  markConnected(userId: string, socketId: string): void {
    const before = this.state(userId);
    let mine = this.local.get(userId);
    if (!mine) this.local.set(userId, (mine = new Set()));
    if (mine.has(socketId)) return;
    mine.add(socketId);
    this.idleSockets.delete(socketId);
    this.publishCounts(userId, null);
    this.transition(userId, before, new Date(this.now()));
  }

  /**
   * Uncount `socketId` (its idle flag goes with it). Returns true when it was the user's
   * last socket ON THIS NODE (the caller records the last-seen time); whether the user went
   * offline cluster-wide is reported through `presenceEvents`.
   */
  markDisconnected(userId: string, socketId: string, at = new Date(this.now())): boolean {
    const mine = this.local.get(userId);
    if (!mine?.has(socketId)) return false;
    const before = this.state(userId);
    mine.delete(socketId);
    this.idleSockets.delete(socketId);
    const lastLocal = mine.size === 0;
    if (lastLocal) this.local.delete(userId);
    this.publishCounts(userId, lastLocal ? at : null);
    this.transition(userId, before, at);
    return lastLocal;
  }

  /**
   * `presence:activity`: record the device's idle state. Ignored unless the socket is counted
   * for the user. Returns true when the user's cluster-wide auto-idle state changed.
   */
  setSocketIdle(userId: string, socketId: string, idle: boolean): boolean {
    if (!this.local.get(userId)?.has(socketId)) return false;
    if (this.idleSockets.has(socketId) === idle) return false;
    const before = this.state(userId);
    if (idle) this.idleSockets.add(socketId);
    else this.idleSockets.delete(socketId);
    this.publishCounts(userId, null);
    this.transition(userId, before, new Date(this.now()));
    return this.state(userId).idle !== before.idle;
  }

  private publishCounts(userId: string, lastSeenAt: Date | null): void {
    const c = this.localCounts(userId);
    this.transport.publish('presence:delta', {
      userId,
      sockets: c.sockets,
      idle: c.idle,
      lastSeenAt: lastSeenAt?.toISOString() ?? null,
    });
  }

  /** Every user this node counts, for a snapshot. */
  snapshot(): PresenceEntry[] {
    return [...this.local.keys()].map((userId) => {
      const c = this.localCounts(userId);
      return [userId, c.sockets, c.idle];
    });
  }

  /** (Re)join: ask every node for its snapshot and send ours (startup, bus reconnect). */
  announce(): void {
    this.transport.publish('presence:hello', {});
    this.transport.publish('presence:snapshot', { entries: this.snapshot(), to: null });
  }

  /** Liveness tick: tell the others we are here, drop nodes not heard from within `ttlMs`. */
  tick(ttlMs: number): void {
    this.transport.publish('presence:beat', {});
    const cutoff = this.now() - ttlMs;
    for (const [id, node] of [...this.nodes]) if (node.seenAt < cutoff) this.dropNode(id);
  }

  // -------------------------------------------------------------------------
  // Other nodes
  // -------------------------------------------------------------------------

  private touch(nodeId: string): RemoteNode {
    let node = this.nodes.get(nodeId);
    if (!node) this.nodes.set(nodeId, (node = { seenAt: this.now(), users: new Map() }));
    node.seenAt = this.now();
    return node;
  }

  onDelta(from: string, d: BusTopics['presence:delta']): void {
    if (from === this.nodeId) return;
    const node = this.touch(from);
    const before = this.state(d.userId);
    if (d.sockets > 0)
      node.users.set(d.userId, { sockets: d.sockets, idle: Math.min(d.idle, d.sockets) });
    else node.users.delete(d.userId);
    this.transition(d.userId, before, d.lastSeenAt ? new Date(d.lastSeenAt) : new Date(this.now()));
  }

  onSnapshot(from: string, s: BusTopics['presence:snapshot']): void {
    if (from === this.nodeId || (s.to !== null && s.to !== this.nodeId)) return;
    const node = this.touch(from);
    const next = new Map<string, Counts>();
    for (const [userId, sockets, idle] of s.entries)
      if (sockets > 0) next.set(userId, { sockets, idle: Math.min(idle, sockets) });
    const affected = new Set([...node.users.keys(), ...next.keys()]);
    const before = new Map([...affected].map((u) => [u, this.state(u)] as const));
    node.users = next;
    const at = new Date(this.now());
    for (const [userId, state] of before) this.transition(userId, state, at);
  }

  onHello(from: string): void {
    if (from === this.nodeId) return;
    this.touch(from);
    this.transport.publish('presence:snapshot', { entries: this.snapshot(), to: from });
  }

  onBeat(from: string): void {
    if (from === this.nodeId) return;
    const known = this.nodes.has(from);
    this.touch(from);
    // A node we have no replica of (we missed its hello): ask everyone for snapshots.
    if (!known) this.transport.publish('presence:hello', {});
  }

  onBye(from: string): void {
    if (from !== this.nodeId) this.dropNode(from);
  }

  /** Forget a node; the users only it counted go offline (last seen = when it was last heard). */
  dropNode(nodeId: string): string[] {
    const node = this.nodes.get(nodeId);
    if (!node) return [];
    const before = [...node.users.keys()].map((u) => [u, this.state(u)] as const);
    this.nodes.delete(nodeId);
    const at = new Date(node.seenAt);
    const wentOffline: string[] = [];
    for (const [userId, state] of before) {
      this.transition(userId, state, at);
      if (state.online && !this.isOnline(userId)) wentOffline.push(userId);
    }
    if (wentOffline.length) this.events.emit('lost', wentOffline, at);
    return wentOffline;
  }

  reset(): void {
    this.local.clear();
    this.idleSockets.clear();
    this.nodes.clear();
  }
}
