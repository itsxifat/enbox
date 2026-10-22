/**
 * Calls jobs (docs "Jobs", "Cluster" → "Calls"), safety nets for the in-process ring-timeout
 * and reconnect-grace timers (modules/calls/state.ts) and for processes that died:
 * - 'calls' (leader, every 5 s and when this process becomes the leader): overdue rings →
 *   missed, expired reconnect windows → left, participants bound to a dead process →
 *   reconnect grace; then the end rules.
 * - 'calls-local' (every process): participants bound to a socket of this process that is
 *   gone without a recorded disconnect → reconnect grace.
 */
import { sweepCalls, sweepLocalCalls } from '../modules/calls/service.js';
import { registerJob } from './index.js';

registerJob({
  name: 'calls',
  intervalMs: 5_000,
  runOnStart: true,
  run: sweepCalls,
});

registerJob({
  name: 'calls-local',
  scope: 'node',
  intervalMs: 5_000,
  run: sweepLocalCalls,
});
