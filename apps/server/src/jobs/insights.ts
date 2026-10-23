/**
 * Space insights jobs (modules/insights/counters.ts):
 * - 'insights-flush' (every process, every 15 s): this process's message counters (messages
 *   per Space and channel, active members) are added to the daily tables.
 * - 'insights-voice' (leader, every minute): each voice state is one voice minute in its
 *   Space today, and its user is active today.
 */
import { flushInsightCounters, sampleVoiceMinutes } from '../modules/insights/counters.js';
import { registerJob } from './index.js';

registerJob({
  name: 'insights-flush',
  scope: 'node',
  intervalMs: 15_000,
  run: flushInsightCounters,
});

registerJob({
  name: 'insights-voice',
  intervalMs: 60_000,
  run: async () => void (await sampleVoiceMinutes()),
});
