/**
 * Presence subscriptions and per-viewer re-evaluation (docs "Users, privacy and presence").
 *
 * Presence is not room-based: each socket subscribes to subjects (`presence:subscribe`); the
 * registry lives in realtime/presence.ts. Privacy is evaluated per viewer at subscribe time
 * (the ack) and at every emit. Every subject change (online/offline, lastSeen/online
 * visibility, contacts, blocks, account deletion) re-evaluates the subject's subscribers
 * and emits `presence:update` to each socket whose visible presence CHANGED since the last
 * value it received (ack or update). Hidden presence therefore never produces updates when
 * the subject connects/disconnects (no timing side channel).
 *
 * Re-evaluations of one subject run strictly one after the other (per-subject queue), so a
 * quick online → offline sequence can't be emitted out of order.
 */
import type { Presence } from '@enbox/shared';
import { db } from '../../db/index.js';
import { logger } from '../../lib/logger.js';
import { emitToSocket } from '../../realtime/emit.js';
import {
  addPresenceSubscriptions,
  presenceSubscribers,
  removePresenceSubscriptions,
} from '../../realtime/presence.js';
import { pairKey, uniq } from '../../services/sql.js';
import { NO_RELATIONSHIP, buildPresence, getUserRow, getUserRows, loadPresences, loadRelationships } from '../../services/users.js';

/** socketId → subjectId → JSON of the last Presence that socket received. */
const lastSent = new Map<string, Map<string, string>>();
/** subjectId → tail of its re-evaluation queue. */
const queues = new Map<string, Promise<void>>();

function remember(socketId: string, p: Presence): void {
  let m = lastSent.get(socketId);
  if (!m) lastSent.set(socketId, (m = new Map()));
  m.set(p.userId, JSON.stringify(p));
}

/**
 * `presence:subscribe`: subscribe this socket to the known users among `ids` (unknown ids
 * are ignored, and so are ids beyond MAX_PRESENCE_SUBSCRIPTIONS) and return their current
 * presence as seen by the viewer.
 */
export async function subscribePresence(socket: { id: string; disconnected: boolean }, viewerId: string, ids: string[]): Promise<Presence[]> {
  const rows = await getUserRows(db, ids);
  if (socket.disconnected) return []; // its subscriptions were already dropped
  const known = uniq(ids).filter((id) => rows.has(id));
  const added = addPresenceSubscriptions(socket.id, viewerId, known);
  const presences = await loadPresences(db, viewerId, added);
  if (socket.disconnected) {
    forgetPresenceSocket(socket.id);
    return [];
  }
  for (const p of presences) remember(socket.id, p);
  return presences;
}

/** `presence:unsubscribe`. */
export function unsubscribePresence(socketId: string, ids: string[]): void {
  removePresenceSubscriptions(socketId, ids);
  const m = lastSent.get(socketId);
  if (!m) return;
  for (const id of ids) m.delete(id);
  if (m.size === 0) lastSent.delete(socketId);
}

/** Socket gone: forget what it was sent (the registry drops its subscriptions itself). */
export function forgetPresenceSocket(socketId: string): void {
  lastSent.delete(socketId);
}

async function evaluate(subjectId: string, override: { lastSeenAt?: Date }): Promise<void> {
  const subs = presenceSubscribers(subjectId);
  if (subs.length === 0) return;
  const row = await getUserRow(db, subjectId);
  if (!row) return;
  const subject = override.lastSeenAt && (!row.lastSeenAt || row.lastSeenAt < override.lastSeenAt) ? { ...row, lastSeenAt: override.lastSeenAt } : row;
  const viewerIds = new Set(subs.map((s) => s.viewerId));
  const rels = await loadRelationships(
    db,
    [...viewerIds].map((viewerId) => ({ viewerId, subjectId })),
  );
  // Re-read the subscribers: sockets may have (un)subscribed during the queries.
  for (const { socketId, viewerId } of presenceSubscribers(subjectId)) {
    if (!viewerIds.has(viewerId)) continue; // subscribed meanwhile: its ack is current
    const p = buildPresence(viewerId, subject, rels.get(pairKey(viewerId, subjectId)) ?? NO_RELATIONSHIP);
    const json = JSON.stringify(p);
    if (lastSent.get(socketId)?.get(subjectId) === json) continue;
    remember(socketId, p);
    emitToSocket(socketId, 'presence:update', p);
  }
}

/**
 * Re-evaluate `subjectId`'s presence for every subscribed socket and emit `presence:update`
 * where the viewer's value changed. Call AFTER commit (reads the global db). `lastSeenAt`
 * overrides a possibly not-yet-written `users.last_seen_at` (disconnect).
 */
export function reevaluatePresence(subjectId: string, override: { lastSeenAt?: Date } = {}): Promise<void> {
  const prev = queues.get(subjectId) ?? Promise.resolve();
  const next = prev
    .then(() => evaluate(subjectId, override))
    .catch((err: unknown) => logger.error({ err, subjectId }, 'presence re-evaluation failed'));
  queues.set(subjectId, next);
  void next.then(() => {
    if (queues.get(subjectId) === next) queues.delete(subjectId);
  });
  return next;
}

/** Wait until every queued re-evaluation has run (tests). */
export async function presenceIdle(): Promise<void> {
  while (queues.size) await Promise.all([...queues.values()]);
}
