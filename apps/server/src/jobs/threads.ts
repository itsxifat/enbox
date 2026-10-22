/**
 * 'thread-archive' (leader, every minute and when this process becomes the leader): archive
 * the threads idle for longer than their auto-archive delay (modules/threads/service.ts).
 */
import { archiveIdleThreads } from '../modules/threads/service.js';
import { registerJob } from './index.js';

registerJob({
  name: 'thread-archive',
  intervalMs: 60_000,
  runOnStart: true,
  run: async () => {
    await archiveIdleThreads();
  },
});
