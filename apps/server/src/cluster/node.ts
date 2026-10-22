import os from 'node:os';
import { randomBytes } from 'node:crypto';

/**
 * This process's id in the cluster (docs "Cluster"). Unique per process START: a restarted
 * process is a new node, and whatever the previous one owned (call sockets, presence) is
 * recovered through the dead-node rules, never inherited.
 */
export const NODE_ID = `${os.hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;
