/**
 * Node liveness (docs "Cluster"): every process upserts its `cluster_nodes` row every
 * CLUSTER_HEARTBEAT_MS and deletes it on graceful shutdown. A node is alive while its row is
 * younger than CLUSTER_NODE_TTL_MS. PostgreSQL (not Redis) is the truth: a lost Redis
 * connection must never make healthy nodes look dead and end their calls.
 *
 * This node is always alive to itself, also before its first heartbeat (tests never start
 * the heartbeat).
 */
import { and, eq, gt, lt, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, type DbOrTx } from '../db/index.js';
import { clusterNodes } from '../db/schema.js';
import { logger } from '../lib/logger.js';
import { CLUSTER_HEARTBEAT_MS, CLUSTER_NODE_PRUNE_MS, CLUSTER_NODE_TTL_MS } from './constants.js';
import { NODE_ID } from './node.js';

let timer: NodeJS.Timeout | undefined;

async function beat(): Promise<void> {
  const now = new Date();
  await db
    .insert(clusterNodes)
    .values({ id: NODE_ID, startedAt: now, heartbeatAt: now })
    .onConflictDoUpdate({ target: clusterNodes.id, set: { heartbeatAt: now } });
  await db
    .delete(clusterNodes)
    .where(lt(clusterNodes.heartbeatAt, new Date(now.getTime() - CLUSTER_NODE_PRUNE_MS)));
}

/** Register this node (awaited at boot, before the server listens), then keep beating. */
export async function startNodeHeartbeat(): Promise<void> {
  await beat();
  timer ??= setInterval(() => {
    beat().catch((err: unknown) => logger.error({ err }, 'cluster heartbeat failed'));
  }, CLUSTER_HEARTBEAT_MS);
  timer.unref();
}

/** Shutdown: stop beating and remove our row so the others recover our sockets at once. */
export async function stopNodeHeartbeat(): Promise<void> {
  if (timer) clearInterval(timer);
  timer = undefined;
  await db
    .delete(clusterNodes)
    .where(eq(clusterNodes.id, NODE_ID))
    .catch((err: unknown) => logger.error({ err }, 'failed to deregister the cluster node'));
}

/** Whether `nodeId` is alive (inside a transaction pass `tx`). */
export async function isNodeAlive(dbx: DbOrTx, nodeId: string | null): Promise<boolean> {
  if (!nodeId) return false;
  if (nodeId === NODE_ID) return true;
  const [row] = await dbx
    .select({ id: clusterNodes.id })
    .from(clusterNodes)
    .where(
      and(
        eq(clusterNodes.id, nodeId),
        gt(clusterNodes.heartbeatAt, new Date(Date.now() - CLUSTER_NODE_TTL_MS)),
      ),
    )
    .limit(1);
  return !!row;
}

/** SQL: the node in `col` is NOT alive (null counts as dead). This node is always alive. */
export function deadNodeSql(col: AnyPgColumn): SQL {
  const cutoff = new Date(Date.now() - CLUSTER_NODE_TTL_MS);
  return sql`(${col} is null or (${col} <> ${NODE_ID} and not exists (select 1 from ${clusterNodes} where ${clusterNodes.id} = ${col} and ${clusterNodes.heartbeatAt} > ${cutoff})))`;
}
