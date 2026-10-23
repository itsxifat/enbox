/**
 * 'space-events' (leader, every minute and when this process becomes the leader): start and
 * end external events at their times, close live voice events long past their end and cancel
 * the ones nobody started (modules/events/service.ts `runEventsJob`).
 */
import { runEventsJob } from '../modules/events/service.js';
import { registerJob } from './index.js';

registerJob({
  name: 'space-events',
  intervalMs: 60_000,
  runOnStart: true,
  run: async () => {
    await runEventsJob();
  },
});
