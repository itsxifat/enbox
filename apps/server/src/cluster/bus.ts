/**
 * Cluster bus: typed fire-and-forget messages between Enbox processes (docs "Cluster").
 *
 *   onBus('sessions:invalidate', ({ sessionIds }) => dropCached(sessionIds));
 *   publish('sessions:invalidate', { sessionIds });   // this process AND every other one
 *
 * `publish` runs this process's handlers synchronously, then (when REDIS_URL is set) sends
 * the message to every other process over Valkey/Redis pub/sub; `publishRemote` skips the
 * local handlers. Without REDIS_URL the process is a cluster of one and only local handlers
 * run. Delivery is at-most-once and NOT ordered relative to Socket.IO broadcasts (they use
 * other connections), so every consumer must be idempotent, versioned or re-check the
 * database. Messages from this process that come back through Redis are dropped.
 */
import { logger } from '../lib/logger.js';
import { NODE_ID } from './node.js';
import { createRedis, type RedisClient } from './redis.js';

/** One snapshot entry: [userId, counted sockets on the sender, of which idle]. */
export type PresenceEntry = [userId: string, sockets: number, idle: number];

export interface BusTopics {
  /** The sender's counts for one user changed (`sockets` 0 = none left there). */
  'presence:delta': { userId: string; sockets: number; idle: number; lastSeenAt: string | null };
  /** Every user the sender counts; `to` = only that node applies it (answer to a hello). */
  'presence:snapshot': { entries: PresenceEntry[]; to: string | null };
  /** The sender (re)joined the bus: everyone answers with a snapshot `to` it. */
  'presence:hello': Record<string, never>;
  /** Liveness of the sender's presence replica (CLUSTER_HEARTBEAT_MS). */
  'presence:beat': Record<string, never>;
  /** The sender is shutting down: drop its users now instead of after the TTL. */
  'presence:bye': Record<string, never>;
  /** Re-evaluate `subjectId` for the subscribers of every node (privacy/state changed). */
  'presence:reevaluate': { subjectId: string; lastSeenAt: string | null };
  /** Revoked sessions: drop them from every node's token cache. */
  'sessions:invalidate': { sessionIds: string[] };
}

export type BusTopic = keyof BusTopics;
type Handler<K extends BusTopic> = (data: BusTopics[K], from: string) => void;

const CHANNEL = 'enbox:bus';

const handlers = new Map<BusTopic, Set<Handler<never>>>();
const reconnectListeners = new Set<() => void>();
let pub: RedisClient | null = null;
let sub: RedisClient | null = null;

/** Subscribe to a topic (this process). Returns the unsubscribe function. */
export function onBus<K extends BusTopic>(topic: K, handler: Handler<K>): () => void {
  let set = handlers.get(topic);
  if (!set) handlers.set(topic, (set = new Set()));
  set.add(handler as Handler<never>);
  return () => set.delete(handler as Handler<never>);
}

/** Called after the bus reconnected to Redis (messages may have been missed meanwhile). */
export function onBusReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

function dispatch<K extends BusTopic>(topic: K, data: BusTopics[K], from: string): void {
  for (const handler of handlers.get(topic) ?? []) {
    try {
      (handler as Handler<K>)(data, from);
    } catch (err) {
      logger.error({ err, topic }, 'cluster bus handler failed');
    }
  }
}

/** Deliver to this process's handlers (synchronously) and to every other process. */
export function publish<K extends BusTopic>(topic: K, data: BusTopics[K]): void {
  dispatch(topic, data, NODE_ID);
  publishRemote(topic, data);
}

/** Deliver to every OTHER process only (no-op without Redis). */
export function publishRemote<K extends BusTopic>(topic: K, data: BusTopics[K]): void {
  if (!pub?.isReady) return;
  pub
    .publish(CHANNEL, JSON.stringify({ t: topic, f: NODE_ID, d: data }))
    .catch((err: unknown) => logger.error({ err, topic }, 'cluster bus publish failed'));
}

/** Whether other processes can currently be reached. */
export function busConnected(): boolean {
  return !!pub?.isReady && !!sub?.isReady;
}

function onMessage(raw: string): void {
  let msg: { t?: unknown; f?: unknown; d?: unknown };
  try {
    msg = JSON.parse(raw) as typeof msg;
  } catch {
    return;
  }
  if (typeof msg.t !== 'string' || typeof msg.f !== 'string' || msg.f === NODE_ID) return;
  if (!handlers.has(msg.t as BusTopic)) return;
  dispatch(msg.t as BusTopic, msg.d as never, msg.f);
}

/** Connect to Redis (no-op without a URL). Resolves once subscribed. */
export async function startBus(redisUrl: string | undefined): Promise<void> {
  if (!redisUrl || pub) return;
  pub = createRedis(redisUrl, 'bus:pub');
  sub = createRedis(redisUrl, 'bus:sub');
  let connected = false;
  sub.on('ready', () => {
    // node-redis resubscribes by itself after a reconnect; tell the consumers that messages
    // may have been lost while the connection was down.
    if (!connected) return;
    for (const listener of reconnectListeners) {
      try {
        listener();
      } catch (err) {
        logger.error({ err }, 'cluster bus reconnect listener failed');
      }
    }
  });
  await Promise.all([pub.connect(), sub.connect()]);
  await sub.subscribe(CHANNEL, onMessage);
  connected = true;
  logger.info({ node: NODE_ID }, 'cluster bus connected');
}

export async function stopBus(): Promise<void> {
  const clients = [pub, sub];
  pub = sub = null;
  await Promise.all(clients.map((c) => c?.close().catch(() => {})));
}
