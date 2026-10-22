/** How often a node refreshes its `cluster_nodes` heartbeat and its presence beat. */
export const CLUSTER_HEARTBEAT_MS = 5_000;
/** A node not heard from for this long is dead (its call sockets and presence are recovered). */
export const CLUSTER_NODE_TTL_MS = 20_000;
/** `cluster_nodes` rows of dead nodes are deleted after this long. */
export const CLUSTER_NODE_PRUNE_MS = 24 * 60 * 60_000;

/** Two-key advisory locks (`pg_advisory_lock(int4, int4)`), first key = "enb". */
export const ADVISORY_NAMESPACE = 0x656e62;
export const ADVISORY_MIGRATE = 1;
export const ADVISORY_JOBS_LEADER = 2;
