/**
 * Jobs leader (docs "Cluster" → "Jobs"): exactly one node runs the cluster-scoped jobs — the
 * one holding the PostgreSQL session advisory lock ADVISORY_JOBS_LEADER on a dedicated
 * connection. Followers retry every CLUSTER_HEARTBEAT_MS; when the leader dies its connection
 * closes, Postgres releases the lock and a follower takes over within one interval. The
 * leader pings its connection on the same interval and steps down when it fails.
 *
 * PGlite (dev, tests) is a single process: always the leader.
 */
import type { PoolClient } from 'pg';
import { dbDriver, pgPool } from '../db/index.js';
import { logger } from '../lib/logger.js';
import { ADVISORY_JOBS_LEADER, ADVISORY_NAMESPACE, CLUSTER_HEARTBEAT_MS } from './constants.js';

let leader = false;
let client: PoolClient | null = null;
let timer: NodeJS.Timeout | undefined;
let busy = false;
const listeners = new Set<(leader: boolean) => void>();

export function isLeader(): boolean {
  return leader || dbDriver() === 'pglite';
}

/** Leadership changes (true = this node just became the leader). */
export function onLeadershipChange(listener: (leader: boolean) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setLeader(next: boolean): void {
  if (leader === next) return;
  leader = next;
  logger.info(
    { leader },
    next ? 'cluster: this node is the jobs leader' : 'cluster: lost jobs leadership',
  );
  for (const listener of listeners) {
    try {
      listener(next);
    } catch (err) {
      logger.error({ err }, 'leadership listener failed');
    }
  }
}

function dropClient(err?: unknown): void {
  const c = client;
  client = null;
  if (c) c.release(err instanceof Error ? err : true);
  setLeader(false);
}

async function attempt(): Promise<void> {
  const pool = pgPool();
  if (!pool) return;
  if (client) {
    try {
      await client.query('select 1');
    } catch (err) {
      logger.warn({ err }, 'cluster: leader connection failed');
      dropClient(err);
    }
    return;
  }
  const c = await pool.connect();
  try {
    const res = await c.query<{ ok: boolean }>(
      'select pg_try_advisory_lock($1::int, $2::int) as ok',
      [ADVISORY_NAMESPACE, ADVISORY_JOBS_LEADER],
    );
    if (!res.rows[0]?.ok) {
      c.release();
      return;
    }
  } catch (err) {
    c.release(err instanceof Error ? err : true);
    throw err;
  }
  client = c;
  c.on('error', (err) => {
    logger.warn({ err }, 'cluster: leader connection error');
    if (client === c) dropClient(err);
  });
  setLeader(true);
}

function tick(): void {
  if (busy) return;
  busy = true;
  attempt()
    .catch((err: unknown) => logger.error({ err }, 'cluster: leader election failed'))
    .finally(() => {
      busy = false;
    });
}

/** Start competing for leadership (resolves after the first attempt). */
export async function startLeaderElection(): Promise<void> {
  if (dbDriver() === 'pglite') {
    setLeader(true);
    return;
  }
  busy = true;
  try {
    await attempt();
  } catch (err) {
    logger.error({ err }, 'cluster: leader election failed');
  } finally {
    busy = false;
  }
  timer ??= setInterval(tick, CLUSTER_HEARTBEAT_MS);
  timer.unref();
}

/** Step down (shutdown): release the lock so a follower takes over at once. */
export async function stopLeaderElection(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = undefined;
  const c = client;
  client = null;
  if (c) {
    await c
      .query('select pg_advisory_unlock($1::int, $2::int)', [
        ADVISORY_NAMESPACE,
        ADVISORY_JOBS_LEADER,
      ])
      .catch(() => {});
    c.release();
  }
  setLeader(false);
}
